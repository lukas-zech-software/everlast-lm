import { z } from "zod";

/**
 * Package 1.4 DTOs and Schemas (UI Skeleton & Quality Gates)
 * FR-UI-01, NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01, C-01, C-02, Gate v1.0
 */

export const ViewportBreakpointSchema = z.enum([
  "desktop_wide",
  "desktop_compact",
  "tablet_mobile",
]);
export type ViewportBreakpoint = z.infer<typeof ViewportBreakpointSchema>;

/**
 * Resolves viewport width in pixels to standard responsive breakpoint per FR-UI-01:
 * - Desktop wide: >= 1280px (3 columns side-by-side, both side panels expanded)
 * - Desktop compact: 1024–1279px (3 columns, right Studio panel collapsed by default)
 * - Tablet/Mobile: < 1024px (tabbed navigation Sources | Chat | Studio)
 */
export function getViewportBreakpoint(width: number): ViewportBreakpoint {
  if (typeof width !== "number" || isNaN(width) || width < 0 || !isFinite(width)) {
    throw new Error(`Invalid viewport width: ${width}. Width must be a non-negative finite number.`);
  }
  if (width >= 1280) {
    return "desktop_wide";
  }
  if (width >= 1024) {
    return "desktop_compact";
  }
  return "tablet_mobile";
}

export const WorkspaceViewStateSchema = z
  .object({
    active_notebook_id: z.string().uuid().nullable(),
    active_tab: z.enum(["sources", "chat", "studio"]).default("chat"),
    left_collapsed: z.boolean().default(false),
    right_collapsed: z.boolean().default(false),
    inspector_open: z.boolean().default(false),
    inspector_source_id: z.string().uuid().nullable().optional().default(null),
    highlight_chunk_id: z.string().uuid().nullable().optional().default(null),
  })
  .strict();
export type WorkspaceViewState = z.infer<typeof WorkspaceViewStateSchema>;

export const GoldenCaseSchema = z
  .object({
    id: z.string().min(1),
    category: z.enum(["unanswerable", "deselected_source", "synthesis", "adversarial"]),
    notebook_id: z.string().uuid(),
    active_source_ids: z.array(z.string().uuid()).min(1, "active_source_ids must contain at least 1 source"),
    question: z.string().min(1),
    expected_claims: z.array(z.string()).default([]),
    forbidden_strings: z.array(z.string()).default([]),
    expected_unanswerable: z.boolean().default(false),
  })
  .strict();
export type GoldenCase = z.infer<typeof GoldenCaseSchema>;

export const EvalMetricsSchema = z
  .object({
    hallucination_rate: z.number().min(0).max(1),
    citation_precision: z.number().min(0).max(1),
    negative_rejection_rate: z.number().min(0).max(1),
    scoping_leakage_count: z.number().int().nonnegative(),
  })
  .strict();
export type EvalMetrics = z.infer<typeof EvalMetricsSchema>;

export interface GateEvaluationResult {
  passed: boolean;
  failures: string[];
}

/**
 * Validates evaluation metrics against binding Gate v1.0 release thresholds:
 * - NFR-EVAL-01: epsilon_hallucination < 0.05 (0.05 fails)
 * - NFR-EVAL-02: Precision_ID = 1.00 (0.99 fails)
 * - NFR-EVAL-03: Negative Rejection Rate >= 0.99 (0.989 fails, 0.99 passes)
 * - NFR-EVAL-04: Scoping Leakage = 0 chunks (1 fails)
 */
export function evaluateGateMetrics(metrics: EvalMetrics): GateEvaluationResult {
  const failures: string[] = [];

  if (metrics.hallucination_rate >= 0.05) {
    failures.push(
      `hallucination_rate ${metrics.hallucination_rate} exceeds threshold < 0.05 (NFR-EVAL-01)`
    );
  }

  if (metrics.citation_precision !== 1.0) {
    failures.push(
      `citation_precision ${metrics.citation_precision} does not meet required 1.00 (NFR-EVAL-02)`
    );
  }

  if (metrics.negative_rejection_rate < 0.99) {
    failures.push(
      `negative_rejection_rate ${metrics.negative_rejection_rate} does not meet required >= 0.99 (NFR-EVAL-03)`
    );
  }

  if (metrics.scoping_leakage_count > 0) {
    failures.push(
      `scoping_leakage_count ${metrics.scoping_leakage_count} exceeds required 0 chunks (NFR-EVAL-04)`
    );
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}

export const ReleaseGateStatusSchema = z.enum(["GatePending", "GatePassed", "GateFailed"]);
export type ReleaseGateStatus = z.infer<typeof ReleaseGateStatusSchema>;

export const ReleaseGateReportSchema = z
  .object({
    commit_hash: z.string().min(1),
    timestamp: z.string().datetime(),
    metrics: EvalMetricsSchema,
    status: ReleaseGateStatusSchema,
    failures: z.array(z.string()).default([]),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.status === "GatePassed") {
      const evalResult = evaluateGateMetrics(data.metrics);
      if (!evalResult.passed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Cannot pass Gate v1.0 with failing metrics: ${evalResult.failures.join("; ")}`,
          path: ["metrics"],
        });
      }
      if (data.failures.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `GatePassed status requires empty failures list, but found ${data.failures.length} failure(s)`,
          path: ["failures"],
        });
      }
    } else if (data.status === "GateFailed") {
      if (data.failures.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `GateFailed status requires at least one recorded failure reason`,
          path: ["failures"],
        });
      }
    }
  });
export type ReleaseGateReport = z.infer<typeof ReleaseGateReportSchema>;
