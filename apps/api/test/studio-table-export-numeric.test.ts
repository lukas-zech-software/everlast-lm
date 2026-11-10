import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { StudioDataTablePayloadSchema, type StudioDataTablePayload } from "@everlast/contracts";
import { buildDataTableExportGrid, serializeDataTableCsv, serializeDataTableXlsx } from "../src/studio/table-export.ts";

/** [011-studio-mindmaps-data-tables] T062: FR-ST-18, C-03, NFR-SEC-02, SC-005/010. */
const cite = (n: number) => ({ badge_number: n, source_id: `01965b10-0000-7000-8000-${String(n).padStart(12, "0")}`, chunk_id: `01965b11-0000-7000-8000-${String(n).padStart(12, "0")}`, revision: 1, snippet: `Evidence ${n}, "quoted"\nnext line` });
function fixture(values = ["-12.5", "42"]): StudioDataTablePayload {
  return StudioDataTablePayloadSchema.parse({
    columns: [{ id: "entity", label: "=Identity", citations: [cite(1)] }, { id: "amount", label: "Amount", citations: [cite(2)] }],
    rows: values.map((value, i) => ({ item_id: `r${i}`, item_label: `+Item ${i}`, item_citations: [cite(3)], cells: {
      entity: { state: "supported", display_text: "00123", values: [{ value: "00123", citations: [cite(1)] }], disagreement: false },
      amount: { state: "supported", display_text: value, values: [{ value, citations: [cite(2)] }], disagreement: false },
    } })),
    citations: [cite(1), cite(2), cite(3)], insufficient_evidence_note: null,
  });
}
// Independent RFC4180 record reader: handles embedded newlines/quotes, never guesses types.
function parseCsv(bytes: Uint8Array): string[][] {
  const raw = new TextDecoder().decode(bytes); const records: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c === '"') { if (quoted && raw[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && c === ',') { row.push(field); field = ""; }
    else if (!quoted && c === '\r' && raw[i + 1] === '\n') { row.push(field); records.push(row); row = []; field = ""; i++; }
    else field += c;
  }
  expect(quoted).toBe(false); expect(row).toEqual([]); expect(field).toBe(""); return records;
}
async function workbook(payload: StudioDataTablePayload, order?: string[]) {
  const wb = new ExcelJS.Workbook(); const bytes = await serializeDataTableXlsx(payload, order);
  await wb.xlsx.load(bytes.buffer as ArrayBuffer); return wb;
}

