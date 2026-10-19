import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UUID_V7_REGEX } from "@everlast/contracts";
import { buildPdf, wrapLines } from "@everlast/testkit/pdf-builder";
import { getQuotaSummary } from "@everlast/db";
import { createWorkerHarness, prose, type WorkerHarness } from "./support.ts";

/**
 * T009 [US1] — FR-SI-01 measurable criteria. Timings run on the declared local environment (Node 24+,
 * PostgreSQL 16 + pgvector in Docker, local storage, deterministic test embedder); cloud OCR/embedding
 * latency is excluded and recorded separately as UNAVAILABLE until Vertex AI / Document AI are configured.
 */

let h: WorkerHarness;

beforeAll(async () => {
  h = await createWorkerHarness();
});

afterAll(async () => {
  await h?.close();
});

function twentyPagePdf(seed: string): Buffer {
  return buildPdf(Array.from({ length: 20 }, (_, i) => ({ kind: "text" as const, lines: wrapLines(prose(420, `${seed}${i}`)).slice(0, 52) })));
}

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
}

describe("FR-SI-01 integration and timing", () => {
  it("US1-I01: long documents chunk to 300–600 tokens; only section tails may be shorter", async () => {
    const { source } = await h.ingest({ name: "long.txt", bytes: Buffer.from(prose(6000)), mediaType: "text/plain" });
    const rows = (await h.db.pool.query("SELECT token_count, locator FROM chunks WHERE source_id = $1 ORDER BY sequence", [source.id])).rows;
    const byPage = new Map<number, number[]>();
    for (const r of rows) byPage.set(r.locator.page_number, [...(byPage.get(r.locator.page_number) ?? []), r.token_count]);
    for (const counts of byPage.values()) {
      counts.slice(0, -1).forEach((c) => {
        expect(c).toBeGreaterThanOrEqual(300);
        expect(c).toBeLessThanOrEqual(600);
      });
    }
  });

  it("US1-I02: standard 20-page digital PDF reaches Ready within 5.0 s (P95, 10 warm samples)", async () => {
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      const started = performance.now();
      const { source } = await h.ingest({ name: `bench-${i}.pdf`, bytes: twentyPagePdf(`b${i}`), mediaType: "application/pdf" });
      samples.push(performance.now() - started);
      expect(source.status).toBe("Ready");
    }
    console.log(JSON.stringify({ case: "US1-I02", samples_ms: samples.map(Math.round), p95_ms: Math.round(p95(samples)) }));
    expect(p95(samples)).toBeLessThanOrEqual(5000);
  }, 120_000);

  it("US1-I03: 20 concurrent PDF uploads are processed without deadlock or lost slots", async () => {
    const notebookId = await h.newNotebook();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => h.ingest({ name: `batch-${i}.pdf`, bytes: twentyPagePdf(`c${i}`), mediaType: "application/pdf", notebookId }))
    );
    expect(results.every((r) => r.source.status === "Ready")).toBe(true);
    expect((await getQuotaSummary(h.db.pool, h.ownerId, notebookId)).sources_used).toBe(20);
  }, 180_000);

  it("US1-I04: emitted chunk IDs are UUIDv7 and unique", async () => {
    const { source } = await h.ingest({ name: "ids.md", bytes: Buffer.from(`# A\n\n${prose(900)}\n\n# B\n\n${prose(400)}`), mediaType: "text/markdown" });
    const ids = (await h.db.pool.query("SELECT chunk_id FROM chunks WHERE source_id = $1", [source.id])).rows.map((r) => r.chunk_id);
    expect(ids.length).toBeGreaterThan(2);
    expect(ids.every((id) => UUID_V7_REGEX.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("LIMIT-03: a 40 MB file with 520,000 words passes the byte check but fails the word limit", async () => {
    const word = "x".repeat(76);
    const text = Array.from({ length: 520_000 }, () => word).join(" ");
    expect(Buffer.byteLength(text)).toBeGreaterThan(40_000_000);
    const { source } = await h.ingest({ name: "huge.txt", bytes: Buffer.from(text), mediaType: "text/plain" });
    expect(source).toMatchObject({ status: "Failed", failure_message: "Exceeds 500,000 words limit" });
  }, 120_000);

  it("LIMIT-01: exactly 200,000,000 actual bytes is accepted end to end", async () => {
    // 400,000 words of 499 bytes + separator = 200,000,000 bytes, within the independent word limit.
    const word = "y".repeat(499);
    const bytes = Buffer.alloc(200_000_000, 0x20);
    for (let i = 0; i < 400_000; i++) bytes.write(word, i * 500, "latin1");
    const { outcome, source } = await h.ingest({ name: "edge.txt", bytes, mediaType: "text/plain" });
    expect(source.actual_bytes).toBe(200_000_000);
    expect(outcome.status).toBe("ready");
    expect(source.word_count).toBe(400_000);
  }, 300_000);
});
