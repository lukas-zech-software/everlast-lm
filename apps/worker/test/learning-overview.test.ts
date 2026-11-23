import { describe, expect, it } from "vitest";
import { STUDIO_LEARNING_OVERVIEW_PLUGIN_TYPE, validateSafeDeterministicSvg } from "@everlast/contracts";
import {
  buildThreeSourceStudioFixture,
  STUDIO_LEAK_PROBE,
} from "@everlast/testkit/studio-structure-fixtures";
import {
  DeterministicLearningOverviewModel,
  type LearningOverviewModelClient,
} from "../src/studio/learning-overview/model.ts";
import { generateLearningOverview } from "../src/studio/learning-overview/pipeline.ts";
import { LearningOverviewGeneratorPlugin } from "../src/studio/learning-overview/plugin.ts";
import { validateLearningOverviewPayload } from "../src/studio/learning-overview/validation.ts";

/**
 * [014-studio-active-learning-suite] T024 — Learning Overview pipeline, D9 SVG validation & atomic failure tests
 * (FR-ST-12, C-03, D9, NFR-EVAL-02/04).
 */

describe("[014-studio-active-learning-suite] T024: Learning Overview composite modules, D9 SVG safety, and atomic failure", () => {
  it("generates 3..6 grounded composite modules with summary_md, safe D9 SVG diagrams, embedded flashcards, and checkpoint quizzes", async () => {
    const fixture = buildThreeSourceStudioFixture();
    const model = new DeterministicLearningOverviewModel();
    const plugin = new LearningOverviewGeneratorPlugin(model);

    expect(plugin.manifest.plugin_type).toBe(STUDIO_LEARNING_OVERVIEW_PLUGIN_TYPE);
    const plan = plugin.triggerJob({
      notebook_id: "41000000-0000-4000-8000-000000000001",
      subtype: "default",
      params: { section_count: 3 },
      snapshot: fixture.snapshot,
      output_language: "en-US",
    });

    const outcome = await plugin.generate({
      artifact_id: "41000000-aaaa-4000-8000-000000000003",
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
    const p = outcome.payload as any;
    expect(p.modules.length).toBe(3);
    for (const mod of p.modules) {
      expect(mod.summary_md).toMatch(/\[\d+\]/);
      expect(validateSafeDeterministicSvg(mod.diagram_svg).valid).toBe(true);
      expect(mod.flashcards.length).toBeGreaterThanOrEqual(1);
      expect(mod.checkpoint_quiz.length).toBeGreaterThanOrEqual(1);
    }
    expect(validateLearningOverviewPayload(p, fixture.chunks, fixture.snapshot)).toBeNull();
    expect(JSON.stringify(p)).not.toContain(STUDIO_LEAK_PROBE);
  });

  it("fails atomically when any required block (diagram SVG, flashcards, or checkpoint quiz) fails without publishing an incomplete lesson", async () => {
    const fixture = buildThreeSourceStudioFixture();
    const base = new DeterministicLearningOverviewModel();
    const brokenDiagramModel: LearningOverviewModelClient = {
      id: "broken-diagram-model",
      extract: (req) => base.extract(req),
      async compose(req) {
        const payload = await base.compose(req);
        // Corrupt the first module's required diagram block with forbidden script markup
        payload.modules[0]!.diagram_svg = '<svg viewBox="0 0 100 100"><script>alert(1)</script></svg>';
        return payload;
      },
    };

    const refused = await generateLearningOverview({
      chunks: fixture.chunks,
      snapshot: fixture.snapshot,
      model: brokenDiagramModel,
      section_count: 3,
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });

    expect(refused.status).toBe("refused");
    if (refused.status === "refused") {
      expect(["GenerationError", "CitationValidationFailed"]).toContain(refused.code);
    }

    // Empty checkpoint quiz block also fails atomically
    const missingQuizModel: LearningOverviewModelClient = {
      id: "missing-quiz-model",
      extract: (req) => base.extract(req),
      async compose(req) {
        const payload = await base.compose(req);
        payload.modules[0]!.checkpoint_quiz = [];
        return payload;
      },
    };
    const refusedQuiz = await generateLearningOverview({
      chunks: fixture.chunks,
      snapshot: fixture.snapshot,
      model: missingQuizModel,
      section_count: 3,
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });
    expect(refusedQuiz.status).toBe("refused");
  });
});
