import { describe, expect, it, vi } from "vitest";
import { AdkGroundedModel } from "../src/chat/model.ts";

/** FR-GC-07, C-02: only the validated per-request length enum may affect trusted instructions. */
describe("trusted response-length instructions", () => {
  it("applies Shorter to its own request without promoting source/custom text or leaking into concurrent Default", async () => {
    const model = new AdkGroundedModel({ project: "test", location: "europe-west4", model: "gemini-2.5-flash" });
    const requests: any[] = [];
    vi.spyOn(model.llm, "generateContentAsync").mockImplementation(async function* (request) {
      requests.push(request);
      yield { content: { role: "model", parts: [{ text: JSON.stringify({ status: "not_in_sources", missing_topic: "answer", sentences: [] }) }] }, turnComplete: true };
    });
    await Promise.all([
      model.generate({ question: "A?", chunks: [{ chunk_id: "11111111-1111-4111-8111-111111111111", source_id: "22222222-2222-4222-8222-222222222222", revision: 1, text: "UNTRUSTED_SOURCE", token_count: 1, locator: { page_number: 1, start_offset: 0, end_offset: 16 } }], history: [], preferences: { response_length: "shorter", style: "custom", custom_instructions: "UNTRUSTED_CUSTOM" } }),
      model.generate({ question: "B?", chunks: [], history: [], preferences: { response_length: "default" } }),
    ]);
    const system = requests.map(r => JSON.stringify(r.config?.systemInstruction));
    expect(system.filter(s => s.includes("Length: Shorter"))).toHaveLength(1);
    expect(system.every(s => !s.includes("UNTRUSTED_CUSTOM") && !s.includes("UNTRUSTED_SOURCE"))).toBe(true);
    expect(system.every(s => s.includes("Use ONLY the facts"))).toBe(true);
  });
});
