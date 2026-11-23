import { describe, expect, it } from "vitest";
import { STUDIO_FLASHCARDS_PLUGIN_TYPE } from "@everlast/contracts";
import {
  buildThreeSourceStudioFixture,
  makeStudioChunk,
  makeStudioSourceId,
  STUDIO_LEAK_PROBE,
} from "@everlast/testkit/studio-structure-fixtures";
import { DeterministicFlashcardsModel } from "../src/studio/flashcards/model.ts";
import { generateFlashcards } from "../src/studio/flashcards/pipeline.ts";
import { FlashcardsGeneratorPlugin } from "../src/studio/flashcards/plugin.ts";
import { validateFlashcardsPayload } from "../src/studio/flashcards/validation.ts";

/**
 * [014-studio-active-learning-suite] T007 — Flashcards pipeline & validator unit tests
 * (FR-ST-13, C-02, C-03, NFR-EVAL-02/04, Gate v4.0 #1).
 */

describe("[014-studio-active-learning-suite] T007: Flashcards worker pipeline, presets, brief-source limits, and citation validation", () => {
  it("generates grounded flashcards for fewer/standard/more presets with unique UUIDs and zero unselected leakage", async () => {
    const fixture = buildThreeSourceStudioFixture();
    const model = new DeterministicFlashcardsModel();
    const plugin = new FlashcardsGeneratorPlugin(model);

    expect(plugin.manifest.plugin_type).toBe(STUDIO_FLASHCARDS_PLUGIN_TYPE);
    const plan = plugin.triggerJob({
      notebook_id: "41000000-0000-4000-8000-000000000001",
      subtype: "default",
      params: { difficulty: "hard", card_count: "standard", focus_prompt: "Architecture & security" },
      snapshot: fixture.snapshot,
      output_language: "en-US",
    });
    expect(plan.title).toContain("Flashcards");

    const outcome = await plugin.generate({
      artifact_id: "41000000-aaaa-4000-8000-000000000001",
      notebook_id: "41000000-0000-4000-8000-000000000001",
      subtype: "default",
      params_json: plan.params_json,
      snapshot: fixture.snapshot,
      chunks: fixture.chunks,
      output_language: "en-US",
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    const payload = outcome.payload as any;
    expect(payload.target_count).toBe(20);
    expect(payload.difficulty).toBe("hard");
    expect(payload.cards.length).toBe(20);
    expect(new Set(payload.cards.map((c: any) => c.id)).size).toBe(20);
    for (const card of payload.cards) {
      expect(card.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(card.source_chunk_ids.length).toBeGreaterThanOrEqual(1);
      expect(card.citations.length).toBeGreaterThanOrEqual(1);
    }
    expect(validateFlashcardsPayload(payload, fixture.chunks, fixture.snapshot)).toBeNull();
    expect(JSON.stringify(payload)).not.toContain(STUDIO_LEAK_PROBE);

    // fewer -> 10, more -> up to 35 (with insufficient_evidence_note if < 35)
    const fewerOutcome = await generateFlashcards({
      chunks: fixture.chunks,
      snapshot: fixture.snapshot,
      model,
      card_count: "fewer",
      difficulty: "easy",
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });
    expect(fewerOutcome.status).toBe("completed");
    if (fewerOutcome.status === "completed") {
      expect((fewerOutcome.payload as any).target_count).toBe(10);
      expect((fewerOutcome.payload as any).cards.length).toBe(10);
    }
  });

  it("produces fewer cards with insufficient_evidence_note on brief (<300 words) sources and refuses on zero readable chunks", async () => {
    const src = makeStudioSourceId(5);
    const shortChunks = [
      makeStudioChunk(51, src, "Regional API runs in europe-west4. PostgreSQL stores metadata."),
    ];
    const snapshot = [{ source_id: src, revision: 1 }];
    const model = new DeterministicFlashcardsModel();

    const brief = await generateFlashcards({
      chunks: shortChunks,
      snapshot,
      model,
      card_count: "standard",
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });
    expect(brief.status).toBe("completed");
    if (brief.status === "completed") {
      const p = brief.payload as any;
      expect(p.cards.length).toBeLessThan(20);
      expect(p.insufficient_evidence_note).toBeTruthy();
      expect(validateFlashcardsPayload(p, shortChunks, snapshot)).toBeNull();
    }

    const empty = await generateFlashcards({
      chunks: [],
      snapshot,
      model,
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });
    expect(empty.status).toBe("refused");
    if (empty.status === "refused") {
      expect(empty.code).toBe("InsufficientEvidence");
    }
  });

  it("rejects forged or out-of-snapshot citations before publication", async () => {
    const fixture = buildThreeSourceStudioFixture();
    const model = new DeterministicFlashcardsModel();
    const outcome = await generateFlashcards({
      chunks: fixture.chunks,
      snapshot: fixture.snapshot,
      model,
      card_count: "fewer",
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    const forged = structuredClone(outcome.payload) as any;
    const out = fixture.unselectedChunks[0]!;
    forged.citations.push({
      badge_number: 999,
      source_id: out.source_id,
      chunk_id: out.chunk_id,
      revision: 1,
      snippet: out.text,
    });
    expect(validateFlashcardsPayload(forged, fixture.chunks, fixture.snapshot)).not.toBeNull();
  });
});
