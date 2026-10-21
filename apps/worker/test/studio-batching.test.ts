import { describe, it, expect } from "vitest";
import { batchChunks } from "../src/studio/reports/batching.ts";
import { SRC_HISTORY, makeChunk } from "./studio-fixtures.ts";

describe("batchChunks (D12, bounded batches over all scoped chunks)", () => {
  it("covers every chunk exactly once, in order, within token and chunk bounds", () => {
    const chunks = Array.from({ length: 25 }, (_, i) => makeChunk(SRC_HISTORY, `chunk ${i}`, 1, 100));
    const batches = batchChunks(chunks, { maxTokens: 450, maxChunks: 4 });
    expect(batches.flat().map((c) => c.chunk_id)).toEqual(chunks.map((c) => c.chunk_id));
    for (const b of batches) {
      expect(b.length).toBeLessThanOrEqual(4);
      expect(b.reduce((s, c) => s + c.token_count, 0)).toBeLessThanOrEqual(450);
    }
  });
  it("isolates an oversized chunk in its own batch", () => {
    const big = makeChunk(SRC_HISTORY, "big", 1, 9000);
    const small = makeChunk(SRC_HISTORY, "small", 1, 10);
    expect(batchChunks([small, big, small], { maxTokens: 100, maxChunks: 10 }).map((b) => b.length)).toEqual([1, 1, 1]);
  });
  it("returns no batches for empty input and applies defaults", () => {
    expect(batchChunks([])).toEqual([]);
    const many = Array.from({ length: 100 }, () => makeChunk(SRC_HISTORY, "x", 1, 1));
    // Defaults 8 chunks / 4,000 tokens (revised 2026-10-20 for the parallel map step, Gate v2.0 #3 P95).
    expect(batchChunks(many).map((b) => b.length)).toEqual([...Array(12).fill(8), 4]);
    const heavy = Array.from({ length: 5 }, () => makeChunk(SRC_HISTORY, "x", 1, 1500));
    expect(batchChunks(heavy).map((b) => b.length)).toEqual([2, 2, 1]);
  });
});
