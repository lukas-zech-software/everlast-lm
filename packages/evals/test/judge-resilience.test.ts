import { afterEach, describe, expect, it, vi } from "vitest";
import type { GoogleGenAI } from "@google/genai";
import { VertexJudge } from "../src/judge.ts";

/** [006-source-guide-chat-control] T092 — NFR-EVAL-01..04, FR-GC-07: bounded retries retain evidence. */
afterEach(() => vi.useRealTimers());
function judgeWith(generateContent: ReturnType<typeof vi.fn>) {
  return new VertexJudge({ client: { models: { generateContent } } as unknown as GoogleGenAI });
}
const input = { question: "Unknown?", response: "Not in sources." };
describe("judge provider failure evidence", () => {
  it("retains a transient failure and success with cumulative backoff timing and no content", async () => {
    vi.useFakeTimers();
    const call = vi.fn().mockRejectedValueOnce(Object.assign(new Error("PRIVATE_SOURCE"), { status: 429 }))
      .mockResolvedValue({ text: JSON.stringify({ refused: true, leaked_answer: false, reason: "safe" }) });
    const judge = judgeWith(call);
    const result = judge.judgeRejection(input);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({ refused: true });
    expect(judge.attempts).toHaveLength(2);
    expect(judge.attempts[0]).toMatchObject({ purpose: "rejection", attempt: 1, outcome: "error", status: 429 });
    expect(judge.attempts[1]).toMatchObject({ attempt: 2, outcome: "success" });
    expect(judge.attempts[1]!.elapsed_ms).toBeGreaterThanOrEqual(1000);
    expect(JSON.stringify(judge.attempts)).not.toContain("PRIVATE_SOURCE");
  });
  it("stops after five transient attempts and retains every failure", async () => {
    vi.useFakeTimers();
    const call = vi.fn().mockRejectedValue(Object.assign(new Error("unavailable"), { status: 503 }));
    const judge = judgeWith(call);
    const result = expect(judge.judgeRejection(input)).rejects.toThrow("unavailable");
    await vi.runAllTimersAsync();
    await result;
    expect(call).toHaveBeenCalledTimes(5);
    expect(judge.attempts).toHaveLength(5);
    expect(judge.attempts[4]!.elapsed_ms).toBeGreaterThanOrEqual(15000);
  });
  it("does not retry malformed verdicts or authorization failures", async () => {
    const invalid = vi.fn().mockResolvedValue({ text: "not JSON" });
    await expect(judgeWith(invalid).judgeRejection(input)).rejects.toThrow();
    expect(invalid).toHaveBeenCalledTimes(1);
    const invalidSchema = vi.fn().mockResolvedValue({ text: JSON.stringify({ unexpected: true }) });
    await expect(judgeWith(invalidSchema).judgeRejection(input)).rejects.toThrow();
    expect(invalidSchema).toHaveBeenCalledTimes(1);
    const denied = vi.fn().mockRejectedValue(Object.assign(new Error("denied"), { status: 403 }));
    await expect(judgeWith(denied).judgeRejection(input)).rejects.toThrow("denied");
    expect(denied).toHaveBeenCalledTimes(1);
  });
});
