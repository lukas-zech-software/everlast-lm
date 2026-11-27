import { StudioContextSessions, type StudioContextRuntime } from "./context-cache.ts";
import type { CorpusTokenizer } from "@everlast/db";
import type { ScopedCorpusManifest } from "@everlast/contracts";
import {
  InvalidScopeError,
  requiredReportSections,
  SourceSnapshotInvalidError,
  type SourceRevisionPair,
  type StudioFailure,
  type StudioPayloadJson,
  type StudioPluginRegistry,
  type StudioPluginType,
  type StudioReportPayload,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";
import {
  StudioLeaseFenceError,
  type StudioArtifactRecord,
  type StudioArtifactRepository,
} from "@everlast/db";
import { validateMindmapPayload } from "./mindmaps/validation.ts";
import { splitSentences } from "./reports/sentences.ts";
import { QUESTION_SECTIONS } from "./reports/templates.ts";
import { validateDataTablePayload } from "./tables/validation.ts";
import { validateFlashcardsPayload } from "./flashcards/validation.ts";
import { validateQuizPayload } from "./quizzes/validation.ts";
import { validateLearningOverviewPayload } from "./learning-overview/validation.ts";
import { validateSlideDeckPayload } from "./slides/validation.ts";
import { validateInfographicPayload } from "./infographics/validation.ts";
import { logFailure } from "@everlast/cloud/log";

/** Re-verifies owner access and source revisions (D12); throws InvalidScopeError / SourceSnapshotInvalidError. */
export interface StudioAccessVerifier {
  verifySnapshot: (
    ownerId: string,
    notebookId: string,
    snapshot: SourceRevisionPair[],
  ) => Promise<void>;
}

/** C-02 getScopedContext: the only read path for source content. Receives captured `ownerId` for owner-bound reads. */
export interface StudioScopedContext {
  getScopedContext: (
    notebookId: string,
    activeSourceIds: string[],
    ownerId?: string,
  ) => Promise<UnifiedDocumentChunk[]>;
  streamOriginals?: (
    ownerId: string,
    notebookId: string,
    snapshot: SourceRevisionPair[],
  ) => AsyncIterable<UnifiedDocumentChunk[]>;
  buildLedger?: (
    ownerId: string,
    notebookId: string,
    snapshot: SourceRevisionPair[],
    tokenizer: CorpusTokenizer,
  ) => Promise<ScopedCorpusManifest>;
  loadCitedChunks?: (
    ownerId: string,
    notebookId: string,
    snapshot: SourceRevisionPair[],
    ids: string[],
  ) => Promise<UnifiedDocumentChunk[]>;
}

export type StudioPayloadValidator = (
  payload: StudioPayloadJson,
  chunks: UnifiedDocumentChunk[],
  snapshot: SourceRevisionPair[],
  subtype?: string,
) => string | null;

export interface StudioJobRunnerDeps {
  contextSessions?: StudioContextSessions | undefined;
  contextRuntime?: StudioContextRuntime | undefined;
  repo: StudioArtifactRepository;
  registry: StudioPluginRegistry;
  scopedContext: StudioScopedContext;
  access: StudioAccessVerifier;
  validators?: Partial<Record<StudioPluginType, StudioPayloadValidator>> | undefined;
  leaseDurationSeconds?: number | undefined;
}

class CancelledSignal extends Error {}

const MARKER = /\[(\d+)\]/g;
const MARKER_SPLIT = /\[\d+\]/;
const TRAILING_MARKER = /\[\d+\]$/;
const LIST_PREFIX = /^(?:[-*>] |\d{1,4}\. )/;
const TABLE_SEPARATOR = /^\|[\s|:-]+\|$/;

function indexSectionHeadings(lines: string[]): Map<string, number> {
  const headingAt = new Map<string, number>();
  lines.forEach((line, i) => {
    if (line.startsWith("## ") && !headingAt.has(line.slice(3).trim())) {
      headingAt.set(line.slice(3).trim(), i);
    }
  });
  return headingAt;
}

function extractSectionBody(lines: string[], start: number): string[] {
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("#"));
  return (end < 0 ? rest : rest.slice(0, end)).map((l) => l.trim()).filter((l) => l.length > 0);
}

