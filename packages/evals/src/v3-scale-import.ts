import { z } from "zod";
import { BenchmarkObservationSchema, PrivateClockCalibrationSchema } from "@everlast/contracts";
import { buildScaleBenchmarkReport, type ScaleBenchmarkReport } from "./report.ts";
import { correlateScaleEvidence } from "./v3-scale.ts";
import { loadScaleFixture, type ScaleFixture } from "./v3-scale-fixture.ts";
/** NFR-EVAL-02/04: reject old bare rows, mixed fixtures and silently dropped diagnostics. */
const capture = z
  .object({
    schema: z.literal("everlast.scale-v3-capture/1"),
    profile: z.enum(["core", "concurrency"]),
    manifest_hash: z.string().regex(/^[a-f0-9]{64}$/),
    observations: z.array(BenchmarkObservationSchema).max(40),
    concurrency_observations: z.array(BenchmarkObservationSchema).length(20).optional(),
    concurrency_fixture: z.unknown().optional(),
    private_evidence: z.array(z.unknown()).max(60),
    clock_calibration: PrivateClockCalibrationSchema.optional(),
  })
  .strict();

type CapturedObservation = z.infer<typeof BenchmarkObservationSchema>;
type CapturedCalibration = z.infer<typeof PrivateClockCalibrationSchema> | undefined;

function indexPrivateEvidence(
  records: readonly unknown[],
  rows: readonly CapturedObservation[],
): Map<string, unknown> {
  const evidence = new Map<string, unknown>();
  for (const record of records) {
    const id = (record as { request_id?: unknown } | null)?.request_id;
    if (typeof id !== "string" || evidence.has(id)) {
      throw new Error("Malformed or duplicate private request evidence");
    }
    evidence.set(id, record);
  }
  const requestIds = new Set(rows.map((o) => o.request_id));
  if ([...evidence.keys()].some((id) => !requestIds.has(id))) {
    throw new Error("Unmatched private evidence");
  }
  return evidence;
}

function resolveObservationFixture(
  manifestHash: string,
  primary: ScaleFixture,
  secondary: ScaleFixture | undefined,
): ScaleFixture | null {
  if (manifestHash === primary.fixture_hash) {
    return primary;
  }
  if (secondary?.fixture_hash === manifestHash) {
    return secondary;
  }
  return null;
}

function assertObservationWithinClockInterval(
  epoch: number,
  row: CapturedObservation,
  calibration: CapturedCalibration,
): void {
  if (!calibration) {
    return;
  }
  if (
    !Number.isFinite(epoch) ||
    epoch < calibration.measured_at_ms ||
    epoch >= calibration.expires_at_ms - calibration.uncertainty_ms ||
    row.clock_uncertainty_ms !== calibration.uncertainty_ms
  ) {
    throw new Error("Observation is outside its retained clock interval");
  }
}

function assertCorrelatedEvidenceMatchesRow(
  row: CapturedObservation,
  matchedFixture: ScaleFixture,
  correlated: ReturnType<typeof correlateScaleEvidence>,
): void {
  const e = correlated.evidence;
  const mismatch =
    row.cohort !== correlated.cohort ||
    row.instance_boot_id !== (e?.instance_boot_id ?? null) ||
    row.active_token_total !== (e?.scope?.source_token_total ?? null) ||
    row.prompt_leakage_count !== (e?.prompt_leakage_count ?? null) ||
    (row.needle_correct && !row.cited_chunk_ids.includes(matchedFixture.needle_chunk_id)) ||
    (e !== null && row.principal_subject !== e.scope?.principal_subject);
  if (mismatch) {
    throw new Error("Observation/private evidence provenance mismatch");
  }
}

function validateImportedObservation(
  row: CapturedObservation,
  fixture: ScaleFixture,
  other: ScaleFixture | undefined,
  evidence: ReadonlyMap<string, unknown>,
  calibration: CapturedCalibration,
): void {
  const matchedFixture = resolveObservationFixture(row.manifest_hash, fixture, other);
  if (!matchedFixture || !row.notebook_id) {
    throw new Error("Observation fixture/notebook provenance missing");
  }
  const epoch = row.client_submission_epoch_ms ?? NaN;
  assertObservationWithinClockInterval(epoch, row, calibration);
  const correlated = correlateScaleEvidence(evidence.get(row.request_id), matchedFixture, {
    requestId: row.request_id,
    notebookId: row.notebook_id,
    epochMs: epoch + (calibration?.offset_ms ?? 0),
    uncertainty: row.clock_uncertainty_ms ?? NaN,
  });
  assertCorrelatedEvidenceMatchesRow(row, matchedFixture, correlated);
}

function validateConcurrencyObservations(concurrencyRows: readonly CapturedObservation[]): void {
  const notebooks = new Set(concurrencyRows.map((o) => o.notebook_id));
  const owners = new Set(concurrencyRows.map((o) => o.principal_subject));
  const pairs = new Map<string, CapturedObservation[]>();
  for (const row of concurrencyRows) {
    if (!row.diagnostic_pair_id) {
      throw new Error("Missing concurrency pair provenance");
    }
    const pair = pairs.get(row.diagnostic_pair_id) ?? [];
    pair.push(row);
    pairs.set(row.diagnostic_pair_id, pair);
  }
  const hasInvalidPair = [...pairs.values()].some(
    (pair) =>
      pair.length !== 2 ||
      Math.max(...pair.map((o) => o.client_submission_monotonic_ms)) >=
        Math.min(...pair.map((o) => o.client_completion_monotonic_ms ?? -1)),
  );
  if (pairs.size !== 10 || hasInvalidPair) {
    throw new Error("Concurrency intervals do not overlap");
  }
  if (
    notebooks.size !== 2 ||
    owners.size !== 2 ||
    owners.has(undefined) ||
    [...notebooks].some((n) => concurrencyRows.filter((o) => o.notebook_id === n).length !== 10)
  ) {
    throw new Error("Concurrency requires 10 observations per isolated Owner notebook");
  }
}

export function importScaleCapture(
  raw: unknown,
  fixture: ScaleFixture,
  profile: "core" | "concurrency",
): ScaleBenchmarkReport {
  const c = capture.parse(raw);
  if (c.manifest_hash !== fixture.fixture_hash || c.profile !== profile) {
    throw new Error("Capture fixture/profile mismatch");
  }
  if (profile === "core" && (c.concurrency_observations || c.concurrency_fixture)) {
    throw new Error("Unexpected diagnostic data in core capture");
  }
  const other = profile === "concurrency" ? loadScaleFixture(c.concurrency_fixture) : undefined;
  if (profile === "concurrency" && !c.concurrency_observations) {
    throw new Error("Missing concurrency observations");
  }
  const allRows = [...c.observations, ...(c.concurrency_observations ?? [])];
  const evidence = indexPrivateEvidence(c.private_evidence, allRows);
  for (const row of allRows) {
    validateImportedObservation(row, fixture, other, evidence, c.clock_calibration);
  }
  if (c.concurrency_observations) {
    validateConcurrencyObservations(c.concurrency_observations);
  }
  return buildScaleBenchmarkReport({
    evidence_kind: "imported-diagnostic",
    benchmark_id: `import-${fixture.fixture_hash.slice(0, 8)}`,
    manifest_hash: fixture.fixture_hash,
    coreObservations: c.observations,
    concurrencyObservations: c.concurrency_observations,
  });
}
