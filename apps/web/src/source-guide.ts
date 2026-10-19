export interface SourceGuideView {
  status: "GuidePending" | "GuideReady" | "GuideFailed";
  summary_md?: string;
  key_topics?: string[];
  error?: string;
}
export interface SourceGuideControllerOptions {
  notebookId: string;
  fetcher?: typeof fetch;
  onTopic?: (topic: string, sourceId: string) => void;
}

export class SourceGuideController {
  private guide: SourceGuideView | null = null;
  private sourceId: string | null = null;
  private revision = 0;
  private expanded = false;
  private pendingAttempts = 0;
  private loadGeneration = 0;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private container: HTMLElement | null = null;
  private readonly fetcher: typeof fetch;

  private readonly options: SourceGuideControllerOptions;
  constructor(options: SourceGuideControllerOptions) {
    this.options = options;
    this.fetcher = options.fetcher ?? fetch;
  }

  async load(sourceId: string, revision: number): Promise<SourceGuideView> {
    if (this.sourceId !== sourceId || this.revision !== revision) {
      this.pendingAttempts = 0;
      this.loadGeneration += 1;
      if (this.pendingTimer) clearTimeout(this.pendingTimer);
    }
    const generation = this.loadGeneration;
    this.sourceId = sourceId;
    this.revision = revision;
    this.guide = { status: "GuidePending" };
    try {
      const response = await this.fetcher(`/api/notebooks/${this.options.notebookId}/sources/${sourceId}/guide?revision=${revision}`);
      if (response.status === 202) return this.guide;
      if (!response.ok) throw new Error(`Guide unavailable (${response.status})`);
      this.guide = await response.json() as SourceGuideView;
    } catch (error) {
      this.guide = { status: "GuideFailed", error: error instanceof Error ? error.message : "Guide unavailable" };
    }
    return this.getState();
  }

  getState(): SourceGuideView {
    if (!this.guide) return { status: "GuidePending" };
    return { ...this.guide, ...(this.guide.key_topics ? { key_topics: [...this.guide.key_topics] } : {}) };
  }

  setExpanded(expanded: boolean): void { this.expanded = expanded; }

  render(container: HTMLElement): void {
    this.container = container;
    const guide = this.guide;
    const summary = guide?.status === "GuideReady" && this.expanded ? `<p>${escapeHtml(guide.summary_md ?? "")}</p>` : "";
    const topics = guide?.status === "GuideReady" && this.expanded
      ? (guide.key_topics ?? []).map((topic) => `<button type="button" data-topic="${escapeHtml(topic)}">${escapeHtml(topic)}</button>`).join("")
      : "";
    const label = guide?.status === "GuideReady" ? "Source guide" : guide?.status === "GuideFailed" ? "Guide unavailable" : "Guide is being prepared";
    container.innerHTML = `<section class="source-guide" data-status="${guide?.status ?? "GuidePending"}"><button type="button" class="source-guide-toggle" aria-expanded="${this.expanded}">${label}</button><div class="source-guide-content" ${this.expanded ? "" : "hidden"}>${summary}${topics}${guide?.status === "GuideFailed" ? `<p>${escapeHtml(guide.error ?? "")}</p>` : ""}</div></section>`;
    container.querySelector(".source-guide-toggle")?.addEventListener("click", () => {
      this.expanded = !this.expanded;
      this.render(container);
    });
    container.querySelectorAll<HTMLButtonElement>("[data-topic]").forEach((button) => button.addEventListener("click", () => {
      if (this.sourceId) this.options.onTopic?.(button.dataset.topic ?? "", this.sourceId);
    }));
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
