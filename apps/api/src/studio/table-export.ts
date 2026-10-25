import ExcelJS from "exceljs";
import {
  DATA_TABLE_MISSING_MARKER,
  DataTableExportRequestSchema,
  StudioParamsError,
  validateOrderedRowIds,
  type DataTableCell,
  type DataTableRow,
  type StudioDataTablePayload,
  type StudioEvidenceRef,
} from "@everlast/contracts";

/**
 * [011-studio-mindmaps-data-tables] T044 — Deterministic safe CSV & OOXML `.xlsx` serializer
 * (FR-ST-18, NFR-SEC-02; FR-008, FR-009, FR-016, SC-005, SC-006, SC-010).
 *
 * Security & Grounding Invariants:
 * - Never executes formulas or mutates stored payload data.
 * - Prefixes any cell value, column header, or row item label whose raw or whitespace/control-trimmed
 *   form begins with `=`, `+`, `-`, or `@` with a single leading apostrophe (`'`).
 * - Emits UTF-8 BOM (`\uFEFF`) + RFC 4180 CRLF (`\r\n`) CSV with equal field count across all records.
 * - Emits OOXML `.xlsx` via ExcelJS with explicit string cells (zero formula cells, zero macros, zero external links).
 * - Preserves full canonical values, conflicting alternatives, missing markers (`N/A (Not in sources)`), and citation references.
 */

const FORMULA_DANGER_REGEX = /^[\s\u0000-\u001f]*[=+\-@]/;

/**
 * Export-only formula-injection neutralization:
 * If a string (or its leading-whitespace/control-character-stripped form) starts with `=`, `+`, `-`, or `@`,
 * prefix with a single apostrophe `'` so spreadsheet applications treat it as literal text.
 */
export function sanitizeSpreadsheetText(raw: string): string {
  if (FORMULA_DANGER_REGEX.test(raw)) {
    return `'${raw}`;
  }
  return raw;
}

function formatCiteBadges(cites: readonly StudioEvidenceRef[]): string {
  if (cites.length === 0) return "";
  const nums = [...new Set(cites.map((c) => c.badge_number))].sort((a, b) => a - b);
  return nums.map((n) => `[${n}]`).join("");
}

function formatCellExportText(cell: DataTableCell): string {
  if (cell.state === "missing") {
    return DATA_TABLE_MISSING_MARKER;
  }
  if (cell.state === "supported") {
    const entry = cell.values[0];
    if (!entry) return sanitizeSpreadsheetText(cell.display_text);
    const safeVal = sanitizeSpreadsheetText(entry.value);
    const badges = formatCiteBadges(entry.citations);
    return badges ? `${safeVal} ${badges}` : safeVal;
  }
  // Conflict cell: preserve all conflicting values with their individual citation badges
  const parts = cell.values.map((v) => {
    const safeVal = sanitizeSpreadsheetText(v.value);
    const badges = formatCiteBadges(v.citations);
    return badges ? `${safeVal} ${badges}` : safeVal;
  });
  return sanitizeSpreadsheetText(`[Conflict] ${parts.join(" | ")}`);
}

function formatHeaderText(label: string, cites: readonly StudioEvidenceRef[]): string {
  const safeLabel = sanitizeSpreadsheetText(label);
  const badges = formatCiteBadges(cites);
  return badges ? `${safeLabel} ${badges}` : safeLabel;
}

function formatRowItemText(row: DataTableRow): string {
  const safeLabel = sanitizeSpreadsheetText(row.item_label);
  const badges = formatCiteBadges(row.item_citations);
  return badges ? `${safeLabel} ${badges}` : safeLabel;
}

function resolveOrderedRows(payload: StudioDataTablePayload, orderedRowIds?: readonly string[]): DataTableRow[] {
  if (!orderedRowIds) {
    return [...payload.rows];
  }
  const check = validateOrderedRowIds(payload.rows, orderedRowIds);
  if (!check.valid) {
    throw new StudioParamsError(check.error ?? "Invalid ordered_row_ids permutation.");
  }
  const byId = new Map(payload.rows.map((r) => [r.item_id, r]));
  return orderedRowIds.map((id) => byId.get(id)!);
}