function validateFactualLine(sectionKey: string, line: string): string | null {
  const withoutTrailingPipe = line.endsWith("|") ? line.slice(0, -1).trimEnd() : line;
  const text = withoutTrailingPipe.replace(LIST_PREFIX, "");
  if (!TRAILING_MARKER.test(text)) {
    return `Section ${sectionKey} contains an uncited factual sentence`;
  }
  for (const segment of text.split(MARKER_SPLIT)) {
    if (splitSentences(segment.trim()).length > 1) {
      return `Section ${sectionKey} contains an uncited factual sentence`;
    }
  }
  return null;
}

function isNoticeLine(line: string): boolean {
  return line.length > 1 && line.startsWith("_") && line.endsWith("_");
}

function validateSectionBody(sectionKey: string, body: string[], subtype: string): string | null {
  let factual = 0;
  let notices = 0;
  let inTable = false;
  for (const line of body) {
    const isTableLine = line.startsWith("|");
    if (isTableLine && (!inTable || TABLE_SEPARATOR.test(line))) {
      inTable = true;
      continue;
    }
    inTable = isTableLine;
    if (isNoticeLine(line)) {
      notices += 1;
      continue;
    }
    if (QUESTION_SECTIONS.has(sectionKey) || line.startsWith("**Q:")) {
      factual += 1;
      continue;
    }
    const lineError = validateFactualLine(sectionKey, line);
    if (lineError) return lineError;
    factual += 1;
  }
  const allowedEmptyTimeline = notices > 0 && subtype === "timeline" && sectionKey === "events";
  if (factual === 0 && !allowedEmptyTimeline) {
    return `Required section ${sectionKey} is empty`;
  }
  return null;
}

/**
 * Gate v2.0 #3 / FR-017 section rules: every required key is present with a `## heading` and content, and every
 * factual sentence of a checked section ends in a `[n]` marker. Notices (`_…_`), questions and table headers are
 * not factual sentences. Only a Timeline's `events` section may consist of the no-dated-events notice.
 */
export function validateReportSections(
  payload: StudioReportPayload,
  subtype: string,
): string | null {
  const required = requiredReportSections(subtype);
  const keys = new Set(payload.sections.map((x) => x.key));
  const missing = required.filter((key) => !keys.has(key));
  if (missing.length > 0) return `Report is missing the required section(s) ${missing.join(", ")}`;

  const lines = payload.content_md.split("\n");
  const headingAt = indexSectionHeadings(lines);
  const checked =
    required.length > 0
      ? payload.sections.filter((x) => required.includes(x.key))
      : payload.sections;
  for (const section of checked) {
    const start = headingAt.get(section.heading.trim());
    if (start === undefined) return `Section ${section.key} has no heading in the report`;
    const bodyError = validateSectionBody(section.key, extractSectionBody(lines, start), subtype);
    if (bodyError) return bodyError;
  }
  return null;
}

function validateReportCitations(
  citations: StudioReportPayload["citations"],
  chunks: UnifiedDocumentChunk[],
  snapshot: SourceRevisionPair[],
): { badges: Set<number> } | { error: string } {
  const revisions = new Map(snapshot.map((p) => [p.source_id, p.revision]));
  const byId = new Map(chunks.map((c) => [c.chunk_id, c]));
  const badges = new Set<number>();
  for (const cite of citations) {
    const chunk = byId.get(cite.chunk_id);
    if (!chunk)
      return { error: `Citation ${cite.badge_number} does not resolve to a scoped chunk` };
    if (
      revisions.get(cite.source_id) !== cite.revision ||
      chunk.source_id !== cite.source_id ||
      chunk.revision !== cite.revision
    ) {
      return { error: `Citation ${cite.badge_number} does not match the source snapshot` };
    }
    if (!chunk.text.includes(cite.snippet)) {
      return { error: `Citation ${cite.badge_number} snippet is not in the cited chunk` };
    }
    if (badges.has(cite.badge_number)) {
      return { error: `Duplicate citation badge ${cite.badge_number}` };
    }
    badges.add(cite.badge_number);
  }
  return { badges };
}

export function validateReportPayload(
  payload: StudioReportPayload,
  chunks: UnifiedDocumentChunk[],
  snapshot: SourceRevisionPair[],
  subtype?: string,
): string | null {
  const checked = validateReportCitations(payload.citations, chunks, snapshot);
  if ("error" in checked) return checked.error;
  const used = new Set<number>();
  for (const m of payload.content_md.matchAll(MARKER)) used.add(Number(m[1]));
  for (const n of used) if (!checked.badges.has(n)) return `Marker [${n}] has no citation`;
  for (const n of checked.badges) {
    if (!used.has(n)) return `Citation ${n} is not referenced in the report`;
  }
  return subtype === undefined ? null : validateReportSections(payload, subtype);
}

