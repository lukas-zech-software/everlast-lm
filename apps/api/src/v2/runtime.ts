import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import {
  AppError,
  InvalidScopeError,
  OutputLanguageSchema,
  SourceQuotaExceededError,
  SourceSnapshotInvalidError,
  StudioPluginRegistry,
  type ChatMessage,
  type Citation,
  type Notebook,
  type NotebookDto,
  type ScopedContextProvider,
  type SourceGuideState,
  type SourceRevisionPair,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";
import type { Embedder, ObjectStorage } from "@everlast/cloud";
import {
  captureScopeSnapshot,
  configureChatMessageReader,
  forgetNotebook,
  getChatConfiguration,
  getNotebook,
  getNotebookRaw,
  getOrCreateThread,
  getSource,
  getSnapshotChunksByIds,
  getSourceGuide,
  InMemoryStudioArtifactRepository,
  listAllSnapshotChunks,
  listSnapshotChunks,
  listSources,
  listThreadMessages,
  projectVisibleMessages,
  publishTurn,
  rememberNotebook,
  setReadySourceCount,
  touchNotebookModified,
  verifyScopeSnapshot,
  type Pool,
  type SourceRecord,
} from "@everlast/db";
import { createPackageV22Runtime } from "@everlast/worker/package-v2-2-runtime";
import type { StructuredGenerationClient } from "@everlast/worker/package-v2-2";
import { applyTopicIcon, createReadySourceDispatcher, type ReadySourceEvent, type ReadySourceHook } from "@everlast/worker/ready-hooks";
import type { TopicEmojiSelector } from "@everlast/worker/ingestion/topic-emoji";
import { InlineStudioDispatcher } from "@everlast/worker/studio/dispatcher";
import { StudioJobRunner } from "@everlast/worker/studio/runner";
import { ReportGeneratorPlugin } from "@everlast/worker/studio/reports/plugin";
import { DeterministicReportModel } from "@everlast/worker/studio/reports/deterministic-model";
import type { ReportModelClient, ReportSuggestionModel } from "@everlast/worker/studio/reports/model";
import { ReportSuggestionService, structuredSuggestionModel } from "@everlast/worker/studio/reports/suggestions";
import type { GroundedModel } from "../chat/model.ts";
import type { ResponsePreferences } from "../chat/prompt.ts";
import { GroundedNoteAssistant } from "../notes/assistant-model.ts";
import { createPostgresNoteSources } from "../notes/note-sources.ts";
import { NotesService, type NoteAssistantContext } from "../notes/service.ts";
import { handleNotesRoute } from "../routes/notes.ts";
import { handlePackageV22Route, savedResponseNoteSaver, type PackageV22ApiDependencies } from "../routes/package-v2-2.ts";
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
 * through the PostgreSQL C-02 path. Sources made from notes are normal v1 PostgreSQL sources (owner decision
 * 2026-10-20, D16 amendment): they share the source limit with uploads and are read like any upload.
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
  /**
   * Ready-transition watcher (FR-SI-02, Gate v2.0 #1): polls PostgreSQL at this bounded interval and starts the
   * Ready-source hooks without waiting for a source listing. Absent → listing-time dispatch only.
   */
  readyWatch?: { intervalMs: number; batchSize?: number } | undefined;
  /** v1 object storage and document embedder: notes are converted through the v1 ingestion (FR-NM-03, FR-SI-01). */
  storage?: ObjectStorage | undefined;
  embedder?: Embedder | undefined;
  /** Wakes the worker so the durable ingest job of a converted note settles (it finds the source already done). */
  notifyJobs?: (() => void) | undefined;
  /**
   * Studio report model (FR-ST-10/11): Vertex AI Flash from `server.ts` when Vertex is configured; absent →
   * the deterministic, citation-checked extractor (tests, evals, unconfigured local runs).
   */
  reportModel?: ReportModelClient | undefined;
  /**
   * Dynamic report suggestions (FR-ST-11). Default: Flash-Lite through `generation` (Package 2.2 client); without
   * it suggestions are unavailable (owner default 2026-10-20). Tests may inject a deterministic model.
   */
  suggestionModel?: ReportSuggestionModel | undefined;
}

export interface V2Runtime {
  workspace: WorkspacePreferencesService;
  handlers: V2Handler[];
  /** Mirrors an authorized PostgreSQL notebook into the PoC bridge. */
  syncNotebook(userId: string, notebook: NotebookDto): Notebook;
  /** Advances `updated_at` of an authorized notebook after a source write (FR-WM-02). */
  notebookModified(userId: string, notebook: NotebookDto): Promise<void>;
  /** Updates Ready counts and starts Ready-source hooks after the API listed a notebook's sources (fallback to the watcher). */
  syncSources(userId: string, notebookId: string, sources: SourceRecord[]): void;
  notebookDeleted(notebookId: string): Promise<void>;
  chatPreferences(userId: string, notebookId: string, browserLocale?: string): Promise<ResponsePreferences>;
  /** One watcher pass: dispatches Ready-source hooks for new `(source_id, active_revision)` Ready transitions. */
  pollReadySources(): Promise<number>;
  /** Stops background work (the Ready watcher). */
  close(): void;
}

