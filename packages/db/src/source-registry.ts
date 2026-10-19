import { InvalidScopeError, type NoteSource, type UnifiedDocumentChunk } from "@everlast/contracts";

// In-memory registry of note-derived sources and their C-01 chunks; serves C-02 reads (current revision only).

interface Entry {
  source: NoteSource;
  chunks: UnifiedDocumentChunk[];
}

const registry = new Map<string, Entry>();

export function resetSourceRegistry(): void {
  registry.clear();
}

export function deleteSourcesForNotebook(notebookId: string): void {
  for (const [id, e] of registry) {
    if (e.source.notebook_id === notebookId) registry.delete(id);
  }
}

export async function registerSource(source: NoteSource, chunks: UnifiedDocumentChunk[]): Promise<void> {
  registry.set(source.id, { source: structuredClone(source), chunks: structuredClone(chunks) });
}

export async function getSource(notebookId: string, sourceId: string): Promise<NoteSource | null> {
  const e = registry.get(sourceId);
  return e && e.source.notebook_id === notebookId ? structuredClone(e.source) : null;
}

export async function replaceSource(
  notebookId: string,
  sourceId: string,
  chunks: UnifiedDocumentChunk[]
): Promise<NoteSource> {
  const e = registry.get(sourceId);
  if (!e || e.source.notebook_id !== notebookId) throw new InvalidScopeError(`Source ${sourceId} not found`);
  e.source.revision_id += 1;
  e.chunks = structuredClone(chunks);
  return structuredClone(e.source);
}

export async function deleteSource(notebookId: string, sourceId: string): Promise<boolean> {
  const e = registry.get(sourceId);
  return e && e.source.notebook_id === notebookId ? registry.delete(sourceId) : false;
}

/** C-02 provider: Ready sources of this notebook only; chunks of the current revision only. */
export async function getScopedContext(
  notebookId: string,
  activeSourceIds: string[]
): Promise<UnifiedDocumentChunk[]> {
  const out: UnifiedDocumentChunk[] = [];
  for (const id of activeSourceIds) {
    const e = registry.get(id);
    if (!e || e.source.notebook_id !== notebookId || e.source.status !== "Ready") {
      throw new InvalidScopeError(`Source ${id} is not available in notebook ${notebookId}`);
    }
    out.push(...structuredClone(e.chunks.filter((c) => c.revision === e.source.revision_id)));
  }
  return out;
}
