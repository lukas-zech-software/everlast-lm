import { describe, expect, it } from "vitest";
import { STUDIO_QUIZ_PLUGIN_TYPE, StudioQuizPayloadSchema } from "@everlast/contracts";
import {
  buildThreeSourceStudioFixture,
  makeStudioChunk,
  makeStudioSourceId,
  STUDIO_LEAK_PROBE,
} from "@everlast/testkit/studio-structure-fixtures";
import { DeterministicQuizModel } from "../src/studio/quizzes/model.ts";
import { generateQuiz } from "../src/studio/quizzes/pipeline.ts";
import { QuizGeneratorPlugin } from "../src/studio/quizzes/plugin.ts";
import { validateQuizPayload } from "../src/studio/quizzes/validation.ts";

/**
 * [014-studio-active-learning-suite] T014 — Quiz pipeline & validator unit tests
 * (FR-ST-14, C-02, C-03, NFR-EVAL-02/04, Gate v4.0 #1).
 */

describe("[014-studio-active-learning-suite] T014: Quiz worker pipeline, all four question formats, bounds, and citation validation", () => {
  it("generates all four question formats (MC, MS, fill_in_the_blank, short_answer) within 5..25 bounds with zero unselected leakage", async () => {
    const fixture = buildThreeSourceStudioFixture();
    const model = new DeterministicQuizModel();
    const plugin = new QuizGeneratorPlugin(model);

    expect(plugin.manifest.plugin_type).toBe(STUDIO_QUIZ_PLUGIN_TYPE);
    const plan = plugin.triggerJob({
      notebook_id: "41000000-0000-4000-8000-000000000001",
      subtype: "default",
      params: { question_count: 10, difficulty: "medium", focus_prompt: "Architecture and limits" },
      snapshot: fixture.snapshot,
      output_language: "en-US",
    });

    const outcome = await plugin.generate({
      artifact_id: "41000000-aaaa-4000-8000-000000000002",
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
    const payload = StudioQuizPayloadSchema.parse(outcome.payload);
    expect(payload.questions.length).toBe(10);
    const types = new Set(payload.questions.map((q) => q.type));
    expect(types.has("multiple_choice")).toBe(true);
    expect(types.has("multiple_select")).toBe(true);
    expect(types.has("fill_in_the_blank")).toBe(true);
    expect(types.has("short_answer")).toBe(true);
    expect(validateQuizPayload(payload, fixture.chunks, fixture.snapshot)).toBeNull();
    expect(JSON.stringify(payload)).not.toContain(STUDIO_LEAK_PROBE);
  });

  it("grounds a Short Answer question for the payload-limit Gherkin fixture and explains brief-source fewer counts", async () => {
    const src = makeStudioSourceId(7);
    const chunk = makeStudioChunk(71, src, "The maximum payload size is 200 megabytes.");
    const snapshot = [{ source_id: src, revision: 1 }];
    const model = new DeterministicQuizModel();

    const outcome = await generateQuiz({
      chunks: [chunk],
      snapshot,
      model,
      question_count: 5,
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    const p = StudioQuizPayloadSchema.parse(outcome.payload);
    expect(p.questions.length).toBeLessThan(5);
    expect(p.insufficient_evidence_note).toBeTruthy();
    expect(p.questions.some((q) => q.type === "short_answer" && q.rubric.includes("200"))).toBe(
      true,
    );
    expect(validateQuizPayload(p, [chunk], snapshot)).toBeNull();

    const empty = await generateQuiz({
      chunks: [],
      snapshot,
      model,
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });
    expect(empty.status).toBe("refused");
  });
});
