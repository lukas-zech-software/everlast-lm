/**
 * Active source selection S_aktiv (FR-SI-03). Session-local per notebook (sessionStorage), never a server
 * default. Only Ready sources can be selected; sources that become Ready during this session's import are
 * auto-selected; removed or non-Ready sources leave the set.
 */

export interface SelectableSource {
  id: string;
  status: "Uploading" | "Processing" | "Ready" | "Failed";
}

export type MasterState = "checked" | "indeterminate" | "unchecked";

interface Stored {
  selected: string[];
  known: string[];
  imported: string[];
}

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export class SelectionModel {
  private selected = new Set<string>();
  /** Ready sources this session has already decided on (so a later deselect is respected). */
  private known = new Set<string>();
  /** Sources uploaded from this session: they auto-select when they become Ready. */
  private imported = new Set<string>();
  private ready: string[] = [];
  private readonly key: string;

  constructor(notebookId: string) {
    this.key = `everlast.selection.${notebookId}`;
    try {
      const raw = storage()?.getItem(this.key);
      if (raw) {
        const data = JSON.parse(raw) as Stored;
        this.selected = new Set(data.selected);
        this.known = new Set(data.known);
        this.imported = new Set(data.imported);
      }
    } catch {
      /* corrupt or unavailable storage: start empty */
    }
  }

  private persist(): void {
    try {
      storage()?.setItem(
        this.key,
        JSON.stringify({ selected: [...this.selected], known: [...this.known], imported: [...this.imported] } satisfies Stored)
      );
    } catch {
      /* storage unavailable: selection still works for this page */
    }
  }

  markImported(sourceId: string): void {
    this.imported.add(sourceId);
    this.persist();
  }

  /** Reconciles with the server list. First load selects all Ready sources (initial UI choice only). */
  sync(sources: SelectableSource[], firstLoad = false): void {
    this.ready = sources.filter((s) => s.status === "Ready").map((s) => s.id);
    const readySet = new Set(this.ready);
    for (const id of [...this.selected]) if (!readySet.has(id)) this.selected.delete(id);
    for (const id of this.ready) {
      if (this.known.has(id)) continue;
      if (firstLoad || this.imported.has(id)) this.selected.add(id);
      this.known.add(id);
    }
    const present = new Set(sources.map((s) => s.id));
    for (const id of [...this.known]) if (!present.has(id)) this.known.delete(id);
    this.persist();
  }

  isSelected(id: string): boolean {
    return this.selected.has(id);
  }

  toggle(id: string): void {
    if (!this.ready.includes(id)) return;
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.persist();
  }

  setAll(selected: boolean): void {
    this.selected = new Set(selected ? this.ready : []);
    this.persist();
  }

  master(): MasterState {
    if (this.ready.length === 0 || this.selected.size === 0) return "unchecked";
    return this.selected.size === this.ready.length ? "checked" : "indeterminate";
  }

  ids(): string[] {
    return this.ready.filter((id) => this.selected.has(id));
  }

  count(): number {
    return this.ids().length;
  }
}

export function sourcesLabel(count: number): string {
  return `${count} ${count === 1 ? "source" : "sources"}`;
}
