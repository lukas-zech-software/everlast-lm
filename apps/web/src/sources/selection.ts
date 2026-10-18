/**
 * Source Selection Controller (FR-SI-03, C-02).
 * Manages client/session active source selection ($S_aktiv),
 * tri-state master selection, and badge counter notifications.
 */

export interface SourceItem {
  id: string;
  notebook_id: string;
  title: string;
  media_type: "application/pdf" | "text/plain" | "text/markdown" | "copied_text";
  status: "Uploading" | "Processing" | "Ready" | "Failed";
  revision_id: number;
}

export type SelectionMasterState = "AllSelected" | "PartialSelected" | "NoneSelected";

export interface SourceSelectionOptions {
  notebookId: string;
  initialSources?: SourceItem[];
}

export interface SubmissionSnapshot {
  notebook_id: string;
  active_source_ids: string[];
}

export class SourceSelectionController {
  private sources = new Map<string, SourceItem>();
  private selectedSourceIds = new Set<string>();
  private listeners = new Set<() => void>();

  constructor(private readonly options: SourceSelectionOptions) {
    if (options.initialSources) {
      for (const s of options.initialSources) {
        this.sources.set(s.id, s);
        // All Ready sources default to selected
        if (s.status === "Ready") {
          this.selectedSourceIds.add(s.id);
        }
      }
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  getSources(): SourceItem[] {
    return Array.from(this.sources.values());
  }

  getMasterState(): SelectionMasterState {
    const readySources = Array.from(this.sources.values()).filter((s) => s.status === "Ready");
    if (readySources.length === 0 || this.selectedSourceIds.size === 0) {
      return "NoneSelected";
    }
    if (this.selectedSourceIds.size === readySources.length) {
      return "AllSelected";
    }
    return "PartialSelected";
  }

  getSelectedSourceIds(): string[] {
    return Array.from(this.selectedSourceIds);
  }

  toggleSource(sourceId: string, selected?: boolean): void {
    const source = this.sources.get(sourceId);
    if (!source || source.status !== "Ready") {
      return;
    }

    const shouldSelect = selected !== undefined ? selected : !this.selectedSourceIds.has(sourceId);
    if (shouldSelect) {
      this.selectedSourceIds.add(sourceId);
    } else {
      this.selectedSourceIds.delete(sourceId);
    }

    this.notify();
  }

  toggleMaster(): void {
    const currentState = this.getMasterState();
    if (currentState === "AllSelected") {
      this.deselectAll();
    } else {
      this.selectAll();
    }
  }

  selectAll(): void {
    for (const source of this.sources.values()) {
      if (source.status === "Ready") {
        this.selectedSourceIds.add(source.id);
      }
    }
    this.notify();
  }

  deselectAll(): void {
    this.selectedSourceIds.clear();
    this.notify();
  }

  getBadgeText(): string {
    const count = this.selectedSourceIds.size;
    if (count === 1) {
      return "1 source";
    }
    return `${count} sources`;
  }

  isChatSubmitDisabled(): boolean {
    return this.selectedSourceIds.size === 0;
  }

  getZeroSourcesWarning(): string {
    return "Select at least one source to chat";
  }

  addSource(source: SourceItem, options?: { isImportingSession?: boolean }): void {
    if (source.notebook_id !== this.options.notebookId) {
      throw new Error(`Cannot add cross-notebook source: expected ${this.options.notebookId}, got ${source.notebook_id}`);
    }

    this.sources.set(source.id, source);

    // Auto-select newly Ready source in the importing user's session only
    if (source.status === "Ready" && options?.isImportingSession) {
      this.selectedSourceIds.add(source.id);
    }

    this.notify();
  }

  removeSource(sourceId: string): void {
    this.sources.delete(sourceId);
    this.selectedSourceIds.delete(sourceId);
    this.notify();
  }

  createSubmissionSnapshot(): SubmissionSnapshot {
    return {
      notebook_id: this.options.notebookId,
      active_source_ids: Array.from(this.selectedSourceIds),
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
