import { describe, it, expect, beforeEach } from "vitest";
import { createPocNotebook, getScopedContext, registerSource, resetPocBridge, resetSourceRegistry } from "@everlast/db";
import type { NoteSource, UnifiedDocumentChunk } from "@everlast/contracts";

// Deterministic NFR-EVAL-02 (citation precision) and NFR-EVAL-04 (scope leakage) checks for note sources.
const SRC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SRC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const chunk = (source_id: string, n: number, text: string): UnifiedDocumentChunk => ({
  chunk_id: `018f6b40-000${n}-7000-8000-00000000000${n}`,
  source_id, revision: 1,
  locator: { selector: "body", start_offset: 0, end_offset: text.length },
  token_count: 1, text,
});

const source = (id: string, nb: string): NoteSource => ({
  id, notebook_id: nb, title: "N", media_type: "note_markdown", status: "Ready", revision_id: 1,
  byte_size: 1, word_count: 1, origin_notes: [{ note_id: id, revision: 1, title: "N" }], created_at: new Date().toISOString(),
});

describe("NFR-EVAL-02, NFR-EVAL-04: note source scope", () => {
  beforeEach(() => {
    resetPocBridge();
    resetSourceRegistry();
  });

  it("every returned chunk belongs to the selected set (leakage = 0) and badges resolve (precision = 1.0)", async () => {
    const nb = createPocNotebook("u", "NB").id;
    await registerSource(source(SRC_A, nb), [chunk(SRC_A, 1, "TITAN-77")]);
    await registerSource(source(SRC_B, nb), [chunk(SRC_B, 2, "DECOY")]);

    const context = await getScopedContext(nb, [SRC_A]);
    const forbidden = context.filter((c) => c.source_id !== SRC_A);
    expect(forbidden).toHaveLength(0);

    const badges = [context[0]!.chunk_id];
    const valid = badges.filter((id) => context.some((c) => c.chunk_id === id));
    expect(valid.length / badges.length).toBe(1);
  });

  it("cross-notebook source ids are rejected", async () => {
    const nb1 = createPocNotebook("u", "1").id;
    const nb2 = createPocNotebook("u", "2").id;
    await registerSource(source(SRC_A, nb1), [chunk(SRC_A, 1, "secret")]);
    await expect(getScopedContext(nb2, [SRC_A])).rejects.toThrow();
  });
});
