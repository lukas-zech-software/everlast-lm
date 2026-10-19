import { ChatConfigurationSchema, type SavedResponseNote } from "@everlast/contracts";
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

  async loadConfiguration(): Promise<ChatConfig | null> {
    const response = await this.fetcher(`/api/notebooks/${this.options.notebookId}/chat/configuration`);
    if (!response.ok) return null;
    const parsed = ChatConfigurationSchema.safeParse(await response.json());
    if (!parsed.success) return null;
    this.configuration = {
      style: parsed.data.style,
      response_length: parsed.data.response_length,
      ...(parsed.data.custom_instructions !== undefined ? { custom_instructions: parsed.data.custom_instructions } : {}),
    };
    return this.getConfiguration();
  }

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
  notebookId: string; messageId: string; content: string; citations: CitationBadge[]; fetcher?: typeof fetch; clipboard?: Pick<Clipboard, "writeText">; onSavedNote?: (note: SavedResponseNote) => void;
}): void {
  const fetcher = input.fetcher ?? fetch;
  container.innerHTML = `<div class="chat-response-actions"><button type="button" data-action="copy-citations">Copy with citations</button><button type="button" data-action="copy-plain">Copy answer</button><button type="button" data-action="feedback-up" aria-pressed="false">Helpful</button><button type="button" data-action="feedback-down" aria-pressed="false">Not helpful</button><form data-action="feedback-form" hidden><label>Category <select name="category"><option value="hallucination">Hallucination / Untrue</option><option value="wrong_citation">Incorrect citation</option><option value="incomplete">Incomplete</option><option value="other">Other</option></select></label><label>Optional comment <textarea name="comment" maxlength="2000"></textarea></label><button type="submit">Submit feedback</button><button type="button" data-action="feedback-cancel">Cancel</button></form><button type="button" data-action="save-note">Save to notes</button><span role="status" aria-live="polite"></span></div>`;
  const status = container.querySelector<HTMLElement>("[role=status]");
  const feedbackForm = container.querySelector<HTMLFormElement>('[data-action="feedback-form"]');
  const categoryInput = feedbackForm?.querySelector("select") as HTMLSelectElement | null;
  const commentInput = feedbackForm?.querySelector("textarea") as HTMLTextAreaElement | null;
  const clipboard = input.clipboard ?? navigator.clipboard;
  const updateRating = (rating: "up" | "down") => {
    container.querySelector<HTMLButtonElement>('[data-action="feedback-up"]')?.setAttribute("aria-pressed", String(rating === "up"));
    container.querySelector<HTMLButtonElement>('[data-action="feedback-down"]')?.setAttribute("aria-pressed", String(rating === "down"));
  };
  const sendFeedback = async (rating: "up" | "down", category?: string, comment?: string) => {
    const normalizedComment = comment?.trim();
    const length = Array.from(normalizedComment ?? "").length;
    if (length > 1000) { if (status) status.textContent = "Comment must be 0–1,000 Unicode code points."; return; }
    const response = await fetcher(`/api/notebooks/${input.notebookId}/chat/messages/${input.messageId}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating, ...(category ? { category } : {}), ...(normalizedComment ? { comment: normalizedComment } : {}) }) });
    if (!response.ok) throw new Error("Could not save feedback");
    updateRating(rating);
    if (feedbackForm) feedbackForm.setAttribute("hidden", "");
    if (status) status.textContent = "Feedback saved";
  };
  feedbackForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendFeedback("down", categoryInput?.value, commentInput?.value).catch(() => { if (status) status.textContent = "Action failed"; });
  });
  container.querySelector('[data-action="feedback-cancel"]')?.addEventListener("click", () => feedbackForm?.setAttribute("hidden", ""));
  for (const button of Array.from(container.querySelectorAll<HTMLButtonElement>("button"))) {
    button.addEventListener("click", async () => {
      const action = button.dataset.action;
      try {
        if (action === "copy-citations" || action === "copy-plain") {
          await copyResponse(input.content, input.citations, action === "copy-citations", clipboard);
          if (status) status.textContent = "Copied";
        } else if (action === "feedback-up") {
          await sendFeedback("up");
        } else if (action === "feedback-down") {
          feedbackForm?.removeAttribute("hidden");
        } else if (action === "save-note") {
          button.disabled = true;
          const response = await fetcher(`/api/notebooks/${input.notebookId}/chat/messages/${input.messageId}/note`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notebook_id: input.notebookId, message_id: input.messageId }) });
          if (!response.ok) throw new Error("Could not save note");
          const result = await response.json() as { note: SavedResponseNote };
          input.onSavedNote?.(result.note);
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

export function renderSavedResponseNote(container: HTMLElement, note: SavedResponseNote, onCitation?: (citation: SavedResponseNote["citations_json"][number]) => void): void {
  const existing = container.querySelector<HTMLElement>(`[data-saved-note-id="${note.id}"]`);
  if (existing?.parentElement) existing.parentElement.removeChild(existing);
  const placeholder = container.querySelector(".studio-placeholder");
  if (placeholder?.parentElement) placeholder.parentElement.removeChild(placeholder);
  const article = document.createElement("article");
  article.className = "saved-response-note";
  article.setAttribute("data-saved-note-id", note.id);
  const heading = document.createElement("h3");
  heading.textContent = note.title;
  article.appendChild(heading);
  const content = document.createElement("div");
  content.className = "saved-response-note-content";
  content.textContent = note.content_md;
  article.appendChild(content);
  if (note.citations_json.length) {
    const citationList = document.createElement("ul");
    citationList.className = "saved-response-note-citations";
    for (const citation of note.citations_json) {
      const item = document.createElement("li");
      const link = document.createElement("button");
      link.type = "button";
      link.setAttribute("data-citation-chunk", citation.chunk_id);
      const location = "page_number" in citation.locator ? `page ${citation.locator.page_number}` : "start_ms" in citation.locator ? `time ${citation.locator.start_ms}–${citation.locator.end_ms} ms` : "text location";
      link.textContent = `[${citation.badge_number}] ${citation.source_title} · ${location}`;
      link.addEventListener("click", () => onCitation?.(citation));
      item.appendChild(link);
      citationList.appendChild(item);
    }
    article.appendChild(citationList);
  }
  container.appendChild(article);
}

export function formatChatConfigurationLabel(configuration: ChatConfig): string {
  const styles: Record<ChatConfig["style"], string> = { default: "Default", learning_guide: "Learning guide", analyst: "Analyst", custom: "Custom" };
  const lengths: Record<ChatConfig["response_length"], string> = { default: "Default", longer: "Longer", shorter: "Shorter" };
  return `Style: ${styles[configuration.style]} · Length: ${lengths[configuration.response_length]}`;
}

export function renderNotebookOverview(container: HTMLElement, input: { notebookTitle: string; sourceCount: number; overview: string; starterPrompts: string[]; onPrompt: (prompt: string) => void }): void {
  container.innerHTML = "";
  const heading = document.createElement("h3");
  heading.textContent = `📓 ${input.notebookTitle} · ${input.sourceCount} ${input.sourceCount === 1 ? "source" : "sources"}`;
  container.appendChild(heading);
  const summary = document.createElement("p");
  summary.textContent = input.overview;
  container.appendChild(summary);
  for (const prompt of input.starterPrompts) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = prompt;
    button.addEventListener("click", () => input.onPrompt(prompt));
    container.appendChild(button);
  }
}
