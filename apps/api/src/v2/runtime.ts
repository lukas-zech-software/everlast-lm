import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AppError,
  InvalidScopeError,
  SourceQuotaExceededError,
  SourceSnapshotInvalidError,
  StudioPluginRegistry,
  type ChatMessage,
  type Notebook,
  type NotebookDto,
  type ScopedContextProvider,
  type SourceGuideState,
  type SourceRevisionPair,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";
import {
  captureScopeSnapshot,
  configureChatMessageReader,
  countOccupiedSources,
  countSourcesForNotebook,
  createNote,
  forgetNotebook,
  getChatConfiguration,
  getNoteSource,
  getNotebookRaw,
  getOrCreateThread,
  getScopedContext as getNoteSourceChunks,
  getSource,
  getSourceGuide,
  InMemoryStudioArtifactRepository,
  listSnapshotChunks,
  listSources,
  listThreadMessages,
  projectVisibleMessages,
  rememberNotebook,
  setReadySourceCount,
  verifyScopeSnapshot,
  type Pool,
  type SourceRecord,
} from "@everlast/db";
import { createPackageV22Runtime } from "@everlast/worker/package-v2-2-runtime";
import type { StructuredGenerationClient } from "@everlast/worker/package-v2-2";
import { applyTopicIcon, createReadySourceDispatcher, type ReadySourceEvent, type ReadySourceHook } from "@everlast/worker/ready-hooks";
import type { TopicEmojiSelector } from "@everlast/worker/ingestion/topic-emoji";
import { createNoteMarkdownIngestor } from "@everlast/worker/ingestion/note-markdown";
import { InlineStudioDispatcher } from "@everlast/worker/studio/dispatcher";
import { StudioJobRunner } from "@everlast/worker/studio/runner";
import { ReportGeneratorPlugin } from "@everlast/worker/studio/reports/plugin";
import { DeterministicReportModel } from "@everlast/worker/studio/reports/deterministic-model";
import { ReportSuggestionService } from "@everlast/worker/studio/reports/suggestions";
import type { GroundedModel } from "../chat/model.ts";
import type { ResponsePreferences } from "../chat/prompt.ts";
import { GroundedNoteAssistant } from "../notes/assistant-model.ts";
import { NotesService } from "../notes/service.ts";
import { handleNotesRoute } from "../routes/notes.ts";
import { handlePackageV22Route, type PackageV22ApiDependencies } from "../routes/package-v2-2.ts";
import { handleStudioRoute } from "../routes/studio.ts";
import { handleWorkspacePreferencesRoute } from "../routes/workspace-preferences.ts";
import { WorkspacePreferencesService } from "../services/workspace-preferences.ts";
import type { StudioServiceDeps } from "../studio/service.ts";

/**
 * Release v2 proof-of-concept runtime (D16).
 *
 * The four v2 packages (2.1 workspace comfort, 2.2 Source Guide and chat control, 2.3 notes, 2.4 Studio reports)
 * keep their records in process memory: persistence is not a goal of the proof of concept and moves to
 * PostgreSQL in v3. Everything that decides access still comes from v1: the API authenticates the caller,
 * checks notebook ownership in PostgreSQL before any v2 handler runs, and v2 reads source content only
 * through the PostgreSQL C-02 path (or the in-memory note-source registry for notes converted to sources).
 * Because the stores are per process, v2 background work (Source Guides, topic icons, Studio reports) runs
 * in this API process, and the PoC deployment runs a single API instance.
 */

export type V2Handler = (req: IncomingMessage, res: ServerResponse, userId: string) => Promise<boolean>;

export interface V2RuntimeOptions {
  pool: Pool;
  sourceLimit: number;
  /** Grounded chat model; enables the Note Assistant (FR-NM-04). */
  model?: GroundedModel | undefined;
  /** Structured generation for Source Guides, overview and follow-ups (FR-SI-02, FR-GC-04/05). */
  generation?: StructuredGenerationClient | undefined;
  /** Topic emoji for a notebook's first Ready source (FR-WM-02). */
  topicEmoji?: TopicEmojiSelector | undefined;
}

