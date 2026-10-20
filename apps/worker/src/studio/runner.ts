import {
  InvalidScopeError,
  requiredReportSections,
  SourceSnapshotInvalidError,
  type SourceRevisionPair,
  type StudioFailure,
  type StudioPluginRegistry,
  type StudioReportPayload,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";
import type { StudioArtifactRecord, StudioArtifactRepository } from "@everlast/db";
import { splitSentences } from "./reports/sentences.ts";
import { QUESTION_SECTIONS } from "./reports/templates.ts";

/** Re-verifies owner access and source revisions (D12); throws InvalidScopeError / SourceSnapshotInvalidError. */
export interface StudioAccessVerifier {
  verifySnapshot(ownerId: string, notebookId: string, snapshot: SourceRevisionPair[]): Promise<void>;
}

/** C-02 getScopedContext: the only read path for source content. */
export interface StudioScopedContext {
  getScopedContext(notebookId: string, activeSourceIds: string[]): Promise<UnifiedDocumentChunk[]>;
}

export interface StudioJobRunnerDeps {
  repo: StudioArtifactRepository;
  registry: StudioPluginRegistry;
  scopedContext: StudioScopedContext;
  access: StudioAccessVerifier;
}

class CancelledSignal extends Error {}

const MARKER = /\[(\d+)\]/g;

const MARKER_SPLIT = /\[\d+\]/;
const TRAILING_MARKER = /\[\d+\]$/;
const LIST_PREFIX = /^(?:[-*>] |\d{1,4}\. )/;
const TABLE_SEPARATOR = /^\|[\s|:-]+\|$/;

/**
 * Gate v2.0 #3 / FR-017 section rules: every required key is present with a `## heading` and content, and every
 * factual sentence of a checked section ends in a `[n]` marker. Notices (`_…_`), questions and table headers are
 * not factual sentences. Only a Timeline's `events` section may consist of the no-dated-events notice.
 */
export function validateReportSections(payload: StudioReportPayload, subtype: string): string | null {
  const required = requiredReportSections(subtype);
  const keys = payload.sections.map((x) => x.key);
  const missing = required.filter((key) => !keys.includes(key));
  if (missing.length > 0) return `Report is missing the required section(s) ${missing.join(", ")}`;

  const lines = payload.content_md.split("\n");
  const headingAt = new Map<string, number>();
  lines.forEach((line, i) => {
    if (line.startsWith("## ") && !headingAt.has(line.slice(3).trim())) headingAt.set(line.slice(3).trim(), i);
  });
  const checked = required.length > 0 ? payload.sections.filter((x) => required.includes(x.key)) : payload.sections;
  for (const section of checked) {
    const start = headingAt.get(section.heading.trim());
    if (start === undefined) return `Section ${section.key} has no heading in the report`;
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => l.startsWith("#"));
    const body = (end < 0 ? rest : rest.slice(0, end)).map((l) => l.trim()).filter((l) => l.length > 0);
    let factual = 0;
    let notices = 0;
    let inTable = false;
    for (const line of body) {
      if (line.startsWith("|")) {
        if (!inTable || TABLE_SEPARATOR.test(line)) {
          inTable = true;
          continue;
        }
      } else {
        inTable = false;
      }
      if (line.length > 1 && line.startsWith("_") && line.endsWith("_")) {
        notices += 1;
        continue;
      }
      if (QUESTION_SECTIONS.has(section.key) || line.startsWith("**Q:")) {
        factual += 1;
        continue;
      }
      const text = line.replace(/\s*\|$/, "").replace(LIST_PREFIX, "");
      if (!TRAILING_MARKER.test(text)) return `Section ${section.key} contains an uncited factual sentence`;
      for (const segment of text.split(MARKER_SPLIT)) {
        if (splitSentences(segment.trim()).length > 1) return `Section ${section.key} contains an uncited factual sentence`;
      }
      factual += 1;
    }
    if (factual === 0 && !(notices > 0 && subtype === "timeline" && section.key === "events")) {
      return `Required section ${section.key} is empty`;
    }
  }
  return null;
}

