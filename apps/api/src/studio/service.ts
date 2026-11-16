import type { StructuredGenerator } from "@everlast/cloud";
import {
  InvalidScopeError,
  SourceSnapshotInvalidError,
  EmptyScopeError,
  CreateStudioJobRequestSchema,
  GradeQuizQuestionRequestSchema,
  RecordLearningProgressRequestSchema,
  ResetLearningProgressRequestSchema,
  RetryStudioJobRequestSchema,
  StudioParamsError,
  type QuizQuestion,
  type ReportCitation,
  type ReportSuggestionsResult,
  type SourceRevisionPair,
  type StudioLearningOverviewPayload,
  type StudioPluginRegistry,
  type StudioPluginType,
  type StudioQuizPayload,
} from "@everlast/contracts";
import {
  extractArtifactLearningItemIds,
  InMemoryLearningProgressRepository,
  StudioRetryNotAllowedError,
  type LearningProgressRepository,
  type StudioArtifactRecord,
  type StudioArtifactRepository,
  type StudioArtifactSummary,
} from "@everlast/db";
import { executeMindmapDrilldown, StudioSupportingSourcesRequiredError, type StudioDrilldownPort } from "./drilldown.ts";
import { executeStudioItemExplain } from "./explain.ts";
import { buildMindmapExportScene } from "./map-export.ts";
import { gradeQuizQuestion } from "./quiz-grader.ts";
import { exportDataTableArtifact } from "./table-export.ts";

/** Owner/scope authorization and snapshot verification (D12); worker and API share the same port. */
export interface StudioAccess {
  resolveSnapshot(ownerId: string, notebookId: string, ids: string[]): Promise<SourceRevisionPair[]>;
  verifySnapshot(ownerId: string, notebookId: string, snapshot: SourceRevisionPair[]): Promise<void>;
}

export interface StudioJobDispatcher {
  enqueue(artifactId: string, ownerId: string): Promise<void>;
}

export interface StudioJobCanceller {
  cancel(artifactId: string): Promise<StudioArtifactRecord>;
}

export type ConvertToSource = (input: {
  notebook_id: string;
  owner_id: string;
  artifact_id: string;
  title: string;
  content_md: string;
  /** Validated report citations; the port carries them to the note so FR-NM-03 strips markers (FR-008). */
  citations: ReportCitation[];
  snapshot: SourceRevisionPair[];
}) => Promise<{ source_id: string }>;

export interface StudioSuggestionsPort {
  getSuggestions(req: {
    notebook_id: string;
    owner_id: string;
    snapshot: SourceRevisionPair[];
    output_language?: string | undefined;
  }): Promise<ReportSuggestionsResult>;
}

export interface StudioServiceDeps {
  repo: StudioArtifactRepository;
  registry: StudioPluginRegistry;
  access: StudioAccess;
  dispatcher: StudioJobDispatcher;
  canceller?: StudioJobCanceller | undefined;
  drilldown?: StudioDrilldownPort | undefined;
  explain?: StudioDrilldownPort | undefined;
  learningProgress?: LearningProgressRepository | undefined;
  quizGraderGenerator?: StructuredGenerator | undefined;
  convertToSource?: ConvertToSource;
  suggestions?: StudioSuggestionsPort;
  /** Effective output language (FR-UI-02: notebook > user > en-US) for requests that omit `output_language`. */
  resolveOutputLanguage?: (ownerId: string, notebookId: string) => Promise<string>;
  /** Advances the notebook's `updated_at` after an artifact write (FR-WM-02). */
  onNotebookModified?: (notebookId: string) => Promise<unknown> | void;
}

export class StudioConflictError extends Error {}
export class StudioNotFoundError extends Error {}
export class StudioNotImplementedError extends Error {}

export interface ArtifactView {
  artifact: StudioArtifactRecord | StudioArtifactSummary;
  unavailable?: { code: "SourceChanged" | "Unauthorized"; message: string };
}

const publicView = <T extends { owner_id: string }>(row: T): Omit<T, "owner_id"> => {
  const { owner_id: _owner, ...rest } = row;
  return rest;
};

