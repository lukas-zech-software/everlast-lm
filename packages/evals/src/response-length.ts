import type { GoldenCaseV1 } from "./dataset.ts";

/**
 * Response-length release metric (FR-GC-07, FR-012; Package 2.2 card). Measured once per release gate on the
 * fixed stratified 50-case sample (Constitution v2.0.0), on cases whose sources support a longer answer:
 * `Shorter` answers average <= 50 % and `Longer` answers >= 150 % of the `Default` answer token count for the
 * same question. Without the judged runner (Vertex AI model) the metric is UNAVAILABLE, never passed.
 *
 * Eligibility (live Gate v2.0 run, 2026-10-20; spec 006 FR-012): a case whose `Default` answer is a refusal does
 * not "support a longer answer" and is excluded (recorded in `excluded_case_ids`, Shorter/Longer not run). No
 * eligible case left → fail closed. A Shorter or Longer refusal where Default answered fails closed: a length
 * preference must never change grounding (FR-GC-01/02).
 */

export type ResponseLength = "default" | "shorter" | "longer";

export const RESPONSE_LENGTH_THRESHOLDS = { shorter_max_ratio: 0.5, longer_min_ratio: 1.5 } as const;

/** Recorded in the gate report so a release run is reproducible. */
export const RESPONSE_LENGTH_GENERATION_PARAMETERS = {
  style: "default",
  lengths: ["default", "shorter", "longer"],
  token_count: "Intl.Segmenter word-like segments, citation badges removed",
  history: "none (empty thread per answer)",
  aggregation: "mean of per-case ratios",
  eligibility: "answerable synthesis cases; Default refusals excluded (excluded_case_ids)",
} as const;

export interface ResponseLengthSample {
  case_id: string;
  default_tokens: number;
  shorter_tokens: number;
  longer_tokens: number;
  shorter_refused?: boolean;
  longer_refused?: boolean;
}

export interface ResponseLengthMetric {
  name: "response_length";
  status: "pass" | "fail" | "unavailable";
  passed: boolean;
  shorter_ratio: number | null;
  longer_ratio: number | null;
  case_ids: string[];
  /** Eligible cases excluded because their Default answer was a refusal. */
  excluded_case_ids: string[];
  samples: ResponseLengthSample[];
  generation_parameters: typeof RESPONSE_LENGTH_GENERATION_PARAMETERS;
  detail?: string;
}

/** Answers one case's question with the given response length (production chat pipeline in release runs); `null` = refusal. */
export interface ResponseLengthRunner {
  answer(testCase: GoldenCaseV1, length: ResponseLength): Promise<string | null>;
}

/** Cases whose sources support a longer answer: answerable multi-document synthesis cases. */
export function responseLengthEligible(cases: GoldenCaseV1[]): GoldenCaseV1[] {
  return cases.filter((c) => c.answerable && c.category === "synthesis");
}

const segmenter = new Intl.Segmenter("en", { granularity: "word" });

export function countResponseTokens(text: string): number {
  let count = 0;
  for (const part of segmenter.segment(text.replace(/\[\d+\]/g, " "))) if (part.isWordLike) count += 1;
  return count;
}

export function computeResponseLengthMetric(
  samples: ResponseLengthSample[] | null,
  unavailable = "UNAVAILABLE: response-length metric requires the judged release runner (Vertex AI model)",
  excluded_case_ids: string[] = []
): ResponseLengthMetric {
  const base = { name: "response_length" as const, generation_parameters: RESPONSE_LENGTH_GENERATION_PARAMETERS, excluded_case_ids };
  if (samples === null) return { ...base, status: "unavailable", passed: false, shorter_ratio: null, longer_ratio: null, case_ids: [], samples: [], detail: unavailable };
  const case_ids = samples.map((s) => s.case_id);
  const failed = (detail: string): ResponseLengthMetric => ({ ...base, status: "fail", passed: false, shorter_ratio: null, longer_ratio: null, case_ids, samples, detail });
  if (samples.length === 0) return failed(`no eligible case (fails closed; ${excluded_case_ids.length} excluded for a Default refusal)`);
  // Zero denominators fail closed (an empty Default answer cannot show the ratio).
  if (samples.some((s) => s.default_tokens <= 0)) return failed("zero Default token count (fails closed)");
  const refused = samples.filter((s) => s.shorter_refused || s.longer_refused).map((s) => s.case_id);
  if (refused.length) return failed(`Shorter/Longer refusal where Default answered (fails closed): ${refused.join(", ")}`);
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const shorter_ratio = mean(samples.map((s) => s.shorter_tokens / s.default_tokens));
  const longer_ratio = mean(samples.map((s) => s.longer_tokens / s.default_tokens));
  const passed = shorter_ratio <= RESPONSE_LENGTH_THRESHOLDS.shorter_max_ratio && longer_ratio >= RESPONSE_LENGTH_THRESHOLDS.longer_min_ratio;
  return { ...base, status: passed ? "pass" : "fail", passed, shorter_ratio, longer_ratio, case_ids, samples };
}

/** Runs Default, then Shorter and Longer for each eligible case of the release sample; null runner → UNAVAILABLE. */
export async function runResponseLengthEval(runner: ResponseLengthRunner | null, releaseCases: GoldenCaseV1[]): Promise<ResponseLengthMetric> {
  if (!runner) return computeResponseLengthMetric(null);
  const samples: ResponseLengthSample[] = [];
  const excluded: string[] = [];
  for (const testCase of responseLengthEligible(releaseCases)) {
    const defaultAnswer = await runner.answer(testCase, "default");
    if (defaultAnswer === null) {
      excluded.push(testCase.id);
      continue;
    }
    const shorter = await runner.answer(testCase, "shorter");
    const longer = await runner.answer(testCase, "longer");
    samples.push({
      case_id: testCase.id,
      default_tokens: countResponseTokens(defaultAnswer),
      shorter_tokens: countResponseTokens(shorter ?? ""),
      longer_tokens: countResponseTokens(longer ?? ""),
      ...(shorter === null ? { shorter_refused: true } : {}),
      ...(longer === null ? { longer_refused: true } : {}),
    });
  }
  return computeResponseLengthMetric(samples, undefined, excluded);
}
