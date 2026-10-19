import { createHash } from "node:crypto";
import {
  FollowUpSuggestionsSchema,
  NotebookOverviewSchema,
  SourceGuideSchema,
  type FollowUpSuggestions,
  type NotebookOverview,
  type SourceGuide,
  type SourceRevisionPair,
  createScopedContextEnvelope,
  type ScopedContextProvider,
  type ScopedContextEnvelope,
} from "@everlast/contracts";
import { getOverview, getSourceGuide, saveOverview, saveSourceGuide } from "@everlast/db";

export interface ScopedSourceMaterial {
  source_id: string;
  revision: number;
  word_count: number;
  title: string;
  chunks: Array<{ chunk_id: string; text: string; source_id: string; revision: number }>;
}
export interface SourceReadRequest {
  notebook_id: string;
  user_id: string;
  source_revisions: SourceRevisionPair[];
}
export interface PackageV22SourceReader {
  readReadySources(request: SourceReadRequest): Promise<ScopedSourceMaterial[]>;
}

export interface PackageV22SourceMetadata {
  source_id: string;
  revision: number;
  title: string;
  word_count: number;
}

export function createC02PackageV22SourceReader(input: {
  provider: ScopedContextProvider;
  validateScope: (userId: string, request: ScopedContextEnvelope) => Promise<{ snapshot: SourceRevisionPair[] }>;
  getSourceMetadata: (notebookId: string, userId: string, scope: SourceRevisionPair[]) => Promise<PackageV22SourceMetadata[]>;
}): PackageV22SourceReader {
  return {
    async readReadySources(request) {
      const scope = [...request.source_revisions].sort((a, b) => a.source_id.localeCompare(b.source_id));
      if (!scope.length || new Set(scope.map((pair) => pair.source_id)).size !== scope.length) throw new Error("C-02 requires a nonempty unique source scope");
      const envelope = createScopedContextEnvelope({ notebook_id: request.notebook_id, active_source_ids: scope.map((pair) => pair.source_id), source_revisions: scope, principal: { subject: request.user_id }, purpose: "generation" });
      const assertAuthorized = async () => {
        const authorized = await input.validateScope(request.user_id, envelope);
        const expected = scope.map((pair) => `${pair.source_id}:${pair.revision}`).sort();
        const actual = authorized.snapshot.map((pair) => `${pair.source_id}:${pair.revision}`).sort();
        if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("C-02 source snapshot is stale or unauthorized");
      };
      await assertAuthorized();
      const [chunks, metadata] = await Promise.all([
        input.provider.getScopedContext(request.notebook_id, envelope.active_source_ids),
        input.getSourceMetadata(request.notebook_id, request.user_id, scope),
      ]);
      const revisionById = new Map(scope.map((pair) => [pair.source_id, pair.revision]));
      if (chunks.some((chunk) => revisionById.get(chunk.source_id) !== chunk.revision)) throw new Error("Source reader returned a chunk outside the requested scope");
      const expected = scope.map((pair) => `${pair.source_id}:${pair.revision}`).sort();
      const actual = metadata.map((source) => `${source.source_id}:${source.revision}`).sort();
      if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("Ready source metadata does not match the requested scope");
      await assertAuthorized();
      return scope.map((pair) => {
        const source = metadata.find((item) => item.source_id === pair.source_id && item.revision === pair.revision)!;
        return { ...source, chunks: chunks.filter((chunk) => chunk.source_id === pair.source_id && chunk.revision === pair.revision).map(({ chunk_id, text, source_id, revision }) => ({ chunk_id, text, source_id, revision })) };
      });
    },
  };
}
export interface StructuredGenerationClient {
  generateSourceGuide(input: { source: ScopedSourceMaterial; output_language: string }): Promise<Pick<SourceGuide, "summary_md" | "key_topics" | "supporting_chunk_ids">>;
  generateOverview(input: { sources: ScopedSourceMaterial[]; output_language: string }): Promise<Pick<NotebookOverview, "overview_md" | "starter_prompts" | "supporting_chunk_ids">>;
  generateFollowUps(input: { answer: string; sources: ScopedSourceMaterial[]; output_language: string }): Promise<Pick<FollowUpSuggestions, "suggested_followups" | "supporting_chunk_ids">>;
}
export interface RetryOptions {
  sleep?: (ms: number) => Promise<void>;
  isTransient?: (error: unknown) => boolean;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const transientDefault = (error: unknown) => Boolean(error && typeof error === "object" && "transient" in error && error.transient === true);
const textOf = (source: ScopedSourceMaterial) => source.chunks.map((chunk) => chunk.text).join("\n");
const countWords = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length;
const validateSupport = (supportIds: string[], sources: ScopedSourceMaterial[]) => {
  const allowed = new Set(sources.flatMap((source) => source.chunks.map((chunk) => chunk.chunk_id)));
  if (supportIds.some((id) => !allowed.has(id))) throw new Error("Generated output references a chunk outside the authorized scope");
};

export async function generateSourceGuide(input: {
  notebook_id: string; user_id: string; source_id: string; revision: number; output_language: string;
  reader: PackageV22SourceReader; model: StructuredGenerationClient; retry?: RetryOptions;
}): Promise<SourceGuide> {
  const snapshot = [{ source_id: input.source_id, revision: input.revision }];
  const pending: SourceGuide = { notebook_id: input.notebook_id, source_id: input.source_id, revision: input.revision, status: "GuidePending", source_word_count: 0, summary_md: "Generation pending", key_topics: [], supporting_chunk_ids: [] };
  let authorized = false;
  try {
    const sources = await input.reader.readReadySources({ notebook_id: input.notebook_id, user_id: input.user_id, source_revisions: snapshot });
    if (sources.length !== 1 || sources[0]?.source_id !== input.source_id || sources[0]?.revision !== input.revision) throw new Error("Source snapshot is not current and authorized");
    const source = sources[0]!;
    authorized = true;
    await saveSourceGuide(pending);
    if (source.chunks.some((chunk) => chunk.source_id !== input.source_id || chunk.revision !== input.revision)) throw new Error("Source reader returned chunks outside the requested revision");
    const wordCount = source.word_count || countWords(textOf(source));
    let generated: Awaited<ReturnType<StructuredGenerationClient["generateSourceGuide"]>> | undefined;
    const sleep = input.retry?.sleep ?? delay;
    const isTransient = input.retry?.isTransient ?? transientDefault;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        generated = await input.model.generateSourceGuide({ source, output_language: input.output_language });
        break;
      } catch (error) {
        if (!isTransient(error) || attempt === 2) throw error;
        await sleep(attempt === 0 ? 100 : 200);
      }
    }
    if (!generated) throw new Error("Source Guide generation returned no result");
    validateSupport(generated.supporting_chunk_ids, sources);
    const currentSources = await input.reader.readReadySources({ notebook_id: input.notebook_id, user_id: input.user_id, source_revisions: snapshot });
    assertExactScope(snapshot, currentSources);
    validateSupport(generated.supporting_chunk_ids, currentSources);
    const ready = SourceGuideSchema.parse({
      notebook_id: input.notebook_id, source_id: input.source_id, revision: input.revision,
      status: "GuideReady", source_word_count: wordCount, ...generated, generated_at: new Date().toISOString(),
    });
    return await saveSourceGuide(ready);
  } catch (error) {
    if (authorized) {
      const failed: SourceGuide = { ...pending, status: "GuideFailed", error: error instanceof Error ? error.message : "Guide generation failed" };
      await saveSourceGuide(failed);
    }
    throw error;
  }
}

