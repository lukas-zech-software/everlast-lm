import { describe, it, expect } from "vitest";
import {
  ViewportBreakpointSchema,
  WorkspaceViewStateSchema,
  GoldenCaseSchema,
  EvalMetricsSchema,
  ReleaseGateStatusSchema,
  ReleaseGateReportSchema,
  getViewportBreakpoint,
  evaluateGateMetrics,
  type ViewportBreakpoint,
  type WorkspaceViewState,
  type GoldenCase,
  type EvalMetrics,
  type ReleaseGateReport,
} from "../src/index.js";

describe("Package 1.4 Contracts: UI Skeleton & Quality Gates (FR-UI-01, NFR-EVAL-01..04, NFR-SEC-01, Gate v1.0)", () => {
  const validUuid1 = "11111111-1111-4111-8111-111111111111";
  const validUuid2 = "22222222-2222-4222-8222-222222222222";
  const validUuid3 = "33333333-3333-4333-8333-333333333333";

  describe("1. ViewportBreakpoint & getViewportBreakpoint (FR-UI-01)", () => {
    it("accepts all valid breakpoint enum values", () => {
      expect(ViewportBreakpointSchema.parse("desktop_wide")).toBe("desktop_wide");
      expect(ViewportBreakpointSchema.parse("desktop_compact")).toBe("desktop_compact");
      expect(ViewportBreakpointSchema.parse("tablet_mobile")).toBe("tablet_mobile");
    });

    it("rejects invalid breakpoint strings", () => {
      expect(() => ViewportBreakpointSchema.parse("desktop")).toThrow();
      expect(() => ViewportBreakpointSchema.parse("mobile")).toThrow();
      expect(() => ViewportBreakpointSchema.parse("")).toThrow();
    });

    it("correctly resolves viewport width to breakpoints per FR-UI-01", () => {
      // Desktop wide >= 1280px
      expect(getViewportBreakpoint(1920)).toBe("desktop_wide");
      expect(getViewportBreakpoint(1280)).toBe("desktop_wide");

      // Desktop compact 1024 - 1279px
      expect(getViewportBreakpoint(1279)).toBe("desktop_compact");
      expect(getViewportBreakpoint(1024)).toBe("desktop_compact");

      // Tablet/Mobile < 1024px
      expect(getViewportBreakpoint(1023)).toBe("tablet_mobile");
      expect(getViewportBreakpoint(768)).toBe("tablet_mobile");
      expect(getViewportBreakpoint(320)).toBe("tablet_mobile");
    });

    it("rejects invalid viewport widths (negative or non-finite)", () => {
      expect(() => getViewportBreakpoint(-1)).toThrow();
      expect(() => getViewportBreakpoint(NaN)).toThrow();
    });
  });

  describe("2. WorkspaceViewState (FR-UI-01)", () => {
    const validViewState: WorkspaceViewState = {
      active_notebook_id: validUuid1,
      active_tab: "chat",
      left_collapsed: false,
      right_collapsed: false,
      inspector_open: false,
      inspector_source_id: null,
      highlight_chunk_id: null,
    };

    it("accepts a valid workspace view state", () => {
      const parsed = WorkspaceViewStateSchema.parse(validViewState);
      expect(parsed).toEqual(validViewState);
    });

    it("applies source-defined defaults when optional fields omitted", () => {
      const parsed = WorkspaceViewStateSchema.parse({
        active_notebook_id: validUuid1,
      });
      expect(parsed.active_tab).toBe("chat");
      expect(parsed.left_collapsed).toBe(false);
      expect(parsed.right_collapsed).toBe(false);
      expect(parsed.inspector_open).toBe(false);
    });

    it("accepts all valid active tabs", () => {
      expect(WorkspaceViewStateSchema.parse({ ...validViewState, active_tab: "sources" }).active_tab).toBe("sources");
      expect(WorkspaceViewStateSchema.parse({ ...validViewState, active_tab: "chat" }).active_tab).toBe("chat");
      expect(WorkspaceViewStateSchema.parse({ ...validViewState, active_tab: "studio" }).active_tab).toBe("studio");
    });

    it("rejects invalid active tabs", () => {
      expect(() => WorkspaceViewStateSchema.parse({ ...validViewState, active_tab: "settings" })).toThrow();
      expect(() => WorkspaceViewStateSchema.parse({ ...validViewState, active_tab: "notes" })).toThrow();
    });

    it("rejects non-UUID strings for notebook, source, and chunk IDs", () => {
      expect(() =>
        WorkspaceViewStateSchema.parse({ ...validViewState, active_notebook_id: "not-a-uuid" })
      ).toThrow();
      expect(() =>
        WorkspaceViewStateSchema.parse({ ...validViewState, inspector_source_id: "not-a-uuid" })
      ).toThrow();
      expect(() =>
        WorkspaceViewStateSchema.parse({ ...validViewState, highlight_chunk_id: "not-a-uuid" })
      ).toThrow();
    });

    it("rejects unknown extra properties (strict schema)", () => {
      const extra = { ...validViewState, unknown_property: "disallowed" };
      expect(() => WorkspaceViewStateSchema.parse(extra)).toThrow();
    });
  });

  describe("3. GoldenCase (NFR-EVAL-01..04, C-02)", () => {
    const validCase: GoldenCase = {
      id: "case-syn-001",
      category: "synthesis",
      notebook_id: validUuid1,
      active_source_ids: [validUuid2, validUuid3],
      question: "What are the common findings across both studies?",
      expected_claims: ["Finding A supported by study 1", "Finding B supported by study 2"],
      forbidden_strings: ["Unrelated confidential topic"],
      expected_unanswerable: false,
    };

    it("accepts valid golden case across categories", () => {
      expect(GoldenCaseSchema.parse(validCase)).toEqual(validCase);
      expect(GoldenCaseSchema.parse({ ...validCase, category: "unanswerable", expected_unanswerable: true }).category).toBe("unanswerable");
      expect(GoldenCaseSchema.parse({ ...validCase, category: "deselected_source" }).category).toBe("deselected_source");
      expect(GoldenCaseSchema.parse({ ...validCase, category: "adversarial" }).category).toBe("adversarial");
    });

    it("rejects invalid categories", () => {
      expect(() => GoldenCaseSchema.parse({ ...validCase, category: "general_chat" })).toThrow();
      expect(() => GoldenCaseSchema.parse({ ...validCase, category: "summarization" })).toThrow();
    });

    it("enforces explicit nonempty scope (active_source_ids must have at least 1 source)", () => {
      const emptyScope = { ...validCase, active_source_ids: [] };
      expect(() => GoldenCaseSchema.parse(emptyScope)).toThrow(/source/i);
    });

    it("rejects invalid UUIDs in notebook_id and active_source_ids", () => {
      expect(() => GoldenCaseSchema.parse({ ...validCase, notebook_id: "invalid-uuid" })).toThrow();
      expect(() => GoldenCaseSchema.parse({ ...validCase, active_source_ids: ["invalid-uuid"] })).toThrow();
    });

    it("rejects empty case ID and empty question", () => {
      expect(() => GoldenCaseSchema.parse({ ...validCase, id: "" })).toThrow();
      expect(() => GoldenCaseSchema.parse({ ...validCase, question: "" })).toThrow();
    });

    it("rejects unknown extra properties (strict schema)", () => {
      const extra = { ...validCase, extra_field: 42 };
      expect(() => GoldenCaseSchema.parse(extra)).toThrow();
    });
  });

  describe("4. EvalMetrics & evaluateGateMetrics (NFR-EVAL-01..04, Gate v1.0)", () => {
    const passingMetrics: EvalMetrics = {
      hallucination_rate: 0.02,
      citation_precision: 1.0,
      negative_rejection_rate: 0.995,
      scoping_leakage_count: 0,
    };

    it("accepts valid metrics within range", () => {
      expect(EvalMetricsSchema.parse(passingMetrics)).toEqual(passingMetrics);
    });

    it("rejects out-of-range rates and negative/fractional leakage counts", () => {
      expect(() => EvalMetricsSchema.parse({ ...passingMetrics, hallucination_rate: -0.01 })).toThrow();
      expect(() => EvalMetricsSchema.parse({ ...passingMetrics, hallucination_rate: 1.01 })).toThrow();
      expect(() => EvalMetricsSchema.parse({ ...passingMetrics, citation_precision: -0.1 })).toThrow();
      expect(() => EvalMetricsSchema.parse({ ...passingMetrics, citation_precision: 1.05 })).toThrow();
      expect(() => EvalMetricsSchema.parse({ ...passingMetrics, negative_rejection_rate: -0.05 })).toThrow();
      expect(() => EvalMetricsSchema.parse({ ...passingMetrics, negative_rejection_rate: 1.01 })).toThrow();
      expect(() => EvalMetricsSchema.parse({ ...passingMetrics, scoping_leakage_count: -1 })).toThrow();
      expect(() => EvalMetricsSchema.parse({ ...passingMetrics, scoping_leakage_count: 2.5 })).toThrow();
    });

    it("rejects unknown extra properties (strict schema)", () => {
      const extra = { ...passingMetrics, latency_ms: 120 };
      expect(() => EvalMetricsSchema.parse(extra)).toThrow();
    });

    describe("evaluateGateMetrics boundary rules", () => {
      it("passes when all criteria meet the Gate v1.0 requirements", () => {
        const result = evaluateGateMetrics(passingMetrics);
        expect(result.passed).toBe(true);
        expect(result.failures).toHaveLength(0);
      });

      it("fails when hallucination_rate >= 0.05 (0.05 fails, 0.049 passes)", () => {
        const boundaryFail = evaluateGateMetrics({ ...passingMetrics, hallucination_rate: 0.05 });
        expect(boundaryFail.passed).toBe(false);
        expect(boundaryFail.failures.some((f) => f.includes("hallucination"))).toBe(true);

        const boundaryPass = evaluateGateMetrics({ ...passingMetrics, hallucination_rate: 0.049 });
        expect(boundaryPass.passed).toBe(true);
      });

      it("fails when citation_precision != 1.00 (0.99 fails, 1.00 passes)", () => {
        const boundaryFail = evaluateGateMetrics({ ...passingMetrics, citation_precision: 0.99 });
        expect(boundaryFail.passed).toBe(false);
        expect(boundaryFail.failures.some((f) => f.includes("citation_precision"))).toBe(true);
      });

      it("fails when negative_rejection_rate < 0.99 (0.989 fails, 0.99 passes)", () => {
        const boundaryFail = evaluateGateMetrics({ ...passingMetrics, negative_rejection_rate: 0.989 });
        expect(boundaryFail.passed).toBe(false);
        expect(boundaryFail.failures.some((f) => f.includes("negative_rejection"))).toBe(true);

        const boundaryPass = evaluateGateMetrics({ ...passingMetrics, negative_rejection_rate: 0.99 });
        expect(boundaryPass.passed).toBe(true);
      });

      it("fails when scoping_leakage_count > 0 (1 fails, 0 passes)", () => {
        const boundaryFail = evaluateGateMetrics({ ...passingMetrics, scoping_leakage_count: 1 });
        expect(boundaryFail.passed).toBe(false);
        expect(boundaryFail.failures.some((f) => f.includes("leakage"))).toBe(true);
      });
    });
  });

  describe("5. ReleaseGateReport & ReleaseGateStatus (Gate v1.0)", () => {
    const validReport: ReleaseGateReport = {
      commit_hash: "cc430e4202dfe37b6f4724d90f05172d19f5c5b7",
      timestamp: "2026-10-18T12:00:00.000Z",
      metrics: {
        hallucination_rate: 0.02,
        citation_precision: 1.0,
        negative_rejection_rate: 0.995,
        scoping_leakage_count: 0,
      },
      status: "GatePassed",
      failures: [],
    };

    it("accepts all valid gate status enum values", () => {
      expect(ReleaseGateStatusSchema.parse("GatePending")).toBe("GatePending");
      expect(ReleaseGateStatusSchema.parse("GatePassed")).toBe("GatePassed");
      expect(ReleaseGateStatusSchema.parse("GateFailed")).toBe("GateFailed");
      expect(() => ReleaseGateStatusSchema.parse("Pending")).toThrow();
    });

    it("accepts a valid GatePassed report with passing metrics and empty failures", () => {
      const parsed = ReleaseGateReportSchema.parse(validReport);
      expect(parsed).toEqual(validReport);
    });

    it("accepts a valid GateFailed report with failures list", () => {
      const failedReport: ReleaseGateReport = {
        ...validReport,
        status: "GateFailed",
        failures: ["hallucination_rate 0.06 exceeds threshold < 0.05"],
      };
      const parsed = ReleaseGateReportSchema.parse(failedReport);
      expect(parsed.status).toBe("GateFailed");
      expect(parsed.failures).toHaveLength(1);
    });

    it("rejects GatePassed status when metrics do not satisfy gate criteria", () => {
      const inconsistentReport = {
        ...validReport,
        status: "GatePassed",
        metrics: {
          ...validReport.metrics,
          hallucination_rate: 0.08, // Fails gate threshold!
        },
      };
      expect(() => ReleaseGateReportSchema.parse(inconsistentReport)).toThrow();
    });

    it("rejects GatePassed status when failures list is nonempty", () => {
      const inconsistentReport = {
        ...validReport,
        status: "GatePassed",
        failures: ["Some failure occurred"],
      };
      expect(() => ReleaseGateReportSchema.parse(inconsistentReport)).toThrow();
    });

    it("rejects GateFailed status when failures list is empty", () => {
      const inconsistentReport = {
        ...validReport,
        status: "GateFailed",
        failures: [],
      };
      expect(() => ReleaseGateReportSchema.parse(inconsistentReport)).toThrow();
    });

    it("rejects invalid commit_hash, non-ISO timestamp, or extra unknown properties", () => {
      expect(() => ReleaseGateReportSchema.parse({ ...validReport, commit_hash: "" })).toThrow();
      expect(() => ReleaseGateReportSchema.parse({ ...validReport, timestamp: "invalid-date" })).toThrow();
      expect(() => ReleaseGateReportSchema.parse({ ...validReport, extra_data: true })).toThrow();
    });
  });
});
