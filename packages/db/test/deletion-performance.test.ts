import { describe, it, expect } from "vitest";
import { createNotebook, deleteNotebook } from "../src/notebooks.js";
import { getLatestCleanupOperationForNotebook } from "../src/cleanup.js";

describe("T017 [US1] Performance: Relational & Chunk Deletion Cascade Timing (FR-WM-01)", () => {
  const ownerId = "usr_perf_test_owner_1";

  it("PERF-01: relational/chunk cascade completes within <= 2.0 s P95 across warm samples", async () => {
    // Cold run
    const coldStart = performance.now();
    const coldNb = await createNotebook(undefined, ownerId, { title: "Cold Deletion Test" });
    const coldDeleted = await deleteNotebook(undefined, coldNb.id, ownerId);
    const coldDurationMs = performance.now() - coldStart;

    expect(coldDeleted).toBe(true);
    expect(coldDurationMs).toBeLessThan(2000);

    // Warm runs: 20 samples
    const sampleCount = 20;
    const latencies: number[] = [];

    for (let i = 0; i < sampleCount; i++) {
      const nb = await createNotebook(undefined, ownerId, { title: `Warm Deletion ${i}` });
      const t0 = performance.now();
      const deleted = await deleteNotebook(undefined, nb.id, ownerId);
      const t1 = performance.now();
      expect(deleted).toBe(true);
      latencies.push(t1 - t0);
    }

    latencies.sort((a, b) => a - b);
    const p95Index = Math.floor(sampleCount * 0.95);
    const p95Latency = latencies[p95Index] ?? latencies[latencies.length - 1]!;

    // Assert P95 <= 2.0 s (2000 ms)
    expect(p95Latency).toBeLessThan(2000);

    // Verify storage purge is asynchronous/outbox-backed (decoupled from relational cascade)
    const lastNb = await createNotebook(undefined, ownerId, { title: "Outbox Check" });
    await deleteNotebook(undefined, lastNb.id, ownerId);
    const cleanupOp = getLatestCleanupOperationForNotebook(lastNb.id);
    expect(cleanupOp).not.toBeNull();
    expect(cleanupOp?.status).toBe("Pending");
  });
});