export async function readSourceGuide(notebookId: string, sourceId: string, revision: number) {
  return getSourceGuide(notebookId, sourceId, revision);
}

export async function generateNotebookOverview(input: {
  notebook_id: string; user_id: string; source_revisions: SourceRevisionPair[]; output_language: string;
  generation_parameters?: Record<string, unknown>; reader: PackageV22SourceReader; model: StructuredGenerationClient;
}): Promise<NotebookOverview> {
  const scope = [...input.source_revisions].sort((a, b) => a.source_id.localeCompare(b.source_id));
  if (!scope.length || new Set(scope.map((item) => item.source_id)).size !== scope.length) throw new Error("Overview requires a nonempty unique source scope");
  const parameters = input.generation_parameters ?? {};
  const cacheKey = createHash("sha256").update(JSON.stringify({ notebook_id: input.notebook_id, user_id: input.user_id, scope, output_language: input.output_language, parameters })).digest("hex");
  const sources = await input.reader.readReadySources({ notebook_id: input.notebook_id, user_id: input.user_id, source_revisions: scope });
  assertExactScope(scope, sources);
  const cached = await getOverview(cacheKey);
  if (cached?.authorization_key === input.user_id) return cached;
  const result = await input.model.generateOverview({ sources, output_language: input.output_language });
  const currentSources = await input.reader.readReadySources({ notebook_id: input.notebook_id, user_id: input.user_id, source_revisions: scope });
  assertExactScope(scope, currentSources);
  validateSupport(result.supporting_chunk_ids, currentSources);
  return saveOverview(NotebookOverviewSchema.parse({ notebook_id: input.notebook_id, source_revisions: scope, authorization_key: createHash("sha256").update(input.user_id).digest("hex"), output_language: input.output_language, generation_parameters: parameters, cache_key: cacheKey, ...result, generated_at: new Date().toISOString() }));
}

export async function generateFollowUps(input: {
  answer: string; notebook_id: string; user_id: string; source_revisions: SourceRevisionPair[]; output_language: string;
  reader: PackageV22SourceReader; model: StructuredGenerationClient; streaming?: boolean;
}): Promise<FollowUpSuggestions> {
  if (input.streaming) throw new Error("Follow-ups are available only after answer completion");
  if (!input.source_revisions.length) throw new Error("Follow-ups require a nonempty source scope");
  const sources = await input.reader.readReadySources({ notebook_id: input.notebook_id, user_id: input.user_id, source_revisions: input.source_revisions });
  assertExactScope(input.source_revisions, sources);
  const result = await input.model.generateFollowUps({ answer: input.answer, sources, output_language: input.output_language });
  const currentSources = await input.reader.readReadySources({ notebook_id: input.notebook_id, user_id: input.user_id, source_revisions: input.source_revisions });
  assertExactScope(input.source_revisions, currentSources);
  validateSupport(result.supporting_chunk_ids, currentSources);
  return FollowUpSuggestionsSchema.parse({ ...result, source_revisions: input.source_revisions, generated_at: new Date().toISOString() });
}

function assertExactScope(scope: SourceRevisionPair[], sources: ScopedSourceMaterial[]): void {
  const expected = [...scope].map((item) => `${item.source_id}:${item.revision}`).sort();
  const actual = sources.map((item) => `${item.source_id}:${item.revision}`).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("Authorized Ready source snapshot is stale or incomplete");
  if (sources.some((source) => source.chunks.some((chunk) => chunk.source_id !== source.source_id || chunk.revision !== source.revision))) throw new Error("Source reader returned chunks outside the authorized scope");
}
