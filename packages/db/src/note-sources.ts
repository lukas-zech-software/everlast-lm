import type { Citation, NoteSourceOrigin } from "@everlast/contracts";
import type { Queryable } from "./transaction.ts";
import { requireOwnedNotebook } from "./notebooks.ts";

/**
 * Note-source provenance (FR-NM-03, FR-NM-04, SRS §5.6; owner decision 2026-10-20, D16 amendment).
 * A note-source is a normal v1 `sources` row (`media_type: note_markdown`); this table adds the origin notes with
 * the revisions that were converted, the reuse key and the citations copied from saved responses (provenance
 * only). Deleting the source deletes its provenance (FK cascade), so a deleted source is never reused.
 */

export interface NoteSourceProvenance {
  origin_notes: NoteSourceOrigin[];
  origin_citations: Citation[];
}

/** Reuse key: the sorted, de-duplicated `note_id:revision` set of the converted notes (order-independent). */
export function noteSourceOriginKey(origins: Pick<NoteSourceOrigin, "note_id" | "revision">[]): string {
  return [...new Set(origins.map((o) => `${o.note_id}:${o.revision}`))].sort().join(",");
}

export async function recordNoteSourceProvenance(
  db: Queryable,
  input: { notebook_id: string; source_id: string; origin_notes: NoteSourceOrigin[]; origin_citations: Citation[] }
): Promise<void> {
  await db.query(
    `INSERT INTO note_source_provenance (source_id, notebook_id, origin_key, origin_notes, origin_citations)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
    [input.source_id, input.notebook_id, noteSourceOriginKey(input.origin_notes), JSON.stringify(input.origin_notes), JSON.stringify(input.origin_citations)]
  );
}

/** The newest Ready note-source of this owner's notebook converted from exactly these notes at these revisions. */
export async function findReusableNoteSource(db: Queryable, ownerId: string, notebookId: string, originKey: string): Promise<string | null> {
  await requireOwnedNotebook(db, ownerId, notebookId);
  const result = await db.query<{ id: string }>(
    `SELECT s.id FROM note_source_provenance p
       JOIN sources s ON s.notebook_id = p.notebook_id AND s.id = p.source_id
      WHERE p.notebook_id = $1 AND p.origin_key = $2 AND s.status = 'Ready' AND s.media_type = 'note_markdown'
      ORDER BY p.created_at DESC
      LIMIT 1`,
    [notebookId, originKey]
  );
  return result.rows[0]?.id ?? null;
}

export async function getNoteSourceProvenance(db: Queryable, notebookId: string, sourceIds: string[]): Promise<Map<string, NoteSourceProvenance>> {
  if (sourceIds.length === 0) return new Map();
  const result = await db.query<{ source_id: string; origin_notes: NoteSourceOrigin[]; origin_citations: Citation[] }>(
    "SELECT source_id, origin_notes, origin_citations FROM note_source_provenance WHERE notebook_id = $1 AND source_id = ANY($2::uuid[])",
    [notebookId, sourceIds]
  );
  return new Map(result.rows.map((r) => [r.source_id, { origin_notes: r.origin_notes, origin_citations: r.origin_citations }]));
}
