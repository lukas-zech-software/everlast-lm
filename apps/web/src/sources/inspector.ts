import type { UnifiedDocumentChunk } from "@everlast/contracts";
import type { SourceStatus } from "@everlast/contracts";

/**
 * State of the Source Inspector (FR-SI-04).
 * States: Closed (List View) <-> Open (Document View) <-> Open & Highlighted (Chunk Focused)
 */
export interface SourceInspectorState {
  status: "closed" | "open" | "highlighted";
  sourceId: string | null;
  sourceTitle: string | null;
  chunks: UnifiedDocumentChunk[];
  highlightChunkId: string | null;
  loading: boolean;
  error: string | null;
}

export interface SourceInspectorControllerOptions {
  notebookId: string;
  fetchSourceChunks?: (sourceId: string) => Promise<UnifiedDocumentChunk[]>;
  validateNotebookSource?: (notebookId: string, sourceId: string) => Promise<boolean>;
  getSourceStatus?: (sourceId: string) => Promise<SourceStatus>;
}

/**
 * Domain controller for the Source Inspector / Viewer (FR-SI-04, C-02).
 * Singleton read scope ensures chat active selection is never mutated.
 */
export class SourceInspectorController {
  private readonly notebookId: string;
  private readonly fetchSourceChunks?: (sourceId: string) => Promise<UnifiedDocumentChunk[]>;
  private readonly validateNotebookSource?: (notebookId: string, sourceId: string) => Promise<boolean>;
  private readonly getSourceStatus?: (sourceId: string) => Promise<SourceStatus>;

  private state: SourceInspectorState = {
    status: "closed",
    sourceId: null,
    sourceTitle: null,
    chunks: [],
    highlightChunkId: null,
    loading: false,
    error: null,
  };

  private listeners = new Set<(state: SourceInspectorState) => void>();

  constructor(options: SourceInspectorControllerOptions) {
    this.notebookId = options.notebookId;
    if (options.fetchSourceChunks) this.fetchSourceChunks = options.fetchSourceChunks;
    if (options.validateNotebookSource) this.validateNotebookSource = options.validateNotebookSource;
    if (options.getSourceStatus) this.getSourceStatus = options.getSourceStatus;
  }

  public getState(): SourceInspectorState {
    return { ...this.state };
  }

  public subscribe(listener: (state: SourceInspectorState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const currentState = this.getState();
    for (const listener of this.listeners) {
      listener(currentState);
    }
  }

  /**
   * Opens the full text viewer for a specific source and optionally highlights a chunk.
   */
  public async openSource(
    sourceId: string,
    title?: string,
    highlightChunkId?: string | null
  ): Promise<void> {
    this.state.loading = true;
    this.state.error = null;
    this.notify();

    // 1. Validate notebook ownership / tenant isolation (C-02, FR-SI-04)
    if (this.validateNotebookSource) {
      const isValid = await this.validateNotebookSource(this.notebookId, sourceId);
      if (!isValid) {
        this.state = {
          status: "closed",
          sourceId: null,
          sourceTitle: null,
          chunks: [],
          highlightChunkId: null,
          loading: false,
          error: "Source does not belong to notebook",
        };
        this.notify();
        return;
      }
    }

    // 2. Validate source readiness
    if (this.getSourceStatus) {
      const status = await this.getSourceStatus(sourceId);
      if (status !== "Ready") {
        this.state = {
          status: "closed",
          sourceId: null,
          sourceTitle: null,
          chunks: [],
          highlightChunkId: null,
          loading: false,
          error: "Source is not ready for inspection",
        };
        this.notify();
        return;
      }
    }

    // 3. Fetch ordered canonical chunks
    let chunks: UnifiedDocumentChunk[] = [];
    if (this.fetchSourceChunks) {
      chunks = await this.fetchSourceChunks(sourceId);
    }

    // 4. Validate highlight chunk if requested
    let validHighlightId: string | null = null;
    if (highlightChunkId) {
      const found = chunks.some((c) => c.chunk_id === highlightChunkId);
      if (found) {
        validHighlightId = highlightChunkId;
      }
      // If not found, falls back gracefully to null (scroll to top)
    }

    this.state = {
      status: validHighlightId ? "highlighted" : "open",
      sourceId,
      sourceTitle: title ?? null,
      chunks,
      highlightChunkId: validHighlightId,
      loading: false,
      error: null,
    };

    this.notify();
  }

  /**
   * Highlights a specific chunk in the currently opened source.
   */
  public highlightChunk(chunkId: string): void {
    if (this.state.status === "closed" || !this.state.sourceId) {
      return;
    }

    const chunkExists = this.state.chunks.some((c) => c.chunk_id === chunkId);
    if (!chunkExists) {
      return;
    }

    this.state.status = "highlighted";
    this.state.highlightChunkId = chunkId;
    this.notify();
  }

  /**
   * Closes the inspector view and restores the standard source list.
   */
  public close(): void {
    this.state = {
      status: "closed",
      sourceId: null,
      sourceTitle: null,
      chunks: [],
      highlightChunkId: null,
      loading: false,
      error: null,
    };
    this.notify();
  }

  /**
   * Reconstructs full document text from ordered chunks.
   */
  public reconstructFullText(): string {
    return this.state.chunks.map((c) => c.text).join(" ");
  }
}
