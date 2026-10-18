import { describe, it, expect } from "vitest";
import {
  calculateHallucinationRate,
  calculateCitationPrecision,
  calculateNegativeRejectionRate,
  calculateScopingLeakage,
} from "../src/metrics.js";
import { evaluateGateMetrics, type EvalMetrics } from "@everlast/contracts";

describe("T013 [US2] Boundary & Error: Evaluation Gates (NFR-EVAL-01..04, Gate v1.0)", () => {
  const basePassingMetrics: EvalMetrics = {
    hallucination_rate: 0.02,
    citation_precision: 1.0,
    negative_rejection_rate: 0.995,
    scoping_leakage_count: 0,
  };

  describe("Metric Calculation Boundaries & Zero Denominators", () => {
    it("calculateHallucinationRate: computes unsupported / total claims, throws on 0 denominator", () => {
      expect(calculateHallucinationRate(1, 50)).toBeCloseTo(0.02);
      expect(calculateHallucinationRate(0, 100)).toBe(0);
      expect(() => calculateHallucinationRate(0, 0)).toThrow(/denominator/i);
    });

    it("calculateCitationPrecision: computes valid / total badges, throws on 0 denominator", () => {
      expect(calculateCitationPrecision(100, 100)).toBe(1.0);
      expect(calculateCitationPrecision(99, 100)).toBe(0.99);
      expect(() => calculateCitationPrecision(0, 0)).toThrow(/denominator/i);
    });

    it("calculateNegativeRejectionRate: computes refused / total unanswerable cases, throws on 0 denominator", () => {
      expect(calculateNegativeRejectionRate(99, 100)).toBe(0.99);
      expect(calculateNegativeRejectionRate(100, 100)).toBe(1.0);
      expect(() => calculateNegativeRejectionRate(0, 0)).toThrow(/denominator/i);
    });

    it("calculateScopingLeakage: non-negative integer check", () => {
      expect(calculateScopingLeakage(0)).toBe(0);
      expect(calculateScopingLeakage(3)).toBe(3);
      expect(() => calculateScopingLeakage(-1)).toThrow();
    });
  });

  describe("Exact Inequality Pass/Fail Boundaries (Gate v1.0 #2)", () => {
    it("hallucination rate: < 0.05 strictly (0.05 fails, 0.049 passes, 0.051 fails)", () => {
      expect(evaluateGateMetrics({ ...basePassingMetrics, hallucination_rate: 0.05 }).passed).toBe(false);
      expect(evaluateGateMetrics({ ...basePassingMetrics, hallucination_rate: 0.051 }).passed).toBe(false);
      expect(evaluateGateMetrics({ ...basePassingMetrics, hallucination_rate: 0.049 }).passed).toBe(true);
      expect(evaluateGateMetrics({ ...basePassingMetrics, hallucination_rate: 0.02 }).passed).toBe(true);
    });

    it("citation precision: = 1.00 strictly (0.99 fails, 1.00 passes)", () => {
      expect(evaluateGateMetrics({ ...basePassingMetrics, citation_precision: 0.99 }).passed).toBe(false);
      expect(evaluateGateMetrics({ ...basePassingMetrics, citation_precision: 1.0 }).passed).toBe(true);
    });

    it("negative rejection rate: >= 0.99 (0.989 fails, 0.99 passes, 1.0 passes)", () => {
      expect(evaluateGateMetrics({ ...basePassingMetrics, negative_rejection_rate: 0.989 }).passed).toBe(false);
      expect(evaluateGateMetrics({ ...basePassingMetrics, negative_rejection_rate: 0.99 }).passed).toBe(true);
      expect(evaluateGateMetrics({ ...basePassingMetrics, negative_rejection_rate: 1.0 }).passed).toBe(true);
    });

    it("scoping leakage: = 0 strictly (1 chunk fails, 0 chunks passes)", () => {
      expect(evaluateGateMetrics({ ...basePassingMetrics, scoping_leakage_count: 1 }).passed).toBe(false);
      expect(evaluateGateMetrics({ ...basePassingMetrics, scoping_leakage_count: 0 }).passed).toBe(true);
    });
  });
});