const DEFAULT_VALIDATORS: Record<StudioPluginType, StudioPayloadValidator> = {
  report: (payload, chunks, snapshot, subtype) =>
    validateReportPayload(payload as StudioReportPayload, chunks, snapshot, subtype),
  mindmap: (payload, chunks, snapshot) => validateMindmapPayload(payload, chunks, snapshot),
  data_table: (payload, chunks, snapshot) => validateDataTablePayload(payload, chunks, snapshot),
  flashcards: (payload, chunks, snapshot) => validateFlashcardsPayload(payload, chunks, snapshot),
  quiz: (payload, chunks, snapshot) => validateQuizPayload(payload, chunks, snapshot),
  learning_overview: (payload, chunks, snapshot) =>
    validateLearningOverviewPayload(payload, chunks, snapshot),
  slide_deck: (payload, chunks, snapshot) => validateSlideDeckPayload(payload, chunks, snapshot),
  infographic: (payload, chunks, snapshot) => validateInfographicPayload(payload, chunks, snapshot),
};

function verifyChunkSnapshot(
  chunks: UnifiedDocumentChunk[],
  snapshot: SourceRevisionPair[],
): StudioFailure | null {
  const revisions = new Map(snapshot.map((p) => [p.source_id, p.revision]));
  for (const c of chunks) {
    const expected = revisions.get(c.source_id);
    if (expected === undefined) {
      return {
        code: "CitationValidationFailed",
        message: "Context contained a chunk outside the selected sources.",
      };
    }
    if (expected !== c.revision) {
      return {
        code: "SourceChanged",
        message: `Source ${c.source_id} was replaced after the job was queued.`,
      };
    }
  }
  return null;
}

function validateStreamingCoverage(
  payload: StudioPayloadJson,
  streamState: { originalCount: number; complete: boolean },
): StudioFailure | null {
  const coverage = (
    payload as {
      coverage?: {
        total_chunks: number;
        processed_batch_count: number;
        batch_count: number;
        all_original_chunks_visited: boolean;
      };
    }
  ).coverage;
  if (
    !streamState.complete ||
    (coverage &&
      (coverage.total_chunks !== streamState.originalCount ||
        coverage.processed_batch_count !== coverage.batch_count ||
        !coverage.all_original_chunks_visited))
  ) {
    return {
      code: "CitationValidationFailed",
      message: "Original evidence coverage is incomplete.",
    };
  }
  return null;
}

function classifyRunError(err: unknown, pluginType: StudioPluginType): StudioFailure {
  if (err instanceof SourceSnapshotInvalidError) {
    return { code: "SourceChanged", message: err.message };
  }
  if (err instanceof InvalidScopeError) {
    return { code: "Unauthorized", message: "Access to the selected sources was revoked." };
  }
  return {
    code: "GenerationError",
    message:
      pluginType === "report"
        ? "Report generation failed unexpectedly."
        : "Studio generation failed unexpectedly.",
  };
}

export class StudioJobRunner {
  private readonly controllers = new Map<string, AbortController>();
  private readonly deps: StudioJobRunnerDeps;

  constructor(deps: StudioJobRunnerDeps) {
    this.deps = {
      ...deps,
      contextSessions:
        deps.contextSessions ??
        (deps.contextRuntime ? new StudioContextSessions(deps.contextRuntime) : undefined),
    };
  }

  async cancel(id: string): Promise<StudioArtifactRecord> {
    const row = await this.deps.repo.getById(id);
    if (!row) throw new Error(`Studio artifact ${id} not found`);
    if (row.status !== "Queued" && row.status !== "Running") return row;
    this.controllers.get(id)?.abort();
    return this.deps.repo.cancel(id);
  }

  private async requireArtifact(id: string): Promise<StudioArtifactRecord> {
    const row = await this.deps.repo.getById(id);
    if (!row) throw new Error(`Studio artifact ${id} not found`);
    return row;
  }

  private async claimOrStart(
    initial: StudioArtifactRecord,
  ): Promise<{ artifact: StudioArtifactRecord; leaseToken: string | undefined } | null> {
    const { repo } = this.deps;
    if (initial.plugin_type !== "report" && repo.claimExecution) {
      const claim = await repo.claimExecution(initial.id, this.deps.leaseDurationSeconds ?? 120);
      if (!claim) return null;
      return { artifact: claim.artifact, leaseToken: claim.leaseToken };
    }
    if (initial.status !== "Queued") return null;
    return { artifact: await repo.markRunning(initial.id), leaseToken: undefined };
  }

