import type { ArtifactDto, StudioApi } from "./api.ts";
import { renderMarkdown } from "./markdown.ts";

export interface StudioRow {
  id: string;
  status: ArtifactDto["status"];
  label: string;
}

export interface StudioArtifactListOptions {
  api: StudioApi;
  clipboard: { writeText(text: string): Promise<void> };
}

export class StudioArtifactListController {
  private artifacts: ArtifactDto[] = [];

  private readonly options: StudioArtifactListOptions;
  constructor(options: StudioArtifactListOptions) {
    this.options = options;
  }

  /** Template buttons require at least one active source (FR-ST-10). */
  templatesEnabled(activeSourceCount: number): boolean {
    return activeSourceCount > 0;
  }

  async refresh(): Promise<void> {
    this.artifacts = await this.options.api.list();
  }

  rows(): StudioRow[] {
    return this.artifacts.map((a) => ({
      id: a.id,
      status: a.status,
      label:
        a.status === "Queued" || a.status === "Running"
          ? `Generating ${a.title}...`
          : a.failure
            ? `${a.title} — ${a.failure.message}`
            : a.title,
    }));
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
    if (!artifact.payload_json) throw new Error(unavailable?.message ?? "Report is not available.");
    return artifact.payload_json.content_md;
  }
}