function genericTitleForPlugin(pluginType: StudioPluginType): string {
  if (pluginType === "mindmap") return "Mindmap";
  if (pluginType === "data_table") return "Data Table";
  if (pluginType === "flashcards") return "Flashcards";
  if (pluginType === "quiz") return "Quiz";
  if (pluginType === "learning_overview") return "Learning Overview";
  return "Report";
}

function unavailableMessageForPlugin(pluginType: StudioPluginType): string {
  if (pluginType === "mindmap") {
    return "This mindmap is unavailable because its sources changed or are no longer accessible.";
  }
  if (pluginType === "data_table") {
    return "This data table is unavailable because its sources changed or are no longer accessible.";
  }
  if (pluginType === "flashcards") {
    return "These flashcards are unavailable because their sources changed or are no longer accessible.";
  }
  if (pluginType === "quiz") {
    return "This quiz is unavailable because its sources changed or are no longer accessible.";
  }
  if (pluginType === "learning_overview") {
    return "This learning overview is unavailable because its sources changed or are no longer accessible.";
  }
  return "This report is unavailable because its sources changed or are no longer accessible.";
}

function requireScope(ids: unknown): void {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new EmptyScopeError("active_source_ids must contain at least one source UUID.");
  }
}

export class StudioService {
  private readonly deps: StudioServiceDeps;
  private readonly fallbackProgress = new InMemoryLearningProgressRepository();
  constructor(deps: StudioServiceDeps) {
    this.deps = deps;
  }

  private get progressRepo(): LearningProgressRepository {
    return this.deps.learningProgress ?? this.fallbackProgress;
  }

  private async language(ownerId: string, notebookId: string, requested: string | undefined): Promise<string | undefined> {
    return requested ?? (await this.deps.resolveOutputLanguage?.(ownerId, notebookId));
  }

  private async modified<T>(notebookId: string, result: T): Promise<T> {
    await this.deps.onNotebookModified?.(notebookId);
    return result;
  }

  async create(ownerId: string, notebookId: string, body: unknown) {
    requireScope((body as { active_source_ids?: unknown } | null)?.active_source_ids);
    const req = CreateStudioJobRequestSchema.parse(body);
    const plugin = this.deps.registry.get(req.plugin_type);
    const snapshot = await this.deps.access.resolveSnapshot(ownerId, notebookId, req.active_source_ids);
    const output_language = await this.language(ownerId, notebookId, req.output_language);
    const plan = plugin.triggerJob({
      notebook_id: notebookId,
      subtype: req.subtype,
      params: {
        custom_prompt: req.custom_prompt,
        focus_prompt: req.focus_prompt,
        schema_id: req.schema_id,
        difficulty: req.difficulty,
        card_count: req.card_count,
        question_count: req.question_count,
        section_count: req.section_count,
      },
      snapshot,
      output_language,
    });
    const row = await this.deps.repo.createQueued({
      notebook_id: notebookId,
      owner_id: ownerId,
      plugin_type: req.plugin_type,
      subtype: req.subtype,
      title: plan.title,
      params_json: plan.params_json,
      snapshot,
      output_language,
    });
    await this.deps.dispatcher.enqueue(row.id, ownerId);
    return this.modified(notebookId, publicView(row));
  }

  async list(ownerId: string, notebookId: string) {
    const rows = await this.deps.repo.list(notebookId, ownerId);
    // PR #161 review: reports keep their title as in v2 and get(); new kinds whose captured sources are no longer
    // available show a generic title. One check per distinct snapshot, and any failed check fails closed for that
    // row only, so the panel's polling list never turns into a 500.
    const checks = new Map<string, Promise<boolean>>();
    const available = (snapshot: SourceRevisionPair[]) => {
      const key = JSON.stringify(snapshot);
      let check = checks.get(key);
      if (!check) {
        check = this.deps.access.verifySnapshot(ownerId, notebookId, snapshot).then(
          () => true,
          () => false
        );
        checks.set(key, check);
      }
      return check;
    };
    return Promise.all(
      rows.map(async (row) =>
        row.plugin_type === "report" || (await available(row.source_revisions_snapshot))
          ? publicView(row)
          : publicView({ ...row, title: genericTitleForPlugin(row.plugin_type) })
      )
    );
  }