export function validateReportPayload(
  payload: StudioReportPayload,
  chunks: UnifiedDocumentChunk[],
  snapshot: SourceRevisionPair[],
  subtype?: string
): string | null {
  const revisions = new Map(snapshot.map((p) => [p.source_id, p.revision]));
  const byId = new Map(chunks.map((c) => [c.chunk_id, c]));
  const badges = new Set<number>();
  for (const cite of payload.citations) {
    const chunk = byId.get(cite.chunk_id);
    if (!chunk) return `Citation ${cite.badge_number} does not resolve to a scoped chunk`;
    if (revisions.get(cite.source_id) !== cite.revision || chunk.source_id !== cite.source_id || chunk.revision !== cite.revision) {
      return `Citation ${cite.badge_number} does not match the source snapshot`;
    }
    if (!chunk.text.includes(cite.snippet)) return `Citation ${cite.badge_number} snippet is not in the cited chunk`;
    if (badges.has(cite.badge_number)) return `Duplicate citation badge ${cite.badge_number}`;
    badges.add(cite.badge_number);
  }
  const used = new Set<number>();
  for (const m of payload.content_md.matchAll(MARKER)) used.add(Number(m[1]));
  for (const n of used) if (!badges.has(n)) return `Marker [${n}] has no citation`;
  for (const n of badges) if (!used.has(n)) return `Citation ${n} is not referenced in the report`;
  return subtype === undefined ? null : validateReportSections(payload, subtype);
}

export class StudioJobRunner {
  private readonly controllers = new Map<string, AbortController>();

  private readonly deps: StudioJobRunnerDeps;
  constructor(deps: StudioJobRunnerDeps) {
    this.deps = deps;
  }

  async cancel(id: string): Promise<StudioArtifactRecord> {
    const row = await this.deps.repo.getById(id);
    if (!row) throw new Error(`Studio artifact ${id} not found`);
    if (row.status !== "Queued" && row.status !== "Running") return row;
    this.controllers.get(id)?.abort();
    return this.deps.repo.cancel(id);
  }

  async run(id: string): Promise<StudioArtifactRecord> {
    const { repo, registry } = this.deps;
    const initial = await repo.getById(id);
    if (!initial) throw new Error(`Studio artifact ${id} not found`);
    if (initial.status !== "Queued") return initial;

    const controller = new AbortController();
    this.controllers.set(id, controller);
    try {
      await repo.markRunning(id);
      const failure = await this.execute(initial, controller.signal, registry);
      if (controller.signal.aborted) return (await repo.getById(id))!;
      if (failure) return await repo.fail(id, failure);
      return (await repo.getById(id))!;
    } catch (err) {
      if (err instanceof CancelledSignal || controller.signal.aborted) return (await repo.getById(id))!;
      return repo.fail(id, { code: "GenerationError", message: "Report generation failed unexpectedly." });
    } finally {
      this.controllers.delete(id);
    }
  }

  /** Returns a failure, or null after publishing a Completed payload. */
  private async execute(
    artifact: StudioArtifactRecord,
    signal: AbortSignal,
    registry: StudioPluginRegistry
  ): Promise<StudioFailure | null> {
    const { repo, access, scopedContext } = this.deps;
    const snapshot = artifact.source_revisions_snapshot;
    const guard = (): void => {
      if (signal.aborted) throw new CancelledSignal();
    };
    const verify = async (): Promise<StudioFailure | null> => {
      try {
        await access.verifySnapshot(artifact.owner_id, artifact.notebook_id, snapshot);
        return null;
      } catch (err) {
        if (err instanceof SourceSnapshotInvalidError) return { code: "SourceChanged", message: err.message };
        if (err instanceof InvalidScopeError) return { code: "Unauthorized", message: "Access to the selected sources was revoked." };
        throw err;
      }
    };

    const pre = await verify();
    if (pre) return pre;
    guard();

    const ids = snapshot.map((p) => p.source_id);
    const chunks = await scopedContext.getScopedContext(artifact.notebook_id, ids);
    guard();
    const revisions = new Map(snapshot.map((p) => [p.source_id, p.revision]));
    for (const c of chunks) {
      const expected = revisions.get(c.source_id);
      if (expected === undefined) {
        return { code: "CitationValidationFailed", message: "Context contained a chunk outside the selected sources." };
      }
      if (expected !== c.revision) {
        return { code: "SourceChanged", message: `Source ${c.source_id} was replaced after the job was queued.` };
      }
    }

    const plugin = registry.get(artifact.plugin_type);
    const outcome = await plugin.generate({
      artifact_id: artifact.id,
      notebook_id: artifact.notebook_id,
      subtype: artifact.subtype,
      params_json: artifact.params_json,
      snapshot,
      chunks,
      output_language: artifact.output_language ?? undefined,
      signal,
      reportProgress: (stage, percent) => {
        if (!signal.aborted) void repo.updateProgress(artifact.id, { stage, percent }).catch(() => undefined);
      },
    });
    guard();
    if (outcome.status === "refused") return { code: outcome.code, message: outcome.message };

    const problem = validateReportPayload(outcome.payload, chunks, snapshot, artifact.subtype);
    if (problem) return { code: "CitationValidationFailed", message: problem };

    const post = await verify();
    if (post) return post;
    guard();
    await repo.complete(artifact.id, outcome.payload);
    return null;
  }
}
