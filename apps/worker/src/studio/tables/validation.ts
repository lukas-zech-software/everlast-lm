import {
  DATA_TABLE_MAX_COLUMNS,
  DATA_TABLE_MAX_ROWS,
  DATA_TABLE_MIN_COLUMNS,
  DATA_TABLE_MIN_ROWS,
  DATA_TABLE_MISSING_MARKER,
  StudioDataTablePayloadSchema,
  type SourceRevisionPair,
  type StudioDataTablePayload,
  type StudioEvidenceRef,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";

/**
 * [011-studio-mindmaps-data-tables] T011, T042 — Data table citation, conflict, missing-marker,
 * and dimension validator (FR-ST-18, FR-GC-02, C-03; FR-007, FR-008, FR-011, FR-013, FR-015, FR-016,
 * SC-006, SC-008, SC-009, SC-010).
 */
export function validateDataTablePayload(
  payload: unknown,
  chunks: readonly UnifiedDocumentChunk[],
  snapshot: readonly SourceRevisionPair[]
): string | null {
  const parsed = StudioDataTablePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => i.message).join("; ");
  }
  const table: StudioDataTablePayload = parsed.data;

  if (table.columns.length < DATA_TABLE_MIN_COLUMNS || table.columns.length > DATA_TABLE_MAX_COLUMNS) {
    return `Data table column count (${table.columns.length}) must be between ${DATA_TABLE_MIN_COLUMNS} and ${DATA_TABLE_MAX_COLUMNS}`;
  }
  if (table.rows.length < DATA_TABLE_MIN_ROWS || table.rows.length > DATA_TABLE_MAX_ROWS) {
    return `Data table row count (${table.rows.length}) must be between ${DATA_TABLE_MIN_ROWS} and ${DATA_TABLE_MAX_ROWS}`;
  }

  const revisions = new Map(snapshot.map((p) => [p.source_id, p.revision]));
  const chunkById = new Map(chunks.map((c) => [c.chunk_id, c]));

  const verifyCitation = (cite: StudioEvidenceRef, context: string): string | null => {
    const chunk = chunkById.get(cite.chunk_id);
    if (!chunk) {
      return `${context}: citation ${cite.badge_number} (${cite.chunk_id}) does not resolve to a scoped chunk`;
    }
    const expectedRevision = revisions.get(cite.source_id);
    if (expectedRevision !== cite.revision || chunk.source_id !== cite.source_id || chunk.revision !== cite.revision) {
      return `${context}: citation ${cite.badge_number} does not match the captured source revision snapshot`;
    }
    if (!chunk.text.includes(cite.snippet)) {
      return `${context}: citation ${cite.badge_number} snippet is not present in the cited chunk`;
    }
    return null;
  };

  for (const cite of table.citations) {
    const err = verifyCitation(cite, "Table citations");
    if (err) return err;
  }

  for (const col of table.columns) {
    if (col.citations.length === 0) {
      return `Column ${col.id} is missing header citations`;
    }
    for (const cite of col.citations) {
      const err = verifyCitation(cite, `Column ${col.id}`);
      if (err) return err;
    }
  }

  for (const row of table.rows) {
    if (row.item_citations.length === 0) {
      return `Row ${row.item_id} is missing item citations`;
    }
    for (const cite of row.item_citations) {
      const err = verifyCitation(cite, `Row ${row.item_id}`);
      if (err) return err;
    }
    for (const col of table.columns) {
      const cell = row.cells[col.id];
      if (!cell) {
        return `Row ${row.item_id} is missing cell for column ${col.id}`;
      }
      if (cell.state === "missing") {
        if (cell.display_text !== DATA_TABLE_MISSING_MARKER || cell.values.length > 0 || cell.disagreement) {
          return `Row ${row.item_id} column ${col.id} invalid missing cell representation`;
        }
      } else if (cell.state === "supported") {
        if (cell.values.length !== 1 || cell.disagreement) {
          return `Row ${row.item_id} column ${col.id} invalid supported cell representation`;
        }
        for (const cite of cell.values[0]!.citations) {
          const err = verifyCitation(cite, `Row ${row.item_id} column ${col.id}`);
          if (err) return err;
        }
      } else if (cell.state === "conflict") {
        if (cell.values.length < 2 || !cell.disagreement) {
          return `Row ${row.item_id} column ${col.id} invalid conflict cell representation`;
        }
        for (const alt of cell.values) {
          if (alt.citations.length === 0) {
            return `Row ${row.item_id} column ${col.id} conflicting value "${alt.value}" has no citation`;
          }
          for (const cite of alt.citations) {
            const err = verifyCitation(cite, `Row ${row.item_id} column ${col.id} value "${alt.value}"`);
            if (err) return err;
          }
        }
      }
    }
  }

  return null;
}