export interface V2Runtime {
  workspace: WorkspacePreferencesService;
  handlers: V2Handler[];
  /** Mirrors an authorized PostgreSQL notebook into the PoC bridge. */
  syncNotebook(userId: string, notebook: NotebookDto): Notebook;
  /** Updates Ready counts and starts Ready-source hooks after the API listed a notebook's sources. */
  syncSources(userId: string, notebookId: string, sources: SourceRecord[]): void;
  notebookDeleted(notebookId: string): Promise<void>;
  chatPreferences(userId: string, notebookId: string, browserLocale?: string): Promise<ResponsePreferences>;
}

const NOTE_SOURCE_CHUNK_LIMIT = 200;

export function createV2Runtime(options: V2RuntimeOptions): V2Runtime {
  const { pool } = options;
  const workspace = new WorkspacePreferencesService();
  const ownerOf = (notebookId: string) => getNotebookRaw(notebookId)?.owner_id ?? null;

  // PostgreSQL chat history as v2 sees it (saved responses, feedback, follow-ups): visible messages only.
  configureChatMessageReader(async (notebookId, userId) => {
    const thread = await getOrCreateThread(pool, userId, notebookId);
    const stored = await listThreadMessages(pool, thread.id);
    const visible = await projectVisibleMessages(pool, notebookId, stored);
    const provenance = new Map(stored.map((m) => [m.id, m.provenance]));
    return visible
      .filter((m) => m.content !== null)
      .map(
        (m): ChatMessage => ({
          id: m.id,
          thread_id: thread.id,
          notebook_id: notebookId,
          user_id: userId,
          role: m.role,
          content: m.content!,
          active_source_revisions_snapshot: provenance.get(m.id) ?? [],
          citations: m.citations
            .filter((c) => c.status === "available")
            .map((c) => ({
              badge_number: c.badge_number,
              source_id: c.source_id,
              source_title: c.source_title!,
              chunk_id: c.chunk_id,
              snippet: c.snippet!,
              locator: c.locator!,
            })),
          created_at: m.created_at,
        })
      );
  });

  /** Uploaded sources through the PostgreSQL C-02 path; note sources through the in-memory registry. */
  const isNoteSource = async (notebookId: string, sourceId: string) => (await getNoteSource(notebookId, sourceId)) !== null;
  const splitIds = async (notebookId: string, ids: string[]) => {
    const notes: string[] = [];
    const uploads: string[] = [];
    for (const id of new Set(ids)) ((await isNoteSource(notebookId, id)) ? notes : uploads).push(id);
    return { notes, uploads };
  };
  const scopedChunks = async (ownerId: string, notebookId: string, ids: string[]): Promise<UnifiedDocumentChunk[]> => {
    const { notes, uploads } = await splitIds(notebookId, ids);
    const out = notes.length ? await getNoteSourceChunks(notebookId, notes) : [];
    if (uploads.length) {
      const snapshot = await captureScopeSnapshot(pool, ownerId, notebookId, uploads);
      out.push(...(await listSnapshotChunks(pool, snapshot, NOTE_SOURCE_CHUNK_LIMIT)));
    }
    return out;
  };
  const provider: ScopedContextProvider = {
    async getScopedContext(notebookId, activeSourceIds) {
      const owner = ownerOf(notebookId);
      if (!owner) throw new InvalidScopeError("Notebook is not available");
      return scopedChunks(owner, notebookId, activeSourceIds);
    },
  };
  const resolveSnapshot = async (ownerId: string, notebookId: string, ids: string[]): Promise<SourceRevisionPair[]> => {
    const { notes, uploads } = await splitIds(notebookId, ids);
    const pairs: SourceRevisionPair[] = [];
    for (const id of notes) {
      const source = (await getNoteSource(notebookId, id))!;
      pairs.push({ source_id: id, revision: source.revision_id });
    }
    if (uploads.length) pairs.push(...(await captureScopeSnapshot(pool, ownerId, notebookId, uploads)).sources);
    return pairs.sort((a, b) => a.source_id.localeCompare(b.source_id));
  };
  const verifySnapshot = async (ownerId: string, notebookId: string, snapshot: SourceRevisionPair[]): Promise<void> => {
    const { notes, uploads } = await splitIds(notebookId, snapshot.map((p) => p.source_id));
    for (const id of notes) {
      const source = await getNoteSource(notebookId, id);
      if (!source || source.revision_id !== snapshot.find((p) => p.source_id === id)!.revision) {
        throw new SourceSnapshotInvalidError(`Source ${id} changed`);
      }
    }
    const uploadPairs = snapshot.filter((p) => uploads.includes(p.source_id));
    if (uploadPairs.length) await verifyScopeSnapshot(pool, { notebook_id: notebookId, owner_id: ownerId, sources: uploadPairs });
  };
  const sourceTitles = async (notebookId: string, ids: string[]) => {
    const titles = new Map<string, string>();
    const owner = ownerOf(notebookId);
    if (owner) for (const s of await listSources(pool, owner, notebookId)) titles.set(s.id, s.title);
    for (const id of ids) {
      const note = await getNoteSource(notebookId, id);
      if (note) titles.set(id, note.title);
    }
    return titles;
  };

  // ---- Package 2.2: Source Guide, overview, chat configuration, follow-ups, saved responses -------------
  const v22 = createPackageV22Runtime({
    provider,
    validateScope: async (userId, envelope) => ({
      snapshot: await resolveSnapshot(userId, envelope.notebook_id, envelope.active_source_ids),
    }),
    getSourceMetadata: async (notebookId, userId, scope) => {
      const sources = new Map((await listSources(pool, userId, notebookId)).map((s) => [s.id, s]));
      return scope.flatMap((pair) => {
        const s = sources.get(pair.source_id);
        return s && s.active_revision === pair.revision
          ? [{ source_id: s.id, revision: pair.revision, title: s.title, word_count: s.word_count ?? 0 }]
          : [];
      });
    },
    ...(options.generation ? { model: options.generation } : {}),
    resolveOwner: async (notebookId) => ownerOf(notebookId),
  });
  const v22Deps: PackageV22ApiDependencies = {
    // The API checked notebook ownership in PostgreSQL before any v2 handler runs.
    authorizeNotebook: async (userId, notebookId) => ownerOf(notebookId) === userId,
    authorizeSource: async (userId, notebookId, sourceId) => {
      try {
        const source = await getSource(pool, userId, notebookId, sourceId);
        return { exists: true, ready: source.status === "Ready", revision: source.active_revision ?? 0 };
      } catch (err) {
        if (err instanceof AppError && err.status === 404) return { exists: false, ready: false, revision: 0 };
        throw err;
      }
    },
    ...(options.generation
      ? { generateOverview: v22.generateOverview, generateFollowUps: v22.generateFollowUps }
      : {}),
  };

  // ---- Ready-source hooks: Source Guide (2.2) and topic icon (2.1) --------------------------------------
  const hooks: ReadySourceHook[] = [];
  if (options.generation) hooks.push((event) => v22.onSourceReady(event));
  if (options.topicEmoji) {
    const selector = options.topicEmoji;
    hooks.push((event) => applyTopicIcon(event, selector));
  }
  const dispatchReady = createReadySourceDispatcher(hooks);

  // ---- Package 2.3: notes -------------------------------------------------------------------------------
  const notes = new NotesService({
    ingestor: createNoteMarkdownIngestor(),
    ...(options.model ? { assistant: new GroundedNoteAssistant(options.model) } : {}),
    scopedContext: provider,
    verifyOwnership: (notebookId, userId) => ownerOf(notebookId) === userId,
    reserveSlot: async (notebookId) => {
      const used = (await countOccupiedSources(pool, notebookId)) + countSourcesForNotebook(notebookId);
      if (used >= options.sourceLimit) throw new SourceQuotaExceededError(`Source limit of ${options.sourceLimit} reached`);
    },
    sourceTitles,
  });
  const sourceSlots = async (notebookId: string) => ({
    used: (await countOccupiedSources(pool, notebookId)) + countSourcesForNotebook(notebookId),
    limit: options.sourceLimit,
  });

  // ---- Package 2.4: Studio reports ----------------------------------------------------------------------
  const repo = new InMemoryStudioArtifactRepository();
  const registry = new StudioPluginRegistry();
  // No Gemini report adapter exists yet: the deterministic, citation-checked extractor is used (D16).
  const reportModel = new DeterministicReportModel();
  registry.register(new ReportGeneratorPlugin(reportModel));
  const access = { resolveSnapshot, verifySnapshot };
  const runner = new StudioJobRunner({ repo, registry, scopedContext: provider, access });
  const guides = {
    async getGuides(notebookId: string, snapshot: SourceRevisionPair[]): Promise<SourceGuideState[]> {
      return Promise.all(
        snapshot.map(async (pair): Promise<SourceGuideState> => {
          const guide = await getSourceGuide(notebookId, pair.source_id, pair.revision);
          if (guide?.status === "GuideReady") {
            return { ...pair, status: "Ready", summary: guide.summary_md, key_topics: guide.key_topics };
          }
          return { ...pair, status: guide?.status === "GuideFailed" ? "Failed" : "Pending" };
        })
      );
    },
  };
  const studioDeps: StudioServiceDeps = {
    repo,
    registry,
    access,
    dispatcher: new InlineStudioDispatcher(runner),
    convertToSource: async (input) => {
      const note = await createNote(input.notebook_id, input.owner_id, {
        title: input.title.slice(0, 100) || "Report",
        content_md: input.content_md,
      });
      const source = await notes.convertToSource(input.notebook_id, input.owner_id, { note_ids: [note.id] });
      return { source_id: source.id };
    },
    suggestions: new ReportSuggestionService({ guides, model: reportModel }),
  };

  return {
    workspace,
    handlers: [
      (req, res, userId) => handleWorkspacePreferencesRoute(req, res, workspace, userId),
      (req, res, userId) => handlePackageV22Route(req, res, userId, v22Deps),
      (req, res, userId) => handleNotesRoute(req, res, { service: notes, verifyOwnership: (nb, uid) => ownerOf(nb) === uid, sourceSlots }, userId),
      (req, res, userId) => handleStudioRoute(req, res, studioDeps, userId),
    ],
    syncNotebook(userId, notebook) {
      return rememberNotebook({ ...notebook, owner_id: userId });
    },
    syncSources(_userId, notebookId, sources) {
      const ready = sources.filter((s) => s.status === "Ready" && s.active_revision !== null);
      setReadySourceCount(notebookId, ready.length);
      for (const s of ready) {
        const event: ReadySourceEvent = {
          notebook_id: notebookId,
          source_id: s.id,
          revision_id: s.active_revision!,
          title: s.title,
          media_type: s.media_type,
        };
        void dispatchReady(event);
      }
    },
    async notebookDeleted(notebookId) {
      forgetNotebook(notebookId);
      await repo.deleteForNotebook(notebookId);
    },
    async chatPreferences(userId, notebookId, browserLocale) {
      const [config, languages] = await Promise.all([
        getChatConfiguration(notebookId, userId),
        workspace.resolveLanguagePreferences(userId, notebookId, browserLocale),
      ]);
      return {
        style: config.style,
        custom_instructions: config.custom_instructions,
        response_length: config.response_length,
        input_language: languages.input_language,
        output_language: languages.output_language,
      };
    },
  };
}