describe("[011-studio-mindmaps-data-tables] T062 numeric downloads and independent citations", () => {
  it("round-trips supported decimals as real numeric XLSX cells and plain parseable CSV fields without mutating C-03", async () => {
    const p = fixture(); const original = structuredClone(p);
    const wb = await workbook(p, ["r1", "r0"]); const sheet = wb.getWorksheet("Data Table")!;
    expect(sheet.getCell("E2").type).toBe(ExcelJS.ValueType.Number); expect(sheet.getCell("E2").value).toBe(42);
    expect(sheet.getCell("E3").value).toBe(-12.5); expect(sheet.getCell("F3").value).toBe("[2]");
    expect(sheet.getCell("C2").value).toBe("00123"); expect(sheet.getCell("C2").type).toBe(ExcelJS.ValueType.String);
    const records = parseCsv(serializeDataTableCsv(p, ["r1", "r0"]));
    expect(records[1]!.slice(4)).toEqual(["42", "[2]"]); expect(records[2]![4]).toBe("-12.5");
    expect(Number(records[2]![4])).toBe(-12.5); expect(records[1]![2]).toBe("00123");
    expect(records.every(r => r.length === 6)).toBe(true); expect(p).toEqual(original);
    expect(wb.getWorksheet("Citations")!.getCell("E2").value).toBe(cite(1).snippet);
  });
  it("preserves numeric-looking text, identifiers, unsafe precision and non-finite values losslessly", async () => {
    const values = ["0012", "-0012", "+12", "1e3", "1.20", "-0", "NaN", "Infinity", "9007199254740993", "1234567890123456", "0.1234567890123456", "-9007199254740993"];
    const wb = await workbook(fixture(values)); const sheet = wb.getWorksheet("Data Table")!;
    values.forEach((raw, i) => {
      const expected = /^[+\-]/.test(raw) ? `'${raw}` : raw;
      expect(sheet.getCell(i + 2, 5).value).toBe(expected); expect(sheet.getCell(i + 2, 5).type).toBe(ExcelJS.ValueType.String);
    });
  });
  it("retains per-alternative conflict association, missing semantics, and header/row references separately", async () => {
    const p = fixture(); p.rows[0]!.cells.amount = { state: "conflict", display_text: "conflict", disagreement: true, values: [{ value: "-12.5", citations: [cite(1)] }, { value: "=2+2", citations: [cite(2)] }] };
    p.rows[1]!.cells.amount = { state: "missing", display_text: "N/A (Not in sources)", disagreement: false, values: [] };
    const grid = buildDataTableExportGrid(p);
    expect(grid.dataRows[0]![4]).toBe('[Conflict] ["-12.5","=2+2"]' ); expect(grid.dataRows[0]![5]).toBe("1: [1] | 2: [2]");
    expect(grid.dataRows[1]!.slice(4)).toEqual(["N/A (Not in sources)", ""]);
    expect(grid.dataRows[0]!.slice(0, 2)).toEqual(["'+Item 0", "[3]"]);
    expect(grid.allRecords).toContainEqual(["[Header citations]", "", "", "[1]", "", "[2]"]);
    const records = parseCsv(serializeDataTableCsv(p)); expect(records).toContainEqual(["[1]", cite(1).source_id, cite(1).chunk_id, "1", cite(1).snippet, ""]);
  });
  it("keeps all formula-risk strings and bypasses inert in data, headings and labels", async () => {
    const values = ["=1+1", "+SUM(A1)", "-1+2", "@SUM(A1)", "\t=1", "\u0000-1", "\u00a0+1", "\u007f=1", "\u0085@1"];
    const p = fixture(); p.rows = values.map((value, i) => ({ ...structuredClone(p.rows[0]!), item_id: `r${i}`, cells: { ...p.rows[0]!.cells, amount: { state: "supported", display_text: value, values: [{ value, citations: [cite(2)] }], disagreement: false } } }));
    const wb = await workbook(p); const sheet = wb.getWorksheet("Data Table")!;
    expect(sheet.getCell("C1").value).toBe("'=Identity");
    values.forEach((raw, i) => expect(sheet.getCell(i + 2, 5).value).toBe(`'${raw}`));
    wb.eachSheet(s => s.eachRow(r => r.eachCell(c => { expect(c.type).not.toBe(ExcelJS.ValueType.Formula); expect(c.formula).toBeUndefined(); })));
    const records = parseCsv(serializeDataTableCsv(p)); values.forEach((raw, i) => expect(records[i + 1]![4]).toBe(`'${raw}`));
  });
  it("preserves literal OOXML escapes and illegal XML controls instead of dropping canonical text", async () => {
    const p = fixture(["_x0000_", "\u0000=1"]);
    const wb = await workbook(p); const sheet = wb.getWorksheet("Data Table")!;
    expect(sheet.getCell("E2").value).toBe("_x0000_"); expect(sheet.getCell("E3").value).toBe("'\u0000=1");
  });
  it("keeps explicit identifier columns textual even when their values look numeric", async () => {
    const p = fixture(["12345"]); p.columns[1] = { ...p.columns[1]!, id: "account_id", label: "Account ID" };
    p.rows[0]!.cells.account_id = p.rows[0]!.cells.amount!; delete p.rows[0]!.cells.amount;
    const wb = await workbook(p); expect(wb.getWorksheet("Data Table")!.getCell("E2").type).toBe(ExcelJS.ValueType.String);
  });
  it("keeps conflict alternatives unambiguous when canonical text contains separators, quotes or newlines", () => {
    const p = fixture(); const alternatives = ['A | B', '"quoted"\nC'];
    p.rows[0]!.cells.amount = { state: "conflict", display_text: "Conflict", disagreement: true, values: alternatives.map((value, i) => ({ value, citations: [cite(i + 1)] })) };
    const records = parseCsv(serializeDataTableCsv(p));
    expect(JSON.parse(records[1]![4]!.slice("[Conflict] ".length))).toEqual(alternatives);
    expect(records[1]![5]).toBe("1: [1] | 2: [2]");
  });
  it("uses 52 physical columns at the valid 25 logical-column boundary and rejects partial row orders", () => {
    const p = fixture(); p.columns = Array.from({ length: 25 }, (_, i) => ({ id: `col_${i}`, label: `Column ${i}`, citations: [cite(1)] }));
    for (const row of p.rows) row.cells = Object.fromEntries(p.columns.map(c => [c.id, structuredClone(row.cells.amount!)]));
    const canonical = StudioDataTablePayloadSchema.parse(p); const grid = buildDataTableExportGrid(canonical);
    expect(grid.headers.length).toBe(52); expect(grid.allRecords.every(r => r.length === 52)).toBe(true);
    expect(() => buildDataTableExportGrid(canonical, ["r0"])).toThrow(); expect(() => buildDataTableExportGrid(canonical, ["r0", "r0"])).toThrow();
  });
});
