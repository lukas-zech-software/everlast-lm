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

/** [011-studio-mindmaps-data-tables] T063 — FR-ST-18, C-03, NFR-SEC-02.
 * Export-only numeric/string projection; canonical values and authorization are unchanged.
 * Logical columns each have separate citation fields. No formulas, macros or external links.
 */

const FORMULA_DANGER_REGEX = /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/;

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

interface DecimalExportValue {
  raw: string;
  value: number;
  scale: number;
}

type ExportValue = string | DecimalExportValue;

/** Conservative spreadsheet decimal projection: Excel retains at most 15 significant digits.
 * Identity columns bypass this classifier. Noncanonical/format-bearing values stay text.
 */
function numericValue(raw: string): DecimalExportValue | null {
  const match = /^-?(?:0|[1-9]\d*)(?:\.(\d+))?$/.exec(raw);
  if (!match) return null;
  const scale = match[1]?.length ?? 0;
  const digits = raw.replace(/^-/, "").replace(".", "").replace(/^0+/, "");
  if (digits.length > 15 || scale > 30) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value.toFixed(scale) !== raw) return null;
  return { raw, value, scale };
}

function formatCellExportValue(cell: DataTableCell, identity: boolean): ExportValue {
  if (cell.state === "missing") return DATA_TABLE_MISSING_MARKER;
  if (cell.state === "conflict") {
    // The literal prefix makes the whole cell inert, preserving alternatives byte-for-byte.
    return `[Conflict] ${JSON.stringify(cell.values.map(v => v.value))}`;
  }
  const raw = cell.values[0]?.value ?? cell.display_text;
  return (!identity ? numericValue(raw) : null) ?? sanitizeSpreadsheetText(raw);
}

function formatCellCitations(cell: DataTableCell): string {
  if (cell.state === "missing") return "";
  if (cell.state === "conflict") return cell.values.map((v, i) => `${i + 1}: ${formatCiteBadges(v.citations)}`).join(" | ");
  return formatCiteBadges(cell.values[0]?.citations ?? []);
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

function padRecord(fields: ExportValue[], totalColumns: number): ExportValue[] {
  if (fields.length > totalColumns) throw new Error("Citation record exceeds export width");
  return [...fields, ...Array<string>(totalColumns - fields.length).fill("")];
}

/** Row identity plus paired logical value/citation columns; metadata follows the data records.
 * Physical width 2+2N is independent of the canonical 25-column generation limit.
 */
export function buildDataTableExportGrid(
  payload: StudioDataTablePayload,
  orderedRowIds?: readonly string[]
): {
  headers: string[];
  dataRows: ExportValue[][];
  headerCitationRow: ExportValue[];
  citationRows: ExportValue[][];
  allRecords: ExportValue[][];
} {
  const orderedRows = resolveOrderedRows(payload, orderedRowIds);
  const headers = ["Row item", "Row item citations", ...payload.columns.flatMap(c => [
    sanitizeSpreadsheetText(c.label), sanitizeSpreadsheetText(`${c.label} citations`),
  ])];
  const colCount = headers.length;
  const dataRows = orderedRows.map(row => [
    sanitizeSpreadsheetText(row.item_label), formatCiteBadges(row.item_citations),
    ...payload.columns.flatMap(col => {
      const cell = row.cells[col.id];
      return cell ? [formatCellExportValue(cell, col.id === "entity" || /(?:^|_)(?:id|identifier|code|isbn|sku)(?:_|$)/i.test(col.id) || /\b(?:id|identifier|code|isbn|sku)\b/i.test(col.label)), formatCellCitations(cell)] : [DATA_TABLE_MISSING_MARKER, ""];
    }),
  ]);
  const headerCitationRow = ["[Header citations]", "", ...payload.columns.flatMap(c => ["", formatCiteBadges(c.citations)])];
  const citationRows = [...payload.citations].sort((a, b) => a.badge_number - b.badge_number).map(cite =>
    padRecord([
      `[${cite.badge_number}]`, sanitizeSpreadsheetText(cite.source_id), sanitizeSpreadsheetText(cite.chunk_id),
      String(cite.revision), sanitizeSpreadsheetText(cite.snippet),
    ], colCount)
  );
  const allRecords = [headers, ...dataRows, headerCitationRow,
    padRecord(["[Citation references]"], colCount),
    padRecord(["Badge", "Source ID", "Chunk ID", "Revision", "Snippet"], colCount), ...citationRows];
  return { headers, dataRows, headerCitationRow, citationRows, allRecords };
}

export function serializeDataTableCsv(payload: StudioDataTablePayload, orderedRowIds?: readonly string[]): Uint8Array {
  const { allRecords } = buildDataTableExportGrid(payload, orderedRowIds);
  const csvBody = allRecords.map((rec) => rec.map(value => escapeCsvField(typeof value === "string" ? value : value.raw)).join(",")).join("\r\n") + "\r\n";
  const withBom = `\uFEFF${csvBody}`;
  return new TextEncoder().encode(withBom);
}

export async function serializeDataTableXlsx(
  payload: StudioDataTablePayload,
  orderedRowIds?: readonly string[]
): Promise<Uint8Array> {
  const { headers, dataRows, headerCitationRow } = buildDataTableExportGrid(payload, orderedRowIds);
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
    const row = dataSheet.addRow([]);
    rowValues.forEach((value, index) => {
      const cell = row.getCell(index + 1);
      if (typeof value === "string") {
        cell.value = value;
        cell.numFmt = "@";
      } else {
        cell.value = value.value;
        cell.numFmt = value.scale === 0 ? "General" : `0.${"0".repeat(value.scale)}`;
      }
    });
  }

  const headerCites = dataSheet.addRow(headerCitationRow);
  headerCites.eachCell(cell => { cell.numFmt = "@"; });

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

  // OOXML ST_Xstring escaping: ExcelJS drops XML-illegal controls and decodes literal
  // _xNNNN_ sequences on read. Encode both once to retain the exact inert text.
  workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => {
    if (typeof cell.value === "string") {
      cell.value = cell.value.replace(/_x[0-9a-f]{4}_/gi, match => `_x005F_${match.slice(1)}`)
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffe\uffff]/g,
          char => `_x${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}_`);
    }
  })));

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
