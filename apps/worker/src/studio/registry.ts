import { StudioPluginRegistry } from "@everlast/contracts";
import type { StructuredGenerator } from "@everlast/cloud";
import type { EvidenceBatchLimits } from "./evidence.ts";
import {
  DeterministicMindmapModel,
  VertexMindmapModel,
  type MindmapModelClient,
} from "./mindmaps/model.ts";
import { MindmapGeneratorPlugin } from "./mindmaps/plugin.ts";
import type { BatchLimits } from "./reports/batching.ts";
import { DeterministicReportModel } from "./reports/deterministic-model.ts";
import type { ReportModelClient } from "./reports/model.ts";
import { ReportGeneratorPlugin } from "./reports/plugin.ts";
import {
  DeterministicDataTableModel,
  VertexDataTableModel,
  type DataTableModelClient,
} from "./tables/model.ts";
import { DataTableGeneratorPlugin } from "./tables/plugin.ts";
import {
  DeterministicFlashcardsModel,
  VertexFlashcardsModel,
  type FlashcardsModelClient,
} from "./flashcards/model.ts";
import { FlashcardsGeneratorPlugin } from "./flashcards/plugin.ts";
import { DeterministicQuizModel, VertexQuizModel, type QuizModelClient } from "./quizzes/model.ts";
import { QuizGeneratorPlugin } from "./quizzes/plugin.ts";
import {
  DeterministicLearningOverviewModel,
  VertexLearningOverviewModel,
  type LearningOverviewModelClient,
} from "./learning-overview/model.ts";
import { LearningOverviewGeneratorPlugin } from "./learning-overview/plugin.ts";
import {
  DeterministicSlideDeckModel,
  VertexSlideDeckModel,
  type SlideDeckModelClient,
} from "./slides/model.ts";
import { SlideDeckGeneratorPlugin } from "./slides/plugin.ts";
import {
  DeterministicInfographicModel,
  VertexInfographicModel,
  type InfographicModelClient,
} from "./infographics/model.ts";
import { InfographicGeneratorPlugin } from "./infographics/plugin.ts";

/**
 * [011-studio-mindmaps-data-tables] T020, T043, [014-studio-active-learning-suite] T011, T017, T027,
 * and [015-studio-visuals-presentations] T011, T018
 * Typed Studio plugin registry factory registering `report/*`, `mindmap/default`, `data_table/default`,
 * `flashcards/default`, `quiz/default`, `learning_overview/default`, `slide_deck/default`, and `infographic/default` (C-03).
 */
export interface StudioRegistryOptions {
  reportModel?: ReportModelClient | undefined;
  reportLimits?: BatchLimits | undefined;
  structureGenerator?: StructuredGenerator | undefined;
  mindmapModel?: MindmapModelClient | undefined;
  mindmapLimits?: EvidenceBatchLimits | undefined;
  dataTableModel?: DataTableModelClient | undefined;
  dataTableLimits?: EvidenceBatchLimits | undefined;
  flashcardsModel?: FlashcardsModelClient | undefined;
  flashcardsLimits?: EvidenceBatchLimits | undefined;
  quizModel?: QuizModelClient | undefined;
  quizLimits?: EvidenceBatchLimits | undefined;
  learningOverviewModel?: LearningOverviewModelClient | undefined;
  learningOverviewLimits?: EvidenceBatchLimits | undefined;
  slideDeckModel?: SlideDeckModelClient | undefined;
  slideDeckLimits?: EvidenceBatchLimits | undefined;
  infographicModel?: InfographicModelClient | undefined;
  infographicLimits?: EvidenceBatchLimits | undefined;
}

export function createStudioPluginRegistry(
  options: StudioRegistryOptions = {},
): StudioPluginRegistry {
  const { structureGenerator } = options;
  const mindmapModel =
    options.mindmapModel ??
    (structureGenerator
      ? new VertexMindmapModel(structureGenerator)
      : new DeterministicMindmapModel());
  const dataTableModel =
    options.dataTableModel ??
    (structureGenerator
      ? new VertexDataTableModel(structureGenerator)
      : new DeterministicDataTableModel());
  const flashcardsModel =
    options.flashcardsModel ??
    (structureGenerator
      ? new VertexFlashcardsModel(structureGenerator)
      : new DeterministicFlashcardsModel());
  const quizModel =
    options.quizModel ??
    (structureGenerator ? new VertexQuizModel(structureGenerator) : new DeterministicQuizModel());
  const learningOverviewModel =
    options.learningOverviewModel ??
    (structureGenerator
      ? new VertexLearningOverviewModel(structureGenerator)
      : new DeterministicLearningOverviewModel());
  const slideDeckModel =
    options.slideDeckModel ??
    (structureGenerator
      ? new VertexSlideDeckModel(structureGenerator)
      : new DeterministicSlideDeckModel());
  const infographicModel =
    options.infographicModel ??
    (structureGenerator
      ? new VertexInfographicModel(structureGenerator)
      : new DeterministicInfographicModel());
  const registry = new StudioPluginRegistry();
  registry.register(
    new ReportGeneratorPlugin(
      options.reportModel ?? new DeterministicReportModel(),
      options.reportLimits,
    ),
  );
  registry.register(new MindmapGeneratorPlugin(mindmapModel, options.mindmapLimits));
  registry.register(new DataTableGeneratorPlugin(dataTableModel, options.dataTableLimits));
  registry.register(new FlashcardsGeneratorPlugin(flashcardsModel, options.flashcardsLimits));
  registry.register(new QuizGeneratorPlugin(quizModel, options.quizLimits));
  registry.register(
    new LearningOverviewGeneratorPlugin(learningOverviewModel, options.learningOverviewLimits),
  );
  registry.register(new SlideDeckGeneratorPlugin(slideDeckModel, options.slideDeckLimits));
  registry.register(new InfographicGeneratorPlugin(infographicModel, options.infographicLimits));
  return registry;
}
