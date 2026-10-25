import {
  MindmapSubtypeSchema,
  STUDIO_MINDMAP_PLUGIN_TYPE,
  StudioParamsError,
  type StudioGenerationContext,
  type StudioGenerationOutcome,
  type StudioGeneratorPlugin,
  type StudioJobPlan,
  type StudioJobRequest,
} from "@everlast/contracts";
import type { EvidenceBatchLimits } from "../evidence.ts";
import { DeterministicMindmapModel, type MindmapModelClient } from "./model.ts";
import { generateMindmap } from "./pipeline.ts";

/**
 * [011-studio-mindmaps-data-tables] T019, T020 — Mindmap Studio generator plugin (`mindmap/default`)
 * (FR-ST-08, C-03; FR-001, FR-002, FR-003, FR-012, FR-013, FR-014, SC-001, SC-008).
 */
export class MindmapGeneratorPlugin implements StudioGeneratorPlugin {
  readonly manifest = {
    plugin_type: STUDIO_MINDMAP_PLUGIN_TYPE,
    display_name: "Mindmap",
    subtypes: ["default"],
  };

  private readonly model: MindmapModelClient;
  private readonly limits?: EvidenceBatchLimits | undefined;

  constructor(model: MindmapModelClient = new DeterministicMindmapModel(), limits?: EvidenceBatchLimits) {
    this.model = model;
    this.limits = limits;
  }

  triggerJob(request: StudioJobRequest): StudioJobPlan {
    const parsed = MindmapSubtypeSchema.safeParse(request.subtype);
    if (!parsed.success) {
      throw new StudioParamsError(`Unknown mindmap subtype ${request.subtype}`);
    }
    return {
      title: "Mindmap",
      params_json: {},
    };
  }

  generate(ctx: StudioGenerationContext): Promise<StudioGenerationOutcome> {
    MindmapSubtypeSchema.parse(ctx.subtype);
    return generateMindmap({
      chunks: ctx.chunks,
      snapshot: ctx.snapshot,
      model: this.model,
      output_language: ctx.output_language,
      ...(this.limits ? { limits: this.limits } : {}),
      signal: ctx.signal,
      reportProgress: ctx.reportProgress,
    });
  }
}
