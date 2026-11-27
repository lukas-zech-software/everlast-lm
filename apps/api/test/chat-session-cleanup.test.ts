import type { InMemoryRunner } from "@google/adk";
import { describe, expect, it, vi } from "vitest";
import { AdkGroundedModel, ModelUnavailableError } from "../src/chat/model.ts";

/** Grill F21, FR-GC-01: every turn frees its in-memory ADK session, including failed and aborted turns. */
describe("FR-GC-01 ADK session cleanup", () => {
  interface Runners {
    runner: InMemoryRunner;
    correctionRunner: InMemoryRunner;
  }
  const newModel = () =>
    new AdkGroundedModel({ project: "test", location: "europe-west4", model: "gemini-2.5-flash" });
  const spies = (runner: InMemoryRunner) => ({
    create: vi.spyOn(runner.sessionService, "createSession"),
    remove: vi.spyOn(runner.sessionService, "deleteSession"),
  });
  const input = (signal?: AbortSignal) => ({
    question: "Q?",
    chunks: [],
    history: [],
    preferences: { response_length: "default" as const },
    signal,
  });
  async function createdId(create: ReturnType<typeof spies>["create"]): Promise<string> {
    return (await (create.mock.results[0]?.value as Promise<{ id: string }>)).id;
  }

  it("CHAT-SESS-01 a failed generate() deletes its session", async () => {
    const model = newModel();
    // eslint-disable-next-line require-yield -- the mocked upstream fails before streaming anything
    vi.spyOn(model.llm, "generateContentAsync").mockImplementation(async function* () {
      await Promise.resolve();
      throw new Error("Vertex 403");
    });
    const { create, remove } = spies((model as unknown as Runners).runner);
    await expect(model.generate(input())).rejects.toBeInstanceOf(ModelUnavailableError);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0]?.[0].sessionId).toBe(await createdId(create));
  });

  it("CHAT-SESS-02 an aborted generate() deletes its session", async () => {
    const model = newModel();
    const controller = new AbortController();
    // eslint-disable-next-line require-yield -- the mocked upstream waits for the abort and never streams
    vi.spyOn(model.llm, "generateContentAsync").mockImplementation(async function* () {
      await new Promise((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const { create, remove } = spies((model as unknown as Runners).runner);
    const pending = model.generate(input(controller.signal));
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    controller.abort(new Error("user stop"));
    await expect(pending).rejects.toThrow();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0]?.[0].sessionId).toBe(await createdId(create));
  });

  it("CHAT-SESS-03 a failed correctCode() deletes its session", async () => {
    const model = newModel();
    // eslint-disable-next-line require-yield -- the mocked upstream fails before streaming anything
    vi.spyOn(model.llm, "generateContentAsync").mockImplementation(async function* () {
      await Promise.resolve();
      throw new Error("Vertex 500");
    });
    const { create, remove } = spies((model as unknown as Runners).correctionRunner);
    await expect(
      model.correctCode({ question: "Q", intent: "sum", values: [], failedCode: "x", stderr: "e" }),
    ).rejects.toBeInstanceOf(ModelUnavailableError);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0]?.[0]).toMatchObject({
      appName: "everlast-code-correction",
      sessionId: await createdId(create),
    });
  });
});
