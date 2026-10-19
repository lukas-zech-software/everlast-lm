/**
 * Gate v1.0 metric definitions (NFR-EVAL-01..04). Zero denominators fail closed.
 */

export const THRESHOLDS = {
  hallucination_rate: { lt: 0.05 },
  citation_precision: { eq: 1 },
  semantic_support_rate: { eq: 1 },
  negative_rejection_rate: { gte: 0.99 },
  scoping_leakage_count: { eq: 0 },
} as const;

export function ratio(numerator: number, denominator: number, label: string): number {
  if (!Number.isInteger(denominator) || denominator <= 0) throw new Error(`${label}: zero or invalid denominator fails closed`);
  if (!Number.isInteger(numerator) || numerator < 0 || numerator > denominator) throw new Error(`${label}: invalid numerator ${numerator}/${denominator}`);
  return numerator / denominator;
}

export interface MetricResult {
  name: keyof typeof THRESHOLDS;
  value: number | null;
  passed: boolean;
  status: "pass" | "fail" | "unavailable";
  numerator?: number;
  denominator?: number;
  failing_cases: string[];
  detail?: string;
}

export function judgeMetric(name: keyof typeof THRESHOLDS, value: number | null, extra: Omit<MetricResult, "name" | "value" | "passed" | "status"> & { unavailable?: string }): MetricResult {
  if (value === null) {
    return { name, value, passed: false, status: "unavailable", failing_cases: extra.failing_cases, ...(extra.unavailable ? { detail: extra.unavailable } : {}) };
  }
  const t = THRESHOLDS[name] as { lt?: number; eq?: number; gte?: number };
  const passed = t.lt !== undefined ? value < t.lt : t.gte !== undefined ? value >= t.gte : value === t.eq;
  const { unavailable: _u, ...rest } = extra;
  return { name, value, passed, status: passed ? "pass" : "fail", ...rest };
}

/** Case-insensitive whole-token match used for forbidden-string leakage checks. */
export function containsForbidden(text: string, forbidden: string): boolean {
  const escaped = forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}
