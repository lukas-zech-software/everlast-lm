import type { ArtifactDto, StudioApi } from "./api.ts";
import { renderMarkdown } from "./markdown.ts";

export interface StudioRow {
  id: string;
  plugin_type: ArtifactDto["plugin_type"];
  subtype: ArtifactDto["subtype"];
  status: ArtifactDto["status"];
  title: string;
  label: string;
  /** Queued or Running: the row shows a generating indicator (FR-ST-10 FR-006). */
  generating: boolean;
  /** True only for Queued/Running mindmaps and data tables (FR-017: v2 reports have no cancel action). */
  cancellable: boolean;
  /** Failed or Cancelled explanation. */
  failure: string | null;
}

export interface StudioArtifactListOptions {
  api: StudioApi;
  clipboard: { writeText(text: string): Promise<void> };
}

export interface ArtifactView {
  artifact: ArtifactDto;
  unavailable?: { code: string; message: string } | undefined;
}

const isActive = (status: ArtifactDto["status"]): boolean => status === "Queued" || status === "Running";

/** Studio artifact list and actions (FR-ST-08/10/18, FR-008, FR-017). */
export class StudioArtifactListController {
  private artifacts: ArtifactDto[] = [];

  private readonly options: StudioArtifactListOptions;
  constructor(options: StudioArtifactListOptions) {
    this.options = options;
  }

  /** Template and generation buttons require at least one active source (FR-ST-10, FR-001, FR-007). */
  templatesEnabled(activeSourceCount: number): boolean {
    return activeSourceCount > 0;
  }

  async refresh(): Promise<void> {
    this.artifacts = await this.options.api.list();
  }

  /** Shows a just-created job at once (newest first) before the next list read. */
  upsert(artifact: ArtifactDto): void {
    this.artifacts = [artifact, ...this.artifacts.filter((a) => a.id !== artifact.id)];
  }

  hasActiveJobs(): boolean {
    return this.artifacts.some((a) => isActive(a.status));
  }

  rows(): StudioRow[] {
    return this.artifacts.map((a) => ({
      id: a.id,
      plugin_type: a.plugin_type ?? "report",
      subtype: a.subtype,
      status: a.status,
      title: a.title,
      generating: isActive(a.status),
      cancellable: isActive(a.status) && (a.plugin_type === "mindmap" || a.plugin_type === "data_table"),
      failure: a.failure?.message ?? null,
      label: isActive(a.status) ? `Generating ${a.title}...` : a.failure ? `${a.title} — ${a.failure.message}` : a.title,
    }));
  }

  async cancel(id: string): Promise<ArtifactDto> {
    if (!this.options.api.cancel) throw new Error("Cancel is not supported.");
    const artifact = await this.options.api.cancel(id);
    this.upsert(artifact);
    return artifact;
  }

  /** Retry is a new attempt with the caller's current explicit scope (C-03, FR-013). */
  async retry(id: string, activeSourceIds: string[]): Promise<ArtifactDto> {
    if (activeSourceIds.length === 0) throw new Error("Select at least one source.");
    const artifact = await this.options.api.retry(id, activeSourceIds);
    this.upsert(artifact);
    return artifact;
  }

  view(id: string): Promise<ArtifactView> {
    return this.options.api.get(id);
  }

  async open(id: string): Promise<string> {
    const md = await this.markdown(id);
    return renderMarkdown(md);
  }

  async copy(id: string): Promise<void> {
    await this.options.clipboard.writeText(await this.markdown(id));
  }

  async convert(id: string): Promise<{ source_id: string }> {
    return this.options.api.convert(id);
  }

  async remove(id: string): Promise<void> {
    await this.options.api.remove(id);
    this.artifacts = this.artifacts.filter((a) => a.id !== id);
  }

  private async markdown(id: string): Promise<string> {
    const { artifact, unavailable } = await this.options.api.get(id);
    if (!artifact.payload_json || !("content_md" in artifact.payload_json)) {
      throw new Error(unavailable?.message ?? "Report is not available.");
    }
    return artifact.payload_json.content_md;
  }
}