  private startLeaseHeartbeat(
    id: string,
    leaseToken: string | undefined,
    controller: AbortController,
  ): ReturnType<typeof setInterval> | null {
    const { repo } = this.deps;
    if (!leaseToken || !repo.renewLease) return null;
    const leaseSeconds = this.deps.leaseDurationSeconds ?? 120;
    const heartbeat = setInterval(
      () => {
        const renew = repo.renewLease?.(id, leaseToken, leaseSeconds);
        if (!renew) return;
        void renew.then(
          (kept) => {
            if (!kept) controller.abort();
          },
          () => undefined,
        );
      },
      Math.max(50, Math.floor((leaseSeconds * 1000) / 3)),
    );
    heartbeat.unref();
    return heartbeat;
  }

  private async failAttempt(
    id: string,
    failure: StudioFailure,
    leaseToken: string | undefined,
  ): Promise<StudioArtifactRecord> {
    const { repo } = this.deps;
    if (leaseToken && repo.failWithFence) {
      return (
        (await repo.failWithFence(id, failure, leaseToken)) ?? (await this.requireArtifact(id))
      );
    }
    const current = await this.requireArtifact(id);
    if (current.status === "Queued" || current.status === "Running") {
      return repo.fail(id, failure);
    }
    return current;
  }

  async run(id: string): Promise<StudioArtifactRecord> {
    const { registry } = this.deps;
    const initial = await this.requireArtifact(id);
    if (
      initial.status === "Completed" ||
      initial.status === "Failed" ||
      initial.status === "Cancelled"
    ) {
      return initial;
    }

    const claimed = await this.claimOrStart(initial);
    if (!claimed) return this.requireArtifact(id);

    const controller = new AbortController();
    this.controllers.set(id, controller);
    // Heartbeat (PR #161 review, FR-017): renew the lease while the attempt runs; a lost lease stops this run.
    const heartbeat = this.startLeaseHeartbeat(id, claimed.leaseToken, controller);
    try {
      const failure = await this.execute(
        claimed.artifact,
        controller.signal,
        registry,
        claimed.leaseToken,
      );
      if (controller.signal.aborted) return await this.requireArtifact(id);
      if (failure) return await this.failAttempt(id, failure, claimed.leaseToken);
      return await this.requireArtifact(id);
    } catch (err) {
      if (
        err instanceof CancelledSignal ||
        err instanceof StudioLeaseFenceError ||
        controller.signal.aborted
      ) {
        return await this.requireArtifact(id);
      }
      logFailure("studio.run", { artifact_id: id, plugin_type: initial.plugin_type }, err);
      return await this.failAttempt(
        id,
        classifyRunError(err, initial.plugin_type),
        claimed.leaseToken,
      );
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      this.controllers.delete(id);
    }
  }

  private async verifyArtifactScope(artifact: StudioArtifactRecord): Promise<StudioFailure | null> {
    try {
      await this.deps.access.verifySnapshot(
        artifact.owner_id,
        artifact.notebook_id,
        artifact.source_revisions_snapshot,
      );
      return null;
    } catch (err) {
      if (err instanceof SourceSnapshotInvalidError) {
        return { code: "SourceChanged", message: err.message };
      }
      if (err instanceof InvalidScopeError) {
        return { code: "Unauthorized", message: "Access to the selected sources was revoked." };
      }
      throw err;
    }
  }

  private async acquireSession(artifact: StudioArtifactRecord, signal: AbortSignal) {
    const { contextSessions: sessions, scopedContext } = this.deps;
    if (!sessions || !scopedContext.buildLedger || !scopedContext.streamOriginals) {
      return undefined;
    }
    const snapshot = artifact.source_revisions_snapshot;
    return sessions.acquire({
      ledger: await scopedContext.buildLedger(
        artifact.owner_id,
        artifact.notebook_id,
        snapshot,
        sessions.tokenizer,
      ),
      language: artifact.output_language ?? "en",
      parameters: {
        plugin: artifact.plugin_type,
        subtype: artifact.subtype,
        params: artifact.params_json,
      },
      chunks: () =>
        scopedContext.streamOriginals?.(artifact.owner_id, artifact.notebook_id, snapshot) ??
        (async function* () {
          // empty fallback
        })(),
      verify: () =>
        this.deps.access.verifySnapshot(artifact.owner_id, artifact.notebook_id, snapshot),
      signal,
    });
  }

