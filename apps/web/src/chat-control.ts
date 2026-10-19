export interface SourceRevision { source_id: string; revision: number }
export interface ChatConfig { style: "default" | "learning_guide" | "analyst" | "custom"; custom_instructions?: string; response_length: "default" | "longer" | "shorter" }
export interface CitationBadge { badge_number: number }
export interface ChatControlOptions {
  notebookId: string;
  submit: (prompt: string) => void;
  fetcher?: typeof fetch;
}

export function scopeSignature(revisions: SourceRevision[], language: string): string {
  return JSON.stringify({ revisions: [...revisions].sort((a, b) => a.source_id.localeCompare(b.source_id)), language });
}

export function stripCitationBadges(content: string, citations: CitationBadge[]): string {
  const badgeNumbers = [...new Set(citations.map((citation) => citation.badge_number))];
  if (!badgeNumbers.length) return content;
  const pattern = new RegExp(`\\s*\\[(?:${badgeNumbers.join("|")})\\]`, "g");
  return content.replace(pattern, "");
}

export class ChatControlController {
  private signature = "";
  private overview: { signature: string; overview_md: string; starter_prompts: string[] } | null = null;
  private followups: { signature: string; suggestions: string[] } | null = null;
  private streaming = false;
  private configuration: ChatConfig = { style: "default", response_length: "default" };
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: ChatControlOptions) { this.fetcher = options.fetcher ?? fetch; }

  updateScope(revisions: SourceRevision[], language: string): void {
    const next = scopeSignature(revisions, language);
    if (next !== this.signature) { this.signature = next; this.overview = null; this.followups = null; }
  }
  setOverview(value: { overview_md: string; starter_prompts: string[] }, signature = this.signature): void { this.overview = signature === this.signature ? { ...value, signature } : null; }
  setFollowUps(suggestions: string[], signature = this.signature): void { this.followups = !this.streaming && signature === this.signature ? { suggestions: [...suggestions], signature } : null; }
  setStreaming(value: boolean): void { this.streaming = value; if (value) this.followups = null; }
  getOverview() { return this.overview?.signature === this.signature ? this.overview : null; }
  getFollowUps() { return !this.streaming && this.followups?.signature === this.signature ? [...this.followups.suggestions] : []; }
  submitStarterPrompt(prompt: string): void { this.options.submit(prompt); }
  submitFollowUp(prompt: string): void { if (!this.streaming && this.getFollowUps().includes(prompt)) this.options.submit(prompt); }
  getConfiguration(): ChatConfig { return { ...this.configuration }; }

  async saveConfiguration(configuration: ChatConfig): Promise<boolean> {
    const count = Array.from((configuration.custom_instructions ?? "").trim()).length;
    if (configuration.style === "custom" && (count < 1 || count > 5000)) return false;
    const response = await this.fetcher(`/api/notebooks/${this.options.notebookId}/chat/configuration`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(configuration) });
    if (!response.ok) return false;
    this.configuration = configuration;
    return true;
  }
}


export async function copyResponse(content: string, citations: CitationBadge[], includeCitationBadges: boolean, clipboard: Pick<Clipboard, "writeText">): Promise<void> {
  await clipboard.writeText(includeCitationBadges ? content : stripCitationBadges(content, citations));
}

export function renderResponseActions(container: HTMLElement, input: {
  notebookId: string; messageId: string; content: string; citations: CitationBadge[]; fetcher?: typeof fetch; clipboard?: Pick<Clipboard, "writeText">;
}): void {
  const fetcher = input.fetcher ?? fetch;
  container.innerHTML = `<div class="chat-response-actions"><button type="button" data-action="copy-citations">Copy with citations</button><button type="button" data-action="copy-plain">Copy answer</button><button type="button" data-action="feedback-up">Helpful</button><button type="button" data-action="feedback-down">Not helpful</button><button type="button" data-action="save-note">Save to notes</button><span role="status" aria-live="polite"></span></div>`;
  const status = container.querySelector<HTMLElement>("[role=status]");
  const clipboard = input.clipboard ?? navigator.clipboard;
  for (const button of Array.from(container.querySelectorAll<HTMLButtonElement>("button"))) {
    button.addEventListener("click", async () => {
      const action = button.dataset.action;
      try {
        if (action === "copy-citations" || action === "copy-plain") {
          await copyResponse(input.content, input.citations, action === "copy-citations", clipboard);
          if (status) status.textContent = "Copied";
        } else if (action === "feedback-up" || action === "feedback-down") {
          const positive = action === "feedback-up";
          const category = positive ? undefined : window.prompt("What went wrong? (hallucination, wrong_citation, incomplete, other)");
          if (!positive && !category) return;
          const response = await fetcher(`/api/notebooks/${input.notebookId}/chat/messages/${input.messageId}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: positive ? "up" : "down", ...(category ? { category } : {}) }) });
          if (response.ok) { button.setAttribute("aria-pressed", "true"); if (status) status.textContent = "Feedback saved"; }
        } else if (action === "save-note") {
          button.disabled = true;
          const response = await fetcher(`/api/notebooks/${input.notebookId}/chat/messages/${input.messageId}/note`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notebook_id: input.notebookId, message_id: input.messageId }) });
          if (!response.ok) throw new Error("Could not save note");
          const result = await response.json() as { note: { title: string } };
          if (status) status.textContent = `Saved: ${result.note.title}`;
        }
      } catch {
        if (status) status.textContent = "Action failed";
      } finally {
        if (action === "save-note") button.disabled = false;
      }
    });
  }
}