const SCOPED_CHUNK_LIMIT = 200;

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

  /** Every source, uploads and note-sources alike, through the PostgreSQL C-02 path (bounded per source). */
  const readSnapshot = async (ownerId: string, notebookId: string, ids: string[]) => {
    const snapshot = await captureScopeSnapshot(pool, ownerId, notebookId, ids);
    const perSource = Math.max(20, Math.floor(SCOPED_CHUNK_LIMIT / Math.max(1, snapshot.sources.length)));
    const chunks: UnifiedDocumentChunk[] = [];
    for (const pair of snapshot.sources) chunks.push(...(await listSnapshotChunks(pool, { ...snapshot, sources: [pair] }, perSource)));
    return { snapshot, chunks };
  };
  const provider: ScopedContextProvider = {
    async getScopedContext(notebookId, activeSourceIds) {
      const owner = ownerOf(notebookId);
      if (!owner) throw new InvalidScopeError("Notebook is not available");
      return (await readSnapshot(owner, notebookId, activeSourceIds)).chunks;
    },
  };
  const resolveSnapshot = async (ownerId: string, notebookId: string, ids: string[]): Promise<SourceRevisionPair[]> =>
    [...(await captureScopeSnapshot(pool, ownerId, notebookId, ids)).sources].sort((a, b) => a.source_id.localeCompare(b.source_id));
  const verifySnapshot = async (ownerId: string, notebookId: string, snapshot: SourceRevisionPair[]): Promise<void> => {
    await verifyScopeSnapshot(pool, { notebook_id: notebookId, owner_id: ownerId, sources: snapshot });
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
    // FR-UI-02: background work has no browser locale, so notebook > user > en-US.
    resolveOutputLanguage: async (notebookId, userId) => (await workspace.resolveLanguagePreferences(userId, notebookId)).output_language,
  });
  // On-demand guides for another output language (FR-SI-02): one background run per (source, revision, language).
  const guideRuns = new Set<string>();
  const startGuide = (input: { notebook_id: string; user_id: string; source_id: string; revision: number; output_language: string }) => {
    const key = `${input.notebook_id}:${input.source_id}:${input.revision}:${input.output_language}`;
    if (guideRuns.has(key)) return;
    guideRuns.add(key);
    // Once the run saved its guide (ready or failed) the store answers; the key only covers the run itself.
    void v22.generateSourceGuide(input).catch(() => undefined).finally(() => guideRuns.delete(key));
  };
  // ---- Package 2.3: notes (in memory, D16) and note-sources (v1 PostgreSQL sources, owner decision 2026-10-20) -----
  const noteSourceStore = createPostgresNoteSources({ pool, storage: options.storage, embedder: options.embedder, sourceLimit: options.sourceLimit });
  const noteSources: typeof noteSourceStore = {
    ...noteSourceStore,
    async create(ownerId, notebookId, input) {
      try {
        return await noteSourceStore.create(ownerId, notebookId, input);
      } finally {
        options.notifyJobs?.();
      }
    },
  };
  const assistantContext: NoteAssistantContext = {
    async read(ownerId, notebookId, sourceIds) {
      const { snapshot, chunks } = await readSnapshot(ownerId, notebookId, sourceIds);
      return { snapshot: snapshot.sources, chunks };
    },
    verify: verifySnapshot,
    // FR-NM-04 / FR-GC-06: the action's question and verified answer are one turn of the caller's PostgreSQL thread.
    async publish(input) {
      const thread = await getOrCreateThread(pool, input.ownerId, input.notebookId);
      const stored = await publishTurn(pool, {
        thread,
        snapshot: { notebook_id: input.notebookId, owner_id: input.ownerId, sources: input.snapshot },
        requestId: randomUUID(),
        question: input.question,
        answer: input.answer,
      });
      return projectVisibleMessages(pool, input.notebookId, stored);
    },
  };
  const notes = new NotesService({
    noteSources,
    ...(options.model ? { assistant: new GroundedNoteAssistant(options.model) } : {}),
    context: assistantContext,
    verifyOwnership: (notebookId, userId) => ownerOf(notebookId) === userId,
    onNotebookModified: touchNotebookModified,
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
    resolveOutputLanguage: async (userId, notebookId) => (await workspace.resolveLanguagePreferences(userId, notebookId)).output_language,
    // FR-GC-09 / FR-NM-02: the shared save-note route writes the Package 2.3 notes store.
    saveNote: savedResponseNoteSaver(notes),
    ...(options.generation
      ? { generateOverview: v22.generateOverview, generateFollowUps: v22.generateFollowUps, startGuide }
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

  // ---- Ready watcher (FR-SI-02, Gate v2.0 #1, D16: single API instance) --------------------------------
  // Each poll pages with a keyset cursor over (updated_at, id) from READY_LOOKBACK_MS before the newest Ready
  // transition seen, until a short page. The lookback catches transactions that committed late; keyset paging
  // guarantees progress past full pages; `watched` skips (source, revision) pairs already dispatched.
  const READY_LOOKBACK_MS = 30_000;
  const readyBatch = Math.max(1, options.readyWatch?.batchSize ?? 500);
  const watched = new Set<string>();
  let readyHighWater: Date | null = null;
  const pollReadySources = async (): Promise<number> => {
    if (hooks.length === 0) return 0;
    if (!readyHighWater) readyHighWater = (await pool.query<{ now: Date }>("SELECT now() AS now")).rows[0]!.now;
    // The cursor keeps PostgreSQL's microsecond text form: a JS Date would truncate it and re-read the same rows.
    let cursor: { at: string; id: string } = { at: new Date(readyHighWater.getTime() - READY_LOOKBACK_MS).toISOString(), id: "00000000-0000-0000-0000-000000000000" };
    let dispatched = 0;
    for (;;) {
      const { rows } = await pool.query<{ id: string; notebook_id: string; active_revision: number; title: string; media_type: string; updated_at: Date; cursor_at: string; owner_id: string }>(
        `SELECT s.id, s.notebook_id, s.active_revision, s.title, s.media_type, s.updated_at, s.updated_at::text AS cursor_at, n.owner_id
           FROM sources s JOIN notebooks n ON n.id = s.notebook_id
          WHERE s.status = 'Ready' AND s.active_revision IS NOT NULL AND (s.updated_at, s.id) > ($1::timestamptz, $2::uuid)
          ORDER BY s.updated_at, s.id
          LIMIT $3`,
        [cursor.at, cursor.id, readyBatch]
      );
      for (const row of rows) {
        cursor = { at: row.cursor_at, id: row.id };
        if (row.updated_at > readyHighWater) readyHighWater = row.updated_at;
        const key = `${row.id}:${row.active_revision}`;
        if (watched.has(key)) continue;
        try {
          // Ownership comes from PostgreSQL; mirror the notebook so v2 reads it like a request would (D16).
          if (!ownerOf(row.notebook_id)) rememberNotebook({ ...(await getNotebook(pool, row.owner_id, row.notebook_id)), owner_id: row.owner_id });
        } catch {
          continue; // notebook deleted meanwhile
        }
        watched.add(key);
        dispatched += 1;
        void dispatchReady({
          notebook_id: row.notebook_id,
          source_id: row.id,
          revision_id: row.active_revision,
          title: row.title,
          media_type: row.media_type,
          ready_at: row.updated_at.toISOString(),
        });
      }
      if (rows.length < readyBatch) break;
    }
    return dispatched;
  };
  let readyTimer: ReturnType<typeof setInterval> | null = null;
  if (options.readyWatch && hooks.length > 0) {
    let running = false;
    readyTimer = setInterval(() => {
      if (running) return;
      running = true;
      pollReadySources()
        .catch((err) => console.warn(JSON.stringify({ severity: "WARNING", message: `v2 ready watcher: ${(err as Error).message}` })))
        .finally(() => (running = false));
    }, Math.max(10, options.readyWatch.intervalMs));
    readyTimer.unref?.();
  }

  // ---- Package 2.4: Studio reports ----------------------------------------------------------------------
  const repo = new InMemoryStudioArtifactRepository();
  const registry = new StudioPluginRegistry();
  const reportModel = new DeterministicReportModel();
  registry.register(new ReportGeneratorPlugin(options.reportModel ?? reportModel));
  const access = { resolveSnapshot, verifySnapshot };
  // D12 / Constitution IV: Studio jobs read EVERY chunk of the snapshot (keyset pages); the plugin bounds model
  // calls with batchChunks. Chat, Source Guide and Note Assistant keep the bounded `provider` read above.
  const studioContext = {
    async getScopedContext(notebookId: string, activeSourceIds: string[]): Promise<UnifiedDocumentChunk[]> {
      const owner = ownerOf(notebookId);
      if (!owner) throw new InvalidScopeError("Notebook is not available");
      return listAllSnapshotChunks(pool, await captureScopeSnapshot(pool, owner, notebookId, activeSourceIds));
    },
  };
  const runner = new StudioJobRunner({ repo, registry, scopedContext: studioContext, access });
  // A finished, failed or cancelled job changes the artifact, so it advances the notebook's modified time.
  const runAndTouch = {
    async run(id: string) {
      const row = await runner.run(id);
      await touchNotebookModified(row.notebook_id);
      return row;
    },
  };
  // FR-SI-02 / FR-ST-11: guides for the effective output language; a missing language variant is generated on
  // demand (one run per source, revision and language) and reports Pending meanwhile.
  const guides = {
    async getGuides(notebookId: string, snapshot: SourceRevisionPair[], outputLanguage?: string): Promise<SourceGuideState[]> {
      return Promise.all(
        snapshot.map(async (pair): Promise<SourceGuideState> => {
          const guide = await getSourceGuide(notebookId, pair.source_id, pair.revision, outputLanguage);
          const owner = ownerOf(notebookId);
          // Security review 2026-10-20: only a supported FR-UI-02 tag may start an on-demand guide run.
          if (!guide && outputLanguage && options.generation && owner && OutputLanguageSchema.safeParse(outputLanguage).success) {
            startGuide({ notebook_id: notebookId, user_id: owner, source_id: pair.source_id, revision: pair.revision, output_language: outputLanguage });
          }
          if (guide?.status === "GuideReady") {
            return { ...pair, status: "Ready", summary: guide.summary_md, key_topics: guide.key_topics };
          }
          // Without guide generation a missing guide never arrives: report it as unavailable, not endless loading (FR-018).
          if (!guide && !options.generation) return { ...pair, status: "Failed" };
          return { ...pair, status: guide?.status === "GuideFailed" ? "Failed" : "Pending" };
        })
      );
    },
  };
  const studioDeps: StudioServiceDeps = {
    repo,
    registry,
    access,
    dispatcher: new InlineStudioDispatcher(runAndTouch),
    // FR-008 / FR-NM-03: report → cited note (NotesService, sanitized) → v1 note-source through the same admission
    // and ingestion as any note; verified markers are stripped and the citations kept as origin_citations.
    convertToSource: async (input) => {
      const scope = { notebook_id: input.notebook_id, owner_id: input.owner_id, sources: input.snapshot };
      const chunks = new Map((await getSnapshotChunksByIds(pool, scope, input.citations.map((c) => c.chunk_id))).map((c) => [c.chunk_id, c]));
      const titles = new Map((await listSources(pool, input.owner_id, input.notebook_id)).map((s) => [s.id, s.title]));
      const citations: Citation[] = input.citations.map((c) => {
        const chunk = chunks.get(c.chunk_id);
        const title = titles.get(c.source_id);
        if (!chunk || !title) throw new SourceSnapshotInvalidError("A cited source of this report is no longer available");
        return { badge_number: c.badge_number, source_id: c.source_id, source_title: title, chunk_id: c.chunk_id, snippet: c.snippet, locator: chunk.locator };
      });
      const note = await notes.saveStudioReport(input.notebook_id, input.owner_id, { artifact_id: input.artifact_id, title: input.title, content_md: input.content_md, citations });
      const { source } = await notes.convertToSource(input.notebook_id, input.owner_id, { note_ids: [note.id], reuse: true });
      return { source_id: source.id };
    },
    suggestions: new ReportSuggestionService({ guides, model: options.suggestionModel ?? structuredSuggestionModel(options.generation) }),
    // FR-UI-02: requests without output_language use the effective language (notebook > user > en-US).
    resolveOutputLanguage: async (ownerId, notebookId) => (await workspace.resolveLanguagePreferences(ownerId, notebookId)).output_language,
    onNotebookModified: touchNotebookModified,
  };

  return {
    workspace,
    handlers: [
      (req, res, userId) => handleWorkspacePreferencesRoute(req, res, workspace, userId),
      (req, res, userId) => handlePackageV22Route(req, res, userId, v22Deps),
      (req, res, userId) => handleNotesRoute(req, res, { service: notes, verifyOwnership: (nb, uid) => ownerOf(nb) === uid }, userId),
      (req, res, userId) => handleStudioRoute(req, res, studioDeps, userId),
    ],
    syncNotebook(userId, notebook) {
      return rememberNotebook({ ...notebook, owner_id: userId });
    },
    async notebookModified(userId, notebook) {
      rememberNotebook({ ...notebook, owner_id: userId });
      await touchNotebookModified(notebook.id);
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
          ready_at: s.updated_at,
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
    pollReadySources,
    close() {
      if (readyTimer) clearInterval(readyTimer);
      readyTimer = null;
    },
  };
}
