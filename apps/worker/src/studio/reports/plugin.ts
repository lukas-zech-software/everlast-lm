import {
  StudioParamsError,
  STUDIO_REPORT_PLUGIN_TYPE,
  ReportSubtypeSchema,
  validateCustomReportPrompt,
  type StudioGenerationContext,
  type StudioGenerationOutcome,
  type StudioGeneratorPlugin,
  type StudioJobPlan,
  type StudioJobRequest,
} from "@everlast/contracts";
import type { BatchLimits } from "./batching.js";
import type { ReportModelClient } from "./model.js";
import { generateReport } from "./pipeline.js";
import { TEMPLATES } from "./templates.js";

export class ReportGeneratorPlugin implements StudioGeneratorPlugin {
  readonly manifest = {
    plugin_type: STUDIO_REPORT_PLUGIN_TYPE,
    display_name: "Reports",
    subtypes: ReportSubtypeSchema.options as readonly string[] as string[],
  };

  constructor(
    private readonly model: ReportModelClient,
    private readonly limits?: BatchLimits
  ) {}

  triggerJob(request: StudioJobRequest): StudioJobPlan {
    const parsed = ReportSubtypeSchema.safeParse(request.subtype);
    if (!parsed.success) throw new StudioParamsError(`Unknown report subtype ${request.subtype}`);
    const subtype = parsed.data;
    if (subtype === "dynamic" || subtype === "custom") {
      const check = validateCustomReportPrompt(request.params.custom_prompt ?? "");
      if (!check.valid) throw new StudioParamsError(check.error ?? "Invalid report prompt");
      return { title: TEMPLATES[subtype].title, params_json: { custom_prompt: check.normalized as string } };
    }
    return { title: TEMPLATES[subtype].title, params_json: {} };
  }

  generate(ctx: StudioGenerationContext): Promise<StudioGenerationOutcome> {
    const subtype = ReportSubtypeSchema.parse(ctx.subtype);
    return generateReport({
      subtype,
      chunks: ctx.chunks,
      model: this.model,
      custom_prompt: ctx.params_json.custom_prompt,
      ...(this.limits ? { limits: this.limits } : {}),
      signal: ctx.signal,
      reportProgress: ctx.reportProgress,
    });
  }
}
