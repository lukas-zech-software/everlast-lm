import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { uuidv7, type UnifiedDocumentChunk } from "@everlast/contracts";
import { LATENCY_VALUES, MONTHS, RND_2021_PAGE, RND_2025_PAGE, DECOY_MARKER, UNKNOWN_CHUNK_ID } from "@everlast/testkit/code-execution-fixtures";

/**
 * [010-code-execution-sandbox] T007 — immutable C-02-derived input manifest and evidence completeness
 * (FR-GC-08, C-01/C-02, NFR-EVAL-04; spec FR-001, FR-008, FR-009, FR-010, FR-012, SC-001, SC-005).
 * Pure unit: chunks are built in memory with the C-01 shape; no database or sandbox.
 */

let m: Record<string, any> = {};
const load = async () => (m = (await import("../src/chat/execution/manifest.ts").catch(() => ({}))) as Record<string, any>);

const SRC = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a01";
const SRC_B = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a02";
const DECOY = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a03";

function chunk(sourceId: string, text: string, revision = 1): UnifiedDocumentChunk {
  return { chunk_id: uuidv7(), source_id: sourceId, revision, locator: { page_number: 1, start_offset: 0, end_offset: text.length }, token_count: 3, text };
}

const months = MONTHS.map((mo, i) => chunk(SRC, `${mo} 2025: ${LATENCY_VALUES[i]} ms`));
const snapshot = [{ source_id: SRC, revision: 1 }, { source_id: SRC_B, revision: 1 }];
const dataset = months.map((c, i) => ({ label: `${MONTHS[i]} 2025`, value: String(LATENCY_VALUES[i]), unit: "ms", chunk_id: c.chunk_id }));

describe("T007 manifest from the captured snapshot only (C-02, FR-009, FR-010)", () => {
  it("MAN-01: builds one internal data.json copy with values, units, digest, byte count and supporting chunk IDs", async () => {
    await load();
    const manifest = m.buildInputManifest?.({ snapshot, chunks: months, dataset });
    expect(manifest?.entries).toHaveLength(1);
    const entry = manifest.entries[0];
    expect(entry.filename).toBe("data.json");
    expect(entry.supporting_chunk_ids).toEqual(months.map((c) => c.chunk_id));
    const file = manifest.files[0];
    expect(file.name).toBe("data.json");
    expect(entry.digest).toBe(createHash("sha256").update(file.content).digest("hex"));
    expect(entry.byte_count).toBe(file.content.length);
    expect(JSON.parse(file.content.toString()).values.map((v: { value: number }) => v.value)).toEqual([...LATENCY_VALUES]);
    expect(Object.isFrozen(manifest)).toBe(true);
  });

  it("MAN-02: a value whose chunk was not supplied through C-02 is refused (no out-of-universe data)", async () => {
    await load();
    expect(() => m.buildInputManifest({ snapshot, chunks: months, dataset: [...dataset, { label: "x", value: "1", unit: null, chunk_id: UNKNOWN_CHUNK_ID }] })).toThrow(
      expect.objectContaining({ reason: "unknown_chunk" })
    );
  });

  it("MAN-03: a chunk outside the captured (source_id, revision) snapshot is refused — decoys and stale revisions", async () => {
    await load();
    const decoy = chunk(DECOY, `Decoy ${DECOY_MARKER}: 900 ms`);
    const stale = chunk(SRC, "Jan 2025: 1 ms", 2);
    for (const bad of [decoy, stale]) {
      expect(() => m.buildInputManifest({ snapshot, chunks: [...months, bad], dataset: [{ label: "x", value: bad === decoy ? "900" : "1", unit: "ms", chunk_id: bad.chunk_id }] })).toThrow(
        expect.objectContaining({ reason: "out_of_snapshot" })
      );
    }
  });

  it("MAN-04: every value must literally occur in its cited chunk — no invented or model-computed numbers", async () => {
    await load();
    expect(() => m.buildInputManifest({ snapshot, chunks: months, dataset: [{ ...dataset[0], value: "13" }] })).toThrow(expect.objectContaining({ reason: "unverified_value" }));
    expect(() => m.buildInputManifest({ snapshot, chunks: months, dataset: [{ ...dataset[0], value: "NaN" }] })).toThrow();
  });

  it("MAN-05: unit-suffixed money figures ($850M, $1.2B) are verified and keep their explicit units (FR-008)", async () => {
    await load();
    const a = chunk(SRC, RND_2021_PAGE);
    const b = chunk(SRC_B, RND_2025_PAGE);
    const manifest = m.buildInputManifest({
      snapshot,
      chunks: [a, b],
      dataset: [
        { label: "R&D spend 2021", value: "850", unit: "USD million", chunk_id: a.chunk_id },
        { label: "R&D spend 2025", value: "1.2", unit: "USD billion", chunk_id: b.chunk_id },
      ],
    });
    const values = JSON.parse(manifest.files[0].content.toString()).values;
    expect(values.map((v: { unit: string }) => v.unit)).toEqual(["USD million", "USD billion"]);
    expect(manifest.entries[0].supporting_chunk_ids).toEqual([a.chunk_id, b.chunk_id]);
  });

  it("MAN-06: labels/units cannot smuggle URLs, credentials or paths into the sandbox", async () => {
    await load();
    for (const label of ["https://evil.test/x", "gs://bucket/obj", "../../etc/passwd", "Bearer ya29.abc"]) {
      expect(() => m.buildInputManifest({ snapshot, chunks: months, dataset: [{ ...dataset[0], label }] }), label).toThrow(expect.objectContaining({ reason: "unsafe_text" }));
    }
  });

  it("MAN-07: the payload contains only scoped values — never chunk text from unused or decoy chunks", async () => {
    await load();
    const decoyText = chunk(SRC, `Unused paragraph mentioning ${DECOY_MARKER}`);
    const manifest = m.buildInputManifest({ snapshot, chunks: [...months, decoyText], dataset });
    expect(manifest.files.map((f: { content: Buffer }) => f.content.toString()).join("")).not.toContain(DECOY_MARKER);
  });

  it("MAN-08: an empty dataset is honest insufficient evidence, not an empty calculation", async () => {
    await load();
    expect(() => m.buildInputManifest({ snapshot, chunks: months, dataset: [] })).toThrow(expect.objectContaining({ reason: "insufficient_evidence" }));
  });
});

describe("T007 whole-table coverage policy (FR-001, FR-012, SC-001)", () => {
  it("MAN-09: a truncated top-12 retrieval of a larger snapshot requires complete scoped evidence", async () => {
    await load();
    expect(m.evidencePlan?.({ retrieved: 12, snapshotTotal: 12 })).toEqual({ kind: "complete" });
    expect(m.evidencePlan({ retrieved: 12, snapshotTotal: 40 })).toEqual({ kind: "expand" });
    expect(m.evidencePlan({ retrieved: 12, snapshotTotal: m.MAX_COMPUTE_CHUNKS + 1 })).toEqual({ kind: "insufficient" });
    expect(m.MAX_COMPUTE_CHUNKS).toBeGreaterThanOrEqual(100);
  });
});