  private async resolveInitialChunks(
    artifact: StudioArtifactRecord,
    streaming: boolean,
  ): Promise<{ chunks: UnifiedDocumentChunk[]; failure: StudioFailure | null }> {
    if (streaming) return { chunks: [], failure: null };
    const snapshot = artifact.source_revisions_snapshot;
    const chunks = await this.deps.scopedContext.getScopedContext(
      artifact.notebook_id,
      snapshot.map((p) => p.source_id),
      artifact.owner_id,
    );
    return { chunks, failure: verifyChunkSnapshot(chunks, snapshot) };
  }

  private async publishCompleted(
    artifactId: string,
    payload: StudioPayloadJson,
    leaseToken?: string,
  ): Promise<void> {
    if (this.deps.repo.completeWithFence) {
      await this.deps.repo.completeWithFence(artifactId, payload, { leaseToken });
    } else {
      await this.deps.repo.complete(artifactId, payload);
    }
  }

  /** Returns a failure, or null after publishing a Completed payload. */
  private async execute(
    artifact: StudioArtifactRecord,
    signal: AbortSignal,
    registry: StudioPluginRegistry,
    leaseToken?: string,
  ): Promise<StudioFailure | null> {
    const { repo, scopedContext } = this.deps;
    const snapshot = artifact.source_revisions_snapshot;
    const guard = (): void => {
      if (signal.aborted) throw new CancelledSignal();
    };

    const pre = await this.verifyArtifactScope(artifact);
    if (pre) return pre;
    guard();

    const streaming = Boolean(scopedContext.streamOriginals && scopedContext.loadCitedChunks);
    const initial = await this.resolveInitialChunks(artifact, streaming);
    guard();
    if (initial.failure) return initial.failure;
    let chunks = initial.chunks;

    const session = streaming ? await this.acquireSession(artifact, signal) : undefined;
    const streamState = { originalCount: 0, complete: false };
    const originals = async function* (stream: AsyncIterable<UnifiedDocumentChunk[]>) {
      for await (const page of stream) {
        streamState.originalCount += page.length;
        yield page;
      }
      streamState.complete = true;
    };
    const plugin = registry.get(artifact.plugin_type);
    const outcome = await plugin.generate({
      artifact_id: artifact.id,
      notebook_id: artifact.notebook_id,
      subtype: artifact.subtype,
      params_json: artifact.params_json,
      snapshot,
      chunks,
      ...(session ? { cached_context: session.handle, before_model_call: session.beforeCall } : {}),
      ...(streaming
        ? {
            original_chunks: originals(
              scopedContext.streamOriginals?.(artifact.owner_id, artifact.notebook_id, snapshot) ??
                (async function* () {
                  // empty fallback
                })(),
            ),
            load_cited_chunks: (citedIds: string[]) =>
              scopedContext.loadCitedChunks?.(
                artifact.owner_id,
                artifact.notebook_id,
                snapshot,
                citedIds,
              ) ?? Promise.resolve([]),
          }
        : {}),
      output_language: artifact.output_language ?? undefined,
      signal,
      reportProgress: (stage, percent) => {
        if (!signal.aborted) {
          void repo.updateProgress(artifact.id, { stage, percent }).catch(() => undefined);
        }
      },
    });
    guard();
    if (outcome.status === "refused") return { code: outcome.code, message: outcome.message };

    if (scopedContext.streamOriginals && scopedContext.loadCitedChunks) {
      const coverageError = validateStreamingCoverage(outcome.payload, streamState);
      if (coverageError) return coverageError;
      const citations =
        (outcome.payload as { citations?: Array<{ chunk_id: string }> }).citations ?? [];
      chunks = await scopedContext.loadCitedChunks(
        artifact.owner_id,
        artifact.notebook_id,
        snapshot,
        [...new Set(citations.map((c) => c.chunk_id))],
      );
    }
    const validator =
      this.deps.validators?.[artifact.plugin_type] ?? DEFAULT_VALIDATORS[artifact.plugin_type];
    const problem = validator(outcome.payload, chunks, snapshot, artifact.subtype);
    if (problem) return { code: "CitationValidationFailed", message: problem };

    await session?.beforeCall();
    const post = await this.verifyArtifactScope(artifact);
    if (post) return post;
    guard();

    await this.publishCompleted(artifact.id, outcome.payload, leaseToken);
    return null;
  }
}
