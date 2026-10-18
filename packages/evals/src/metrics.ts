import { EvalMetricsSchema, type EvalMetrics } from "@everlast/contracts";

/**
 * Metric calculators enforcing exact mathematical definitions for NFR-EVAL-01..04.
 * Fails closed on zero denominators or invalid parameters per contract rules.
 */

/**
 * NFR-EVAL-01: epsilon_hallucination = unsupported factual claims / all evaluated factual claims.
 * Target: <= 0.02, Gate threshold: < 0.05 (0.05 fails).
 */
export function calculateHallucinationRate(
  unsupportedClaims: number,
  totalClaims: number
): number {
  if (typeof totalClaims !== "number" || totalClaims <= 0 || !isFinite(totalClaims)) {
    throw new Error(
      `Invalid totalClaims denominator: ${totalClaims}. Empty claim sets or zero denominators fail closed.`
    );
  }
  if (typeof unsupportedClaims !== "number" || unsupportedClaims < 0 || unsupportedClaims > totalClaims) {
    throw new Error(
      `Invalid unsupportedClaims numerator: ${unsupportedClaims}. Must be between 0 and totalClaims (${totalClaims}).`
    );
  }
  return unsupportedClaims / totalClaims;
}

/**
 * NFR-EVAL-02: Precision_ID = valid scoped badges / all evaluated badges.
 * Gate threshold: = 1.00 strictly (0.99 fails).
 */
export function calculateCitationPrecision(
  validBadges: number,
  totalBadges: number
): number {
  if (typeof totalBadges !== "number" || totalBadges <= 0 || !isFinite(totalBadges)) {
    throw new Error(
      `Invalid totalBadges denominator: ${totalBadges}. Empty badge sets or zero denominators fail closed.`
    );
  }
  if (typeof validBadges !== "number" || validBadges < 0 || validBadges > totalBadges) {
    throw new Error(
      `Invalid validBadges numerator: ${validBadges}. Must be between 0 and totalBadges (${totalBadges}).`
    );
  }
  return validBadges / totalBadges;
}

/**
 * NFR-EVAL-03: Negative Rejection Rate = correctly refused unanswerable cases / all unanswerable cases.
 * Gate threshold: >= 0.99 (0.989 fails, 0.99 passes).
 */
export function calculateNegativeRejectionRate(
  refusedCases: number,
  totalUnanswerableCases: number
): number {
  if (
    typeof totalUnanswerableCases !== "number" ||
    totalUnanswerableCases <= 0 ||
    !isFinite(totalUnanswerableCases)
  ) {
    throw new Error(
      `Invalid totalUnanswerableCases denominator: ${totalUnanswerableCases}. Zero denominators fail closed.`
    );
  }
  if (
    typeof refusedCases !== "number" ||
    refusedCases < 0 ||
    refusedCases > totalUnanswerableCases
  ) {
    throw new Error(
      `Invalid refusedCases numerator: ${refusedCases}. Must be between 0 and totalUnanswerableCases (${totalUnanswerableCases}).`
    );
  }
  return refusedCases / totalUnanswerableCases;
}

/**
 * NFR-EVAL-04: Scoping Leakage = number of chunks from deselected or unauthorized sources.
 * Gate threshold: = 0 chunks strictly (1 fails).
 */
export function calculateScopingLeakage(leakedChunks: number): number {
  if (
    typeof leakedChunks !== "number" ||
    leakedChunks < 0 ||
    !Number.isInteger(leakedChunks)
  ) {
    throw new Error(
      `Invalid leakedChunks count: ${leakedChunks}. Must be a non-negative integer.`
    );
  }
  return leakedChunks;
}

export interface MetricInputs {
  unsupportedClaims: number;
  totalClaims: number;
  validBadges: number;
  totalBadges: number;
  refusedUnanswerableCases: number;
  totalUnanswerableCases: number;
  leakedChunks: number;
}

export function computeEvalMetrics(inputs: MetricInputs): EvalMetrics {
  const metrics = {
    hallucination_rate: calculateHallucinationRate(
      inputs.unsupportedClaims,
      inputs.totalClaims
    ),
    citation_precision: calculateCitationPrecision(
      inputs.validBadges,
      inputs.totalBadges
    ),
    negative_rejection_rate: calculateNegativeRejectionRate(
      inputs.refusedUnanswerableCases,
      inputs.totalUnanswerableCases
    ),
    scoping_leakage_count: calculateScopingLeakage(inputs.leakedChunks),
  };

  return EvalMetricsSchema.parse(metrics);
}
