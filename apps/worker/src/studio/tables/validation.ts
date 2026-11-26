import {
  DATA_TABLE_MAX_COLUMNS,
  DATA_TABLE_MAX_ROWS,
  DATA_TABLE_MIN_COLUMNS,
  DATA_TABLE_MIN_ROWS,
  StudioDataTablePayloadSchema,
  type DataTableCell,
  type DataTableCellValue,
  type DataTableColumn,
  type DataTableRow,
  type SourceRevisionPair,
  type StudioDataTablePayload,
  type StudioEvidenceRef,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";

type CitationVerifier = (cite: StudioEvidenceRef, context: string) => string | null;

function validateDimensions(table: StudioDataTablePayload): string | null {
  if (
    table.columns.length < DATA_TABLE_MIN_COLUMNS ||
    table.columns.length > DATA_TABLE_MAX_COLUMNS
  ) {
    return `Data table column count (${table.columns.length}) must be between ${DATA_TABLE_MIN_COLUMNS} and ${DATA_TABLE_MAX_COLUMNS}`;
  }
  if (table.rows.length < DATA_TABLE_MIN_ROWS || table.rows.length > DATA_TABLE_MAX_ROWS) {
    return `Data table row count (${table.rows.length}) must be between ${DATA_TABLE_MIN_ROWS} and ${DATA_TABLE_MAX_ROWS}`;
  }
  return null;
}

function createCitationVerifier(
  chunks: readonly UnifiedDocumentChunk[],
  snapshot: readonly SourceRevisionPair[],
): CitationVerifier {
  const revisions = new Map(snapshot.map((p) => [p.source_id, p.revision]));
  const chunkById = new Map(chunks.map((c) => [c.chunk_id, c]));

  return (cite, context) => {
    const chunk = chunkById.get(cite.chunk_id);
    if (!chunk) {
      return `${context}: citation ${cite.badge_number} (${cite.chunk_id}) does not resolve to a scoped chunk`;
    }
    const expectedRevision = revisions.get(cite.source_id);
    if (
      expectedRevision !== cite.revision ||
      chunk.source_id !== cite.source_id ||
      chunk.revision !== cite.revision
    ) {
      return `${context}: citation ${cite.badge_number} does not match the captured source revision snapshot`;
    }
    if (!chunk.text.includes(cite.snippet)) {
      return `${context}: citation ${cite.badge_number} snippet is not present in the cited chunk`;
    }
    return null;
  };
}

function verifyCitations(
  citations: readonly StudioEvidenceRef[],
  context: string,
  verifyCitation: CitationVerifier,
): string | null {
  for (const cite of citations) {
    const err = verifyCitation(cite, context);
    if (err) return err;
  }
  return null;
}

function validateConflictValues(
  values: readonly DataTableCellValue[],
  cellContext: string,
  verifyCitation: CitationVerifier,
): string | null {
  for (const alt of values) {
    if (alt.citations.length === 0) {
      return `${cellContext} conflicting value "${alt.value}" has no citation`;
    }
    const err = verifyCitations(
      alt.citations,
      `${cellContext} value "${alt.value}"`,
      verifyCitation,
    );
    if (err) return err;
  }
  return null;
}

function validateCell(
  cell: DataTableCell,
  cellContext: string,
  verifyCitation: CitationVerifier,
): string | null {
  switch (cell.state) {
    case "missing": {
      // The payload schema already pins the marker text, empty values and `disagreement: false`.
      return null;
    }
    case "supported": {
      for (const value of cell.values) {
        const err = verifyCitations(value.citations, cellContext, verifyCitation);
        if (err) return err;
      }
      return null;
    }
    case "conflict": {
      return validateConflictValues(cell.values, cellContext, verifyCitation);
    }
  }
}

function validateColumns(
  columns: readonly DataTableColumn[],
  verifyCitation: CitationVerifier,
): string | null {
  for (const col of columns) {
    if (col.citations.length === 0) {
      return `Column ${col.id} is missing header citations`;
    }
    const err = verifyCitations(col.citations, `Column ${col.id}`, verifyCitation);
    if (err) return err;
  }
  return null;
}

function validateRow(
  row: DataTableRow,
  columns: readonly DataTableColumn[],
  verifyCitation: CitationVerifier,
): string | null {
  if (row.item_citations.length === 0) {
    return `Row ${row.item_id} is missing item citations`;
  }
  const citationError = verifyCitations(row.item_citations, `Row ${row.item_id}`, verifyCitation);
  if (citationError) return citationError;

  for (const col of columns) {
    const cell = row.cells[col.id];
    if (!cell) {
      return `Row ${row.item_id} is missing cell for column ${col.id}`;
    }
    const err = validateCell(cell, `Row ${row.item_id} column ${col.id}`, verifyCitation);
    if (err) return err;
  }
  return null;
}

/**
 * [011-studio-mindmaps-data-tables] T011, T042 — Data table citation, conflict, missing-marker,
 * and dimension validator (FR-ST-18, FR-GC-02, C-03; FR-007, FR-008, FR-011, FR-013, FR-015, FR-016,
 * SC-006, SC-008, SC-009, SC-010).
 */
export function validateDataTablePayload(
  payload: unknown,
  chunks: readonly UnifiedDocumentChunk[],
  snapshot: readonly SourceRevisionPair[],
): string | null {
  const parsed = StudioDataTablePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => i.message).join("; ");
  }
  const table: StudioDataTablePayload = parsed.data;

  const dimensionError = validateDimensions(table);
  if (dimensionError) return dimensionError;

  const verifyCitation = createCitationVerifier(chunks, snapshot);
  const tableCitationError = verifyCitations(table.citations, "Table citations", verifyCitation);
  if (tableCitationError) return tableCitationError;

  const columnError = validateColumns(table.columns, verifyCitation);
  if (columnError) return columnError;

  for (const row of table.rows) {
    const err = validateRow(row, table.columns, verifyCitation);
    if (err) return err;
  }
  return null;
}
