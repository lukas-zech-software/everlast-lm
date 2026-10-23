import { z } from "zod";

/**
 * Package 3.2 DTOs — Quantitative Code Execution Sandbox (FR-GC-08; FR-GC-02/06, C-01/C-02, NFR-SEC-02).
 * specs/010 data-model.md / contracts/interfaces.md. Defined once here and imported by ChatMessageSchema.
 * C-01 is unchanged: manifests and results only reference existing chunk IDs.
 */

const uuid = (label: string) => z.string().uuid(`${label} must be a valid UUID`);
const iso = z.string().datetime();

/** FR-007: CodeGenerating → SandboxRunning → Succeeded | TimedOut | Failed. */
export const CodeExecutionStateSchema = z.enum(["CodeGenerating", "SandboxRunning", "Succeeded", "TimedOut", "Failed"]);
export type CodeExecutionState = z.infer<typeof CodeExecutionStateSchema>;
export const TERMINAL_EXECUTION_STATES: readonly CodeExecutionState[] = ["Succeeded", "TimedOut", "Failed"];

/** Closed safe failure enum (contracts/interfaces.md terminal-code table); never free provider text. */
export const CodeExecutionFailureCodeSchema = z.enum([
  "PythonException",
  "ExecutionTimeout",
  "MemoryLimitExceeded",
  "TemporaryStorageLimit",
  "SecurityViolation",
  "ProviderUnavailable",
  "ExecutionOutcomeUnknown",
  "ScopeChanged",
  "AccessRevoked",
  "GenerationCancelled",
  "CitationInvalid",
  "InvalidOutput",
]);
export type CodeExecutionFailureCode = z.infer<typeof CodeExecutionFailureCodeSchema>;

/** Only a first-attempt Python exception permits the single correction retry (FR-006). */
export function isRetryableFailure(code: CodeExecutionFailureCode, ordinal: number): boolean {
  return code === "PythonException" && ordinal === 1;
}

/** Exact finite decimal/scientific representation as returned by the sandbox (FR-005); no NaN/inf/separators. */
export const CanonicalNumberSchema = z
  .string()
  .max(64)
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/, "value must be a canonical finite number string");

export const ComputedResultSchema = z
  .object({
    label: z.string().min(1).max(200),
    value: CanonicalNumberSchema,
    unit: z.string().min(1).max(40).nullable(),
    /** Supporting input chunk IDs (C-01) — computed results always cite their input data (FR-012). */
    citations: z.array(uuid("citation")).min(1).max(200),
  })
  .strict();
export type ComputedResult = z.infer<typeof ComputedResultSchema>;

const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CHART_URL_RE = new RegExp(`^/api/notebooks/(${UUID_RE})/chat/messages/(${UUID_RE})/charts/(${UUID_RE})$`, "i");

/** Authenticated application route of a published chart (never a storage bearer URL; NFR-SEC-02). */
export function chartUrl(notebookId: string, messageId: string, artifactId: string): string {
  return `/api/notebooks/${notebookId}/chat/messages/${messageId}/charts/${artifactId}`;
}

export function chartArtifactIdOf(url: string): string | null {
  return CHART_URL_RE.exec(url)?.[3]?.toLowerCase() ?? null;
}

export const ChartUrlSchema = z.string().regex(CHART_URL_RE, "artifact must be an authenticated chart route");

export const CodeExecutionAttemptSchema = z
  .object({
    attempt_id: uuid("attempt_id"),
    ordinal: z.union([z.literal(1), z.literal(2)]),
    code: z.string().max(100_000),
    stdout: z.string().max(200_000),
    stderr: z.string().max(200_000),
    /** null when killed/unknown — never a fabricated 0 (FR-007). */
    exit_code: z.number().int().nullable(),
    started_at: iso,
    ended_at: iso.nullable(),
    terminal_reason: z.union([z.literal("Succeeded"), CodeExecutionFailureCodeSchema]).nullable(),
    artifacts: z.array(ChartUrlSchema).max(10),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (a.terminal_reason !== null && a.terminal_reason !== "Succeeded" && a.terminal_reason !== "PythonException" && a.exit_code === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "exit_code 0 cannot accompany a killed/failed attempt", path: ["exit_code"] });
    }
    if (a.terminal_reason === "Succeeded" && a.exit_code !== 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a succeeded attempt exits 0", path: ["exit_code"] });
    }
    if (a.terminal_reason === null && (a.ended_at !== null || a.exit_code !== null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "running attempt has no end/exit", path: ["terminal_reason"] });
    }
  });
export type CodeExecutionAttempt = z.infer<typeof CodeExecutionAttemptSchema>;