  async get(ownerId: string, notebookId: string, id: string) {
    const row = await this.owned(ownerId, notebookId, id);
    if (row.status === "Completed") {
      try {
        await this.deps.access.verifySnapshot(ownerId, notebookId, row.source_revisions_snapshot);
      } catch (err) {
        if (err instanceof SourceSnapshotInvalidError || err instanceof InvalidScopeError) {
          return {
            artifact: publicView({
              ...row,
              title: row.plugin_type === "report" ? row.title : genericTitleForPlugin(row.plugin_type),
              payload_json: null,
            }),
            unavailable: {
              code: err instanceof InvalidScopeError ? ("Unauthorized" as const) : ("SourceChanged" as const),
              message: unavailableMessageForPlugin(row.plugin_type),
            },
          };
        }
        throw err;
      }
    }
    return { artifact: publicView(row) };
  }

  async cancel(ownerId: string, notebookId: string, id: string) {
    const row = await this.owned(ownerId, notebookId, id);
    // FR-017: Legacy v2 reports do not support cancellation (404 Not Found per FR-ST-10 contract).
    if (row.plugin_type === "report") {
      throw new StudioNotFoundError("Cancellation is not supported for report artifacts.");
    }
    if (row.status !== "Queued" && row.status !== "Running") {
      throw new StudioConflictError("Only Queued or Running artifacts can be cancelled.");
    }
    const cancelled = this.deps.canceller ? await this.deps.canceller.cancel(id) : await this.deps.repo.cancel(id);
    return this.modified(notebookId, publicView(cancelled));
  }

  async retry(ownerId: string, notebookId: string, id: string, body: unknown) {
    const prev = await this.owned(ownerId, notebookId, id);
    if (prev.status !== "Failed" && prev.status !== "Cancelled") {
      throw new StudioConflictError("Only Failed or Cancelled artifacts can be retried.");
    }
    requireScope((body as { active_source_ids?: unknown } | null)?.active_source_ids);
    const req = RetryStudioJobRequestSchema.parse(body);
    const snapshot = await this.deps.access.resolveSnapshot(ownerId, notebookId, req.active_source_ids);
    try {
      const row = await this.deps.repo.createRetry({
        previous_id: id,
        owner_id: ownerId,
        snapshot,
        output_language: await this.language(ownerId, notebookId, req.output_language),
      });
      await this.deps.dispatcher.enqueue(row.id, ownerId);
      return this.modified(notebookId, publicView(row));
    } catch (err) {
      if (err instanceof StudioRetryNotAllowedError) throw new StudioConflictError(err.message);
      throw err;
    }
  }

  async convert(ownerId: string, notebookId: string, id: string) {
    const row = await this.owned(ownerId, notebookId, id);
    if (row.plugin_type !== "report") {
      throw new StudioConflictError("Only report artifacts can be converted to a source.");
    }
    if (row.status !== "Completed" || !row.payload_json || !("content_md" in row.payload_json)) {
      throw new StudioConflictError("Only Completed artifacts can be converted.");
    }
    if (!this.deps.convertToSource) throw new StudioNotImplementedError("Convert to source is not configured.");
    await this.deps.access.verifySnapshot(ownerId, notebookId, row.source_revisions_snapshot);
    const converted = await this.deps.convertToSource({
      notebook_id: notebookId,
      owner_id: ownerId,
      artifact_id: row.id,
      title: row.title,
      content_md: row.payload_json.content_md,
      citations: row.payload_json.citations,
      snapshot: row.source_revisions_snapshot,
    });
    return this.modified(notebookId, converted);
  }

  async remove(ownerId: string, notebookId: string, id: string): Promise<void> {
    if (!(await this.deps.repo.delete(notebookId, ownerId, id))) throw new StudioNotFoundError("Artifact not found.");
    await this.modified(notebookId, undefined);
  }

