import {
  InvalidScopeError,
  SourceSnapshotInvalidError,
  EmptyScopeError,
  CreateStudioJobRequestSchema,
  RetryStudioJobRequestSchema,
  type ReportSuggestionsResult,
  type SourceRevisionPair,
  type StudioPluginRegistry,
} from "@everlast/contracts";
import {
  StudioRetryNotAllowedError,
  type StudioArtifactRecord,
  type StudioArtifactRepository,
  type StudioArtifactSummary,
} from "@everlast/db";

/** Owner/scope authorization and snapshot verification (D12); worker and API share the same port. */
export interface StudioAccess {
  resolveSnapshot(ownerId: string, notebookId: string, ids: string[]): Promise<SourceRevisionPair[]>;
  verifySnapshot(ownerId: string, notebookId: string, snapshot: SourceRevisionPair[]): Promise<void>;
}

export interface StudioJobDispatcher {
  enqueue(artifactId: string, ownerId: string): Promise<void>;
}

export type ConvertToSource = (input: {
  notebook_id: string;
  owner_id: string;
  title: string;
  content_md: string;
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
  convertToSource?: ConvertToSource;
  suggestions?: StudioSuggestionsPort;
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

function requireScope(ids: unknown): void {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new EmptyScopeError("active_source_ids must contain at least one source UUID.");
  }
}

export class StudioService {
  constructor(private readonly deps: StudioServiceDeps) {}

  async create(ownerId: string, notebookId: string, body: unknown) {
    requireScope((body as { active_source_ids?: unknown } | null)?.active_source_ids);
    const req = CreateStudioJobRequestSchema.parse(body);
    const plugin = this.deps.registry.get(req.plugin_type);
    const snapshot = await this.deps.access.resolveSnapshot(ownerId, notebookId, req.active_source_ids);
    const plan = plugin.triggerJob({
      notebook_id: notebookId,
      subtype: req.subtype,
      params: { custom_prompt: req.custom_prompt },
      snapshot,
      output_language: req.output_language,
    });
    const row = await this.deps.repo.createQueued({
      notebook_id: notebookId,
      owner_id: ownerId,
      subtype: req.subtype,
      title: plan.title,
      params_json: plan.params_json,
      snapshot,
      output_language: req.output_language,
    });
    await this.deps.dispatcher.enqueue(row.id, ownerId);
    return publicView(row);
  }

  async list(ownerId: string, notebookId: string) {
    return (await this.deps.repo.list(notebookId, ownerId)).map(publicView);
  }

  async get(ownerId: string, notebookId: string, id: string) {
    const row = await this.owned(ownerId, notebookId, id);
    if (row.status === "Completed") {
      try {
        await this.deps.access.verifySnapshot(ownerId, notebookId, row.active_source_ids_snapshot);
      } catch (err) {
        if (err instanceof SourceSnapshotInvalidError || err instanceof InvalidScopeError) {
          return {
            artifact: publicView({ ...row, payload_json: null }),
            unavailable: {
              code: err instanceof InvalidScopeError ? ("Unauthorized" as const) : ("SourceChanged" as const),
              message: "This report is unavailable because its sources changed or are no longer accessible.",
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
    if (row.status !== "Queued" && row.status !== "Running") throw new StudioConflictError("Artifact is already finished.");
    return publicView(await this.deps.repo.cancel(id));
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
        output_language: req.output_language,
      });
      await this.deps.dispatcher.enqueue(row.id, ownerId);
      return publicView(row);
    } catch (err) {
      if (err instanceof StudioRetryNotAllowedError) throw new StudioConflictError(err.message);
      throw err;
    }
  }

  async convert(ownerId: string, notebookId: string, id: string) {
    const row = await this.owned(ownerId, notebookId, id);
    if (row.status !== "Completed" || !row.payload_json) throw new StudioConflictError("Only Completed artifacts can be converted.");
    if (!this.deps.convertToSource) throw new StudioNotImplementedError("Convert to source is not configured.");
    await this.deps.access.verifySnapshot(ownerId, notebookId, row.active_source_ids_snapshot);
    return this.deps.convertToSource({
      notebook_id: notebookId,
      owner_id: ownerId,
      title: row.title,
      content_md: row.payload_json.content_md,
    });
  }

  async remove(ownerId: string, notebookId: string, id: string): Promise<void> {
    if (!(await this.deps.repo.delete(notebookId, ownerId, id))) throw new StudioNotFoundError("Artifact not found.");
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
      output_language: ids.output_language,
    });
  }

  private async owned(ownerId: string, notebookId: string, id: string): Promise<StudioArtifactRecord> {
    const row = await this.deps.repo.get(notebookId, ownerId, id);
    if (!row) throw new StudioNotFoundError("Artifact not found.");
    return row;
  }
}
