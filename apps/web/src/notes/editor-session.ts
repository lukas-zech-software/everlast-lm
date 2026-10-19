import { NOTE_AUTOSAVE_DEBOUNCE_MS, type PatchNoteInput } from "@everlast/contracts";

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export interface NoteDraft {
  title?: string;
  content_md?: string;
}

/** Client-only recovery store (FR-NM-01); drafts never reach the service until a save succeeds. */
export interface DraftStore {
  save(noteId: string, draft: NoteDraft): void;
  load(noteId: string): NoteDraft | null;
  clear(noteId: string): void;
}

export interface NoteEditorApi {
  patchNote(noteId: string, patch: Pick<PatchNoteInput, "title" | "content_md" | "base_revision">): Promise<{ revision: number }>;
}

export interface NoteEditorSessionOptions {
  noteId: string;
  revision: number;
  api: NoteEditorApi;
  drafts: DraftStore;
  debounceMs?: number;
}

/** Auto-saving note editor session (FR-NM-01): 500 ms debounce, flush on close, recoverable draft. */
export class NoteEditorSession {
  status: SaveStatus = "idle";
  revision: number;
  private draft: NoteDraft = {};
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inflight: Promise<void> | undefined;

  constructor(private readonly opts: NoteEditorSessionOptions) {
    this.revision = opts.revision;
  }

  edit(change: NoteDraft): void {
    this.draft = { ...this.draft, ...change };
    this.opts.drafts.save(this.opts.noteId, this.draft);
    this.status = "pending";
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.opts.debounceMs ?? NOTE_AUTOSAVE_DEBOUNCE_MS);
  }

  recoverDraft(): boolean {
    const d = this.opts.drafts.load(this.opts.noteId);
    if (!d) return false;
    this.draft = { ...d };
    this.status = "pending";
    return true;
  }

  private async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.inflight) await this.inflight;
    if (Object.keys(this.draft).length === 0) return;
    const sending = this.draft;
    this.draft = {};
    this.status = "saving";
    this.inflight = (async () => {
      try {
        const r = await this.opts.api.patchNote(this.opts.noteId, { ...sending, base_revision: this.revision });
        this.revision = r.revision;
        if (Object.keys(this.draft).length === 0) {
          this.opts.drafts.clear(this.opts.noteId);
          this.status = "saved";
        } else {
          this.status = "pending";
        }
      } catch {
        this.draft = { ...sending, ...this.draft };
        this.opts.drafts.save(this.opts.noteId, this.draft);
        this.status = "error";
      }
    })();
    await this.inflight;
    this.inflight = undefined;
  }

  /** Flushes pending edits; ok is true only when nothing remains unsaved. */
  async close(): Promise<{ ok: boolean }> {
    await this.flush();
    return { ok: this.status !== "error" && Object.keys(this.draft).length === 0 };
  }
}