  async suggestions(ownerId: string, notebookId: string, body: unknown) {
    const b = (body ?? {}) as { active_source_ids?: unknown; output_language?: unknown };
    requireScope(b.active_source_ids);
    if (!this.deps.suggestions) throw new StudioNotImplementedError("Suggestions are not configured.");
    const ids = RetryStudioJobRequestSchema.parse({
      active_source_ids: b.active_source_ids,
      ...(typeof b.output_language === "string" ? { output_language: b.output_language } : {}),
    });
    const snapshot = await this.deps.access.resolveSnapshot(ownerId, notebookId, ids.active_source_ids);
    return this.deps.suggestions.getSuggestions({
      notebook_id: notebookId,
      owner_id: ownerId,
      snapshot,
      output_language: await this.language(ownerId, notebookId, ids.output_language),
    });
  }

  async drilldown(ownerId: string, notebookId: string, id: string, body: unknown) {
    const row = await this.owned(ownerId, notebookId, id);
    if (row.plugin_type !== "mindmap" || row.status !== "Completed" || !row.payload_json || !("root_node" in row.payload_json)) {
      throw new StudioConflictError("Only Completed mindmap artifacts support node drilldown.");
    }
    await this.deps.access.verifySnapshot(ownerId, notebookId, row.source_revisions_snapshot);
    if (!this.deps.drilldown) {
      throw new StudioNotImplementedError("Mindmap drilldown is not configured.");
    }
    const res = await executeMindmapDrilldown({
      ownerId,
      notebookId,
      payload: row.payload_json as unknown as import("@everlast/contracts").StudioMindmapPayload,
      rawRequest: body,
      port: this.deps.drilldown,
    });
    return this.modified(notebookId, res);
  }

  async exportMindmap(ownerId: string, notebookId: string, id: string, body: unknown) {
    const row = await this.owned(ownerId, notebookId, id);
    if (row.plugin_type !== "mindmap" || row.status !== "Completed" || !row.payload_json || !("root_node" in row.payload_json)) {
      throw new StudioConflictError("Only Completed mindmap artifacts support map export.");
    }
    await this.deps.access.verifySnapshot(ownerId, notebookId, row.source_revisions_snapshot);
    return buildMindmapExportScene(
      row.title,
      row.payload_json as unknown as import("@everlast/contracts").StudioMindmapPayload,
      body
    );
  }

  async exportDataTable(ownerId: string, notebookId: string, id: string, body: unknown) {
    const row = await this.owned(ownerId, notebookId, id);
    if (row.plugin_type !== "data_table" || row.status !== "Completed" || !row.payload_json || !("rows" in row.payload_json)) {
      throw new StudioConflictError("Only Completed data_table artifacts support table export.");
    }
    await this.deps.access.verifySnapshot(ownerId, notebookId, row.source_revisions_snapshot);
    return exportDataTableArtifact({
      artifactId: row.id,
      payload: row.payload_json as unknown as import("@everlast/contracts").StudioDataTablePayload,
      body,
    });
  }

  private isActiveLearningPlugin(pluginType: StudioPluginType): boolean {
    return pluginType === "flashcards" || pluginType === "quiz" || pluginType === "learning_overview";
  }

  private async completedActiveLearning(ownerId: string, notebookId: string, id: string): Promise<StudioArtifactRecord> {
    const row = await this.owned(ownerId, notebookId, id);
    if (!this.isActiveLearningPlugin(row.plugin_type) || row.status !== "Completed" || !row.payload_json) {
      throw new StudioConflictError("Only Completed flashcards, quiz, or learning_overview artifacts support this action.");
    }
    await this.deps.access.verifySnapshot(ownerId, notebookId, row.source_revisions_snapshot);
    return row;
  }

  async getProgress(ownerId: string, notebookId: string, id: string) {
    const row = await this.owned(ownerId, notebookId, id);
    if (!this.isActiveLearningPlugin(row.plugin_type)) {
      throw new StudioConflictError("Learning progress is only supported for flashcards, quiz, and learning_overview artifacts.");
    }
    const progress = (await this.progressRepo.get(ownerId, id)) ?? {
      user_id: ownerId,
      artifact_id: id,
      notebook_id: notebookId,
      item_states_json: {},
      updated_at: row.updated_at,
    };
    return { progress };
  }

