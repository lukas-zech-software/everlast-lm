import { describe, expect, it } from "vitest";
import { STUDIO_SLIDE_DECK_PLUGIN_TYPE, StudioSlideDeckPayloadSchema } from "@everlast/contracts";
import {
  buildThreeSourceStudioFixture,
  makeStudioChunk,
  makeStudioSourceId,
  STUDIO_LEAK_PROBE,
} from "@everlast/testkit/studio-structure-fixtures";
import { DeterministicSlideDeckModel } from "../src/studio/slides/model.ts";
import { generateSlideDeck } from "../src/studio/slides/pipeline.ts";
import { SlideDeckGeneratorPlugin } from "../src/studio/slides/plugin.ts";
import { validateSlideDeckPayload } from "../src/studio/slides/validation.ts";

/**
 * [015-studio-visuals-presentations] T007 — Slide Deck worker pipeline & validator unit tests
 * (FR-ST-16, C-02, C-03, NFR-EVAL-02/04, Gate v4.0 #3).
 */

describe("[015-studio-visuals-presentations] T007: Slide Deck worker pipeline, bullet caps, visual_spec IR, and citation validation", () => {
  it("generates an 8-slide deck strictly from S_aktiv across 5 layout templates with <= 5 bullets x <= 15 words and speaker_notes", async () => {
    const fixture = buildThreeSourceStudioFixture();
    const model = new DeterministicSlideDeckModel();
    const plugin = new SlideDeckGeneratorPlugin(model);

    expect(plugin.manifest.plugin_type).toBe(STUDIO_SLIDE_DECK_PLUGIN_TYPE);
    const plan = plugin.triggerJob({
      notebook_id: "42000000-0000-4000-8000-000000000001",
      subtype: "default",
      params: { slide_count: 8, focus_prompt: "Architecture and regional resilience" },
      snapshot: fixture.snapshot,
      output_language: "en-US",
    });
    expect(plan.title).toContain("Slide Deck");

    const outcome = await plugin.generate({
      artifact_id: "42000000-aaaa-4000-8000-000000000001",
      notebook_id: "42000000-0000-4000-8000-000000000001",
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
    const payload = StudioSlideDeckPayloadSchema.parse(outcome.payload);
    expect(payload.target_count).toBe(8);
    expect(payload.slides).toHaveLength(8);
    const seenLayouts = new Set<string>();
    for (const slide of payload.slides) {
      seenLayouts.add(slide.layout);
      expect(slide.visual_spec.layout).toBe(slide.layout);
      expect(slide.bullets.length).toBeGreaterThanOrEqual(1);
      expect(slide.bullets.length).toBeLessThanOrEqual(5);
      for (const bullet of slide.bullets) {
        expect(bullet.trim().split(/\s+/).length).toBeLessThanOrEqual(15);
      }
      expect(slide.speaker_notes.length).toBeGreaterThan(10);
      expect(slide.citations.length).toBeGreaterThanOrEqual(1);
    }
    expect(seenLayouts.size).toBeGreaterThanOrEqual(4);
    expect(validateSlideDeckPayload(payload, fixture.chunks, fixture.snapshot)).toBeNull();
    expect(JSON.stringify(payload)).not.toContain(STUDIO_LEAK_PROBE);
  });

  it("pushes verbose bullet overflow into speaker_notes, emits insufficient_evidence_note on brief sources, and refuses empty sources", async () => {
    const src = makeStudioSourceId(7);
    const verboseChunks = [
      makeStudioChunk(
        71,
        src,
        "The regional execution cluster processes every incoming enterprise payload securely inside europe-west4 using strict stateless container isolation and ephemeral request scoping without retaining customer keys.",
      ),
    ];
    const snapshot = [{ source_id: src, revision: 1 }];
    const model = new DeterministicSlideDeckModel();

    const brief = await generateSlideDeck({
      chunks: verboseChunks,
      snapshot,
      model,
      slide_count: 10,
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });
    expect(brief.status).toBe("completed");
    if (brief.status === "completed") {
      const p = brief.payload;
      expect(p.slides.length).toBeLessThan(10);
      expect(p.insufficient_evidence_note).toBeTruthy();
      for (const slide of p.slides) {
        expect(slide.bullets.length).toBeLessThanOrEqual(5);
        for (const bullet of slide.bullets) {
          expect(bullet.trim().split(/\s+/).length).toBeLessThanOrEqual(15);
        }
        expect(slide.speaker_notes).toContain("ephemeral request scoping");
      }
      expect(validateSlideDeckPayload(p, verboseChunks, snapshot)).toBeNull();
    }

    const empty = await generateSlideDeck({
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

  it("rejects out-of-snapshot citations before publication", async () => {
    const fixture = buildThreeSourceStudioFixture();
    const model = new DeterministicSlideDeckModel();
    const outcome = await generateSlideDeck({
      chunks: fixture.chunks,
      snapshot: fixture.snapshot,
      model,
      slide_count: 5,
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    const forged = StudioSlideDeckPayloadSchema.parse(structuredClone(outcome.payload));
    const out = fixture.unselectedChunks[0]!;
    forged.citations.push({
      badge_number: 99,
      source_id: out.source_id,
      chunk_id: out.chunk_id,
      revision: 1,
      snippet: out.text,
    });
    expect(validateSlideDeckPayload(forged, fixture.chunks, fixture.snapshot)).not.toBeNull();
  });
});