function escapeCsvField(field: string): string {
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

function padRecord(fields: string[], totalColumns: number): string[] {
  const out = fields.slice(0, totalColumns);
  while (out.length < totalColumns) {
    out.push("");
  }
  return out;
}

/**
 * Builds the 2D string grid (header row + sorted item rows + citation reference rows)
 * where every row has the exact same column count (`1 + payload.columns.length` or `payload.columns.length` if `entity` is already column 0).
 */
export function buildDataTableExportGrid(
  payload: StudioDataTablePayload,
  orderedRowIds?: readonly string[]
): {
  headers: string[];
  dataRows: string[][];
  citationRows: string[][];
  allRecords: string[][];
} {
  const orderedRows = resolveOrderedRows(payload, orderedRowIds);
  const hasEntityCol = payload.columns[0]?.id === "entity";
  const headers: string[] = hasEntityCol
    ? payload.columns.map((c) => formatHeaderText(c.label, c.citations))
    : ["Entity", ...payload.columns.map((c) => formatHeaderText(c.label, c.citations))];

  const colCount = headers.length;

  const dataRows: string[][] = orderedRows.map((row) => {
    const cells = payload.columns.map((col) => {
      const cell = row.cells[col.id];
      return cell ? formatCellExportText(cell) : DATA_TABLE_MISSING_MARKER;
    });
    return hasEntityCol ? cells : [formatRowItemText(row), ...cells];
  });

  const sortedCitations = [...payload.citations].sort((a, b) => a.badge_number - b.badge_number);
  const citationRows: string[][] = sortedCitations.map((cite) =>
    padRecord(
      [
        sanitizeSpreadsheetText(`[${cite.badge_number}]`),
        sanitizeSpreadsheetText(`Source ${cite.source_id} (rev ${cite.revision}, chunk ${cite.chunk_id})`),
        sanitizeSpreadsheetText(cite.snippet),
      ],
      colCount
    )
  );

  const allRecords: string[][] = [headers, ...dataRows, ...citationRows];
  return { headers, dataRows, citationRows, allRecords };
}

export function serializeDataTableCsv(payload: StudioDataTablePayload, orderedRowIds?: readonly string[]): Uint8Array {
  const { allRecords } = buildDataTableExportGrid(payload, orderedRowIds);
  const csvBody = allRecords.map((rec) => rec.map(escapeCsvField).join(",")).join("\r\n") + "\r\n";
  const withBom = `\uFEFF${csvBody}`;
  return new TextEncoder().encode(withBom);
}

export async function serializeDataTableXlsx(
  payload: StudioDataTablePayload,
  orderedRowIds?: readonly string[]
): Promise<Uint8Array> {
  const { headers, dataRows } = buildDataTableExportGrid(payload, orderedRowIds);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Everlast Studio";
  workbook.created = new Date("2026-01-01T00:00:00.000Z");
  workbook.modified = new Date("2026-01-01T00:00:00.000Z");

  const dataSheet = workbook.addWorksheet("Data Table");
  const headerRow = dataSheet.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.value = String(cell.value ?? "");
    cell.numFmt = "@";
  });

  for (const rowValues of dataRows) {
    const r = dataSheet.addRow(rowValues);
    r.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const textVal = rowValues[colNumber - 1] ?? "";
      cell.value = String(textVal);
      cell.numFmt = "@";
    });
  }

  const citeSheet = workbook.addWorksheet("Citations");
  const citeHeader = citeSheet.addRow(["Badge", "Source ID", "Chunk ID", "Revision", "Snippet"]);
  citeHeader.eachCell((cell) => {
    cell.numFmt = "@";
  });

  const sortedCitations = [...payload.citations].sort((a, b) => a.badge_number - b.badge_number);
  for (const cite of sortedCitations) {
    const r = citeSheet.addRow([
      sanitizeSpreadsheetText(`[${cite.badge_number}]`),
      sanitizeSpreadsheetText(cite.source_id),
      sanitizeSpreadsheetText(cite.chunk_id),
      String(cite.revision),
      sanitizeSpreadsheetText(cite.snippet),
    ]);
    r.eachCell((cell) => {
      cell.value = String(cell.value ?? "");
      cell.numFmt = "@";
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

export async function exportDataTableArtifact(input: {
  artifactId: string;
  payload: StudioDataTablePayload;
  body: unknown;
}): Promise<{
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}> {
  const req = DataTableExportRequestSchema.parse(input.body);
  const shortId = input.artifactId.slice(0, 8);
  if (req.format === "csv") {
    const bytes = serializeDataTableCsv(input.payload, req.ordered_row_ids);
    return {
      bytes,
      contentType: "text/csv; charset=utf-8",
      filename: `data-table-${shortId}.csv`,
    };
  }
  const bytes = await serializeDataTableXlsx(input.payload, req.ordered_row_ids);
  return {
    bytes,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    filename: `data-table-${shortId}.xlsx`,
  };
}