  async recordProgress(ownerId: string, notebookId: string, id: string, body: unknown) {
    const row = await this.completedActiveLearning(ownerId, notebookId, id);
    const req = RecordLearningProgressRequestSchema.parse(body);
    const validIds = extractArtifactLearningItemIds(row.plugin_type, row.payload_json);
    if (!validIds.has(req.item_id)) {
      throw new StudioParamsError(`Item ${req.item_id} does not belong to artifact ${id}.`);
    }
    const progress = await this.progressRepo.recordAttempt({
      userId: ownerId,
      artifactId: id,
      notebookId,
      itemId: req.item_id,
      outcome: req.outcome,
    });
    return this.modified(notebookId, { progress });
  }

  async resetProgress(ownerId: string, notebookId: string, id: string, body: unknown, skipConfirm = false) {
    const row = await this.owned(ownerId, notebookId, id);
    if (!this.isActiveLearningPlugin(row.plugin_type)) {
      throw new StudioConflictError("Learning progress is only supported for flashcards, quiz, and learning_overview artifacts.");
    }
    if (!skipConfirm) {
      ResetLearningProgressRequestSchema.parse(body);
    }
    const progress = await this.progressRepo.reset(ownerId, id);
    return this.modified(notebookId, { progress });
  }

  async gradeQuiz(ownerId: string, notebookId: string, id: string, body: unknown) {
    const row = await this.completedActiveLearning(ownerId, notebookId, id);
    if (row.plugin_type !== "quiz" && row.plugin_type !== "learning_overview") {
      throw new StudioConflictError("Only Completed quiz or learning_overview artifacts support quiz grading.");
    }
    const req = GradeQuizQuestionRequestSchema.parse(body);
    let targetQuestion: QuizQuestion | undefined;
    if (row.plugin_type === "quiz" && row.payload_json && "questions" in row.payload_json) {
      targetQuestion = (row.payload_json as unknown as StudioQuizPayload).questions.find((q) => q.id === req.question_id);
    } else if (row.plugin_type === "learning_overview" && row.payload_json && "modules" in row.payload_json) {
      for (const mod of (row.payload_json as unknown as StudioLearningOverviewPayload).modules) {
        const found = mod.checkpoint_quiz.find((q) => q.id === req.question_id);
        if (found) {
          targetQuestion = found;
          break;
        }
      }
    }
    if (!targetQuestion) {
      throw new StudioParamsError(`Question ${req.question_id} does not belong to artifact ${id}.`);
    }
    const graded = await gradeQuizQuestion({
      question: targetQuestion,
      answer: req.answer,
      generator: this.deps.quizGraderGenerator,
    });
    const progress = await this.progressRepo.recordAttempt({
      userId: ownerId,
      artifactId: id,
      notebookId,
      itemId: targetQuestion.id,
      outcome: graded.outcome,
    });
    return this.modified(notebookId, { ...graded, progress });
  }

  async explainItem(ownerId: string, notebookId: string, id: string, body: unknown) {
    const row = await this.completedActiveLearning(ownerId, notebookId, id);
    const port = this.deps.explain ?? this.deps.drilldown;
    if (!port) {
      throw new StudioNotImplementedError("Explain to chat is not configured.");
    }
    const res = await executeStudioItemExplain({
      ownerId,
      notebookId,
      artifact: row,
      rawRequest: body,
      port,
    });
    return this.modified(notebookId, res);
  }

  async ownedArtifact(ownerId: string, notebookId: string, id: string): Promise<StudioArtifactRecord> {
    return this.owned(ownerId, notebookId, id);
  }

  private async owned(ownerId: string, notebookId: string, id: string): Promise<StudioArtifactRecord> {
    const row = await this.deps.repo.get(notebookId, ownerId, id);
    if (!row) throw new StudioNotFoundError("Artifact not found.");
    return row;
  }
}
