import {
  DataTableSchemaIdSchema,
  DataTableSubtypeSchema,
  STUDIO_DATA_TABLE_PLUGIN_TYPE,
  StudioParamsError,
  validateDataTableFocusPrompt,
  type DataTableSchemaId,
  type StudioGenerationContext,
  type StudioGenerationOutcome,
  type StudioGeneratorPlugin,
  type StudioJobPlan,
  type StudioJobRequest,
} from "@everlast/contracts";
import type { EvidenceBatchLimits } from "../evidence.ts";
import { DeterministicDataTableModel, type DataTableModelClient } from "./model.ts";
import { generateDataTable } from "./pipeline.ts";

/**
 * [011-studio-mindmaps-data-tables] T043 — Data Table Studio generator plugin (`data_table/default`)
 * (FR-ST-18, C-03, FR-ST-10/11; FR-007, FR-010, FR-012, FR-013, FR-015, FR-017, SC-008, SC-009, SC-011).
 */
export class DataTableGeneratorPlugin implements StudioGeneratorPlugin {
  readonly manifest = {
    plugin_type: STUDIO_DATA_TABLE_PLUGIN_TYPE,
    display_name: "Data Table",
    subtypes: ["default"],
  };

  private readonly model: DataTableModelClient;
  private readonly limits?: EvidenceBatchLimits | undefined;

  constructor(model: DataTableModelClient = new DeterministicDataTableModel(), limits?: EvidenceBatchLimits) {
    this.model = model;
    this.limits = limits;
  }

  triggerJob(request: StudioJobRequest): StudioJobPlan {
    const parsedSubtype = DataTableSubtypeSchema.safeParse(request.subtype);
    if (!parsedSubtype.success) {
      throw new StudioParamsError(`Unknown data_table subtype ${request.subtype}`);
    }

    let normalizedFocus: string | undefined;
    if (request.params.focus_prompt !== undefined) {
      const check = validateDataTableFocusPrompt(request.params.focus_prompt);
      if (!check.valid) {
        throw new StudioParamsError(check.error ?? "Invalid focus_prompt");
      }
      if (check.normalized && check.normalized.length > 0) {
        normalizedFocus = check.normalized;
      }
    }

    let schemaId: DataTableSchemaId = "auto";
    if (request.params.schema_id !== undefined) {
      const parsedSchema = DataTableSchemaIdSchema.safeParse(request.params.schema_id);
      if (!parsedSchema.success) {
        throw new StudioParamsError(`Unsupported data_table schema_id: ${String(request.params.schema_id)}`);
      }
      schemaId = parsedSchema.data;
    }

    return {
      title: "Data Table",
      params_json: {
        ...(normalizedFocus !== undefined ? { focus_prompt: normalizedFocus } : {}),
        schema_id: schemaId,
      },
    };
  }

  generate(ctx: StudioGenerationContext): Promise<StudioGenerationOutcome> {
    DataTableSubtypeSchema.parse(ctx.subtype);
    const schemaId = ctx.params_json.schema_id
      ? DataTableSchemaIdSchema.parse(ctx.params_json.schema_id)
      : ("auto" as const);
    return generateDataTable({
      chunks: ctx.chunks,
      snapshot: ctx.snapshot,
      model: this.model,
      focus_prompt: ctx.params_json.focus_prompt,
      schema_id: schemaId,
      output_language: ctx.output_language,
      ...(this.limits ? { limits: this.limits } : {}),
      signal: ctx.signal,
      reportProgress: ctx.reportProgress,
    });
  }
}
