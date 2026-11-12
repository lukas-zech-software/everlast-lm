import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createVertexStudioContextFromEnv } from "../src/studio/reports/vertex-model.ts";

const mocks = vi.hoisted(() => ({
  clientOptions: vi.fn(),
  countTokens: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@google/genai", async (importOriginal) => ({
  ...await importOriginal<typeof import("@google/genai")>(),
  GoogleGenAI: class {
    models = { countTokens: mocks.countTokens };
    caches = { create: mocks.create, delete: mocks.delete };
    constructor(options: unknown) {
      mocks.clientOptions(options);
    }
  },
}));

/** [008-studio-text-reports] T083 NFR-PERF-01, NFR-SEC-01, D23: local SDK double, no cloud calls. */
describe("enterprise EU report context", () => {
  it("counts original text and the complete cache envelope on the same frozen D23 Flash route", async () => {
    mocks.countTokens.mockResolvedValue({ totalTokens: 1_000_000 });
    mocks.create.mockResolvedValue({ name: "private-handle", expireTime: new Date(Date.now() + 60_000).toISOString() });
    const runtime = createVertexStudioContextFromEnv({
      VERTEX_PROJECT: "approved-test-project",
      VERTEX_LOCATION: "europe-west4",
      REPORT_MODEL: "gemini-2.5-flash",
      REPORT_MODEL_VERSION: "legacy-version",
    });
    expect(mocks.clientOptions).toHaveBeenCalledWith({
      vertexai: true,
      project: "approved-test-project",
      location: "eu",
      httpOptions: { baseUrl: "https://aiplatform.eu.rep.googleapis.com", timeout: 30_000 },
    });
    expect(runtime).toMatchObject({
      model: "gemini-3.8-flash",
      modelVersion: "gemini-3.8-flash",
      inputLimit: 1_048_576,
      outputReserve: 8192,
      tokenizer: {
        model: "gemini-3.8-flash",
        version: "vertex-countTokens:gemini-3.8-flash",
        qualification: "enterprise-eu",
      },
    });
    expect(await runtime.tokenizer.count("original source")).toBe(1_000_000);
    expect(mocks.countTokens).toHaveBeenNthCalledWith(1, { model: runtime.model, contents: "original source" });
    const chunk = {
      chunk_id: randomUUID(),
      source_id: randomUUID(),
      revision: 1,
      text: "original source",
      token_count: 2,
      locator: { page_number: 1, start_offset: 0, end_offset: 15 },
    };
    const input = {
      chunks: (async function* () { yield [chunk]; })(),
      model: runtime.model,
      ttlSeconds: 60,
      signal: new AbortController().signal,
    };
    await expect(runtime.provider.create({ ...input, model: "unapproved-model" })).rejects.toThrow(/model mismatch/i);
    const created = await runtime.provider.create(input);
    expect(created.handle).toBe("private-handle");
    const counted = mocks.countTokens.mock.calls[1]?.[0];
    expect(counted).toMatchObject({ model: runtime.model });
    expect(mocks.create).toHaveBeenCalledWith({
      model: runtime.model,
      config: { ttl: "60s", contents: counted.contents },
    });
    expect(JSON.stringify(counted.contents)).toContain("original source");
    await runtime.provider.delete(created.handle);
    expect(mocks.delete).toHaveBeenCalledWith({ name: "private-handle" });
    mocks.countTokens.mockResolvedValue({ totalTokens: 1_048_576 });
    await expect(runtime.provider.create({
      ...input,
      chunks: (async function* () { yield [chunk]; })(),
    })).rejects.toThrow(/envelope/);
  });
});