export const CodeExecutionTraceSchema = z
  .object({
    schema_version: z.literal(1),
    execution_id: uuid("execution_id"),
    state: CodeExecutionStateSchema,
    attempts: z.array(CodeExecutionAttemptSchema).max(2),
    final_attempt_id: uuid("final_attempt_id").nullable(),
    published_artifact_ids: z.array(uuid("published_artifact_id")).max(10),
    failure_code: CodeExecutionFailureCodeSchema.nullable(),
    computed_results: z.array(ComputedResultSchema).max(50),
  })
  .strict()
  .superRefine((t, ctx) => {
    const issue = (message: string, path: string[]) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
    t.attempts.forEach((a, i) => {
      if (a.ordinal !== i + 1) issue("attempts must be ordered 1..n", ["attempts", String(i), "ordinal"]);
    });
    const terminal = TERMINAL_EXECUTION_STATES.includes(t.state);
    const last = t.attempts.at(-1);
    if (!terminal || t.attempts.length === 0) {
      if (t.final_attempt_id !== null) issue("no final attempt before terminal completion or without attempts", ["final_attempt_id"]);
    } else if (t.final_attempt_id !== last!.attempt_id) {
      issue("final_attempt_id must be the last actual attempt", ["final_attempt_id"]);
    }
    if (t.attempts.length === 2 && t.attempts[0]!.terminal_reason !== "PythonException") {
      issue("a second attempt only follows a first-attempt Python exception", ["attempts"]);
    }
    if (t.state === "Succeeded") {
      if (t.failure_code !== null) issue("success has no failure code", ["failure_code"]);
      if (!last || last.terminal_reason !== "Succeeded") issue("success needs a succeeded final attempt", ["attempts"]);
      const finalArtifacts = new Set((last?.artifacts ?? []).map((u) => chartArtifactIdOf(u)));
      for (const id of t.published_artifact_ids) if (!finalArtifacts.has(id.toLowerCase())) issue("published artifacts come from the final attempt", ["published_artifact_ids"]);
    } else {
      if (t.published_artifact_ids.length > 0) issue("nothing is published unless Succeeded", ["published_artifact_ids"]);
      if (t.computed_results.length > 0) issue("no computed result unless Succeeded", ["computed_results"]);
      if (terminal && t.failure_code === null) issue("terminal failures carry a failure code", ["failure_code"]);
      if (!terminal && t.failure_code !== null) issue("running traces carry no failure code", ["failure_code"]);
      if (t.state === "TimedOut" && t.failure_code !== "ExecutionTimeout") issue("TimedOut uses ExecutionTimeout", ["failure_code"]);
    }
  });
export type CodeExecutionTrace = z.infer<typeof CodeExecutionTraceSchema>;

const SourceRevisionSchema = z.object({ source_id: uuid("source_id"), revision: z.number().int().positive() }).strict();

/** Private chart record (data-model.md Chart artifact); the object key/generation never leaves the server. */
export const ChartArtifactRecordSchema = z
  .object({
    artifact_id: uuid("artifact_id"),
    execution_id: uuid("execution_id"),
    attempt_id: uuid("attempt_id"),
    message_id: uuid("message_id").nullable(),
    notebook_id: uuid("notebook_id"),
    object_key: z.string().min(1).max(512),
    object_generation: z.string().min(1).max(64),
    mime_type: z.enum(["image/png", "image/svg+xml"]),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    byte_size: z.number().int().positive(),
    source_snapshot: z.array(SourceRevisionSchema).min(1),
    citation_chunk_ids: z.array(uuid("citation_chunk_id")).min(1),
    state: z.enum(["candidate", "published", "invalidated"]),
  })
  .strict();
export type ChartArtifactRecord = z.infer<typeof ChartArtifactRecordSchema>;

/** Input file names are fixed internal names; no URLs, paths, traversal or hidden files (FR-009, NFR-SEC-02). */
export const ManifestFilenameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,62}\.json$/, "manifest filename must be an internal name");

export const ManifestValueSchema = z
  .object({
    label: z.string().min(1).max(200),
    value: CanonicalNumberSchema,
    unit: z.string().min(1).max(40).nullable(),
    chunk_id: uuid("chunk_id"),
  })
  .strict();
export type ManifestValue = z.infer<typeof ManifestValueSchema>;

export const ManifestEntrySchema = z
  .object({
    filename: ManifestFilenameSchema,
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    byte_count: z.number().int().nonnegative(),
    values: z.array(ManifestValueSchema).max(10_000),
    supporting_chunk_ids: z.array(uuid("supporting_chunk_id")).min(1),
  })
  .strict();
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;
