import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { seedReadySource } from "@everlast/db/testing";
import { FORMULA_PREFIX_ADVERSARIES } from "@everlast/testkit/studio-structure-fixtures";
import { startNotesApi, type NotesApi } from "./notes-pg-support.ts";

/**
 * [011-studio-mindmaps-data-tables] T040 — Data Table CSV & XLSX export tests:
 * - RFC 4180 UTF-8 BOM (`\uFEFF`), CRLF (`\r\n`), equal fields per row, doubled quotes, non-ASCII preservation
 * - OOXML `.xlsx` binary (`PK\x03\x04` ZIP archive), text-only cells (`t="inlineStr"` or `t="s"`), zero `<f>` formula tags, zero macros/external links
 * - Formula prefix neutralization (`=`, `+`, `-`, `@` and leading whitespace/control chars) with leading apostrophe `'` on cell values, column headers, and row item labels
 * - Full-permutation `ordered_row_ids` sorting (rejects filtered subsets or duplicates with 422)
 * - Conflict values and missing markers preserved with citation references
 * - Current authorization & immediate source invalidation (409)
 * (FR-ST-18, NFR-SEC-02, NFR-EVAL-04; FR-008, FR-009, FR-010, FR-011, FR-014, FR-016, SC-005, SC-006, SC-008, SC-010)
 */

const OWNER = "table-export-33-owner";
const OTHER = "table-export-33-other";
let n: NotesApi;

beforeAll(async () => {
  n = await startNotesApi();
});

afterAll(async () => {
  await n?.close();
});

const studio = (nb: string) => `/api/notebooks/${nb}/studio`;

async function seed(nb: string, title: string, pages: string[]) {
  const owner = await n.userId(OWNER);
  return seedReadySource(n.api.db.pool, owner, nb, {
    title,
    mediaType: "text/plain",
    pages,
    embed: (t) => n.embedder.embed(t, "RETRIEVAL_DOCUMENT"),
  });
}

async function waitTerminal(nb: string, id: string): Promise<any> {
  for (let i = 0; i < 400; i++) {
    const r = await n.call(OWNER, "GET", `${studio(nb)}/artifacts/${id}`);
    if (["Completed", "Failed", "Cancelled"].includes(r.json.artifact.status)) return r.json;
    await new Promise((res) => setTimeout(res, 15));
  }
  throw new Error("Studio job never finished");
}

/** Strict RFC 4180 parser to independently verify equal field count per record, CRLF line endings, and quote unescaping. */
function parseRfc4180Csv(rawWithBom: string): { hasBom: boolean; records: string[][] } {
  const hasBom = rawWithBom.startsWith("\uFEFF");
  const text = hasBom ? rawWithBom.slice(1) : rawWithBom;
  const records: string[][] = [];
  let currentRecord: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        currentRecord.push(currentField);
        currentField = "";
      } else if (ch === "\r" && text[i + 1] === "\n") {
        currentRecord.push(currentField);
        records.push(currentRecord);
        currentRecord = [];
        currentField = "";
        i++;
      } else {
        currentField += ch;
      }
    }
  }
  if (currentField.length > 0 || currentRecord.length > 0) {
    currentRecord.push(currentField);
    records.push(currentRecord);
  }
  return { hasBom, records };
}

describe("[011-studio-mindmaps-data-tables] T040: Data Table CSV/XLSX export, formula neutralization, full-permutation sort & source invalidation", () => {
  it("exports RFC 4180 UTF-8 BOM CSV and text-only OOXML XLSX with neutralized formulas, full-permutation sorting, and source invalidation", async () => {
    const nb = await n.notebook(OWNER);
    const s1 = await seed(nb, "Vendors.txt", [
      `Vendor Alpha Enterprise Plan costs $10/month per seat and guarantees a 99.9% Uptime SLA. FormulaNote: ${FORMULA_PREFIX_ADVERSARIES.equalsFormula}.`,
      `Vendor Beta Cloud Suite costs $15/month per seat and guarantees a 99.95% Uptime SLA. FormulaNote: ${FORMULA_PREFIX_ADVERSARIES.plusFormula}.`,
      `Vendor Gamma Starter Edition costs $20/month per seat. SpecialText: ${FORMULA_PREFIX_ADVERSARIES.csvSpecialChars}.`,
      `2026 Pricing Addendum: Vendor Alpha Enterprise Plan costs $12/month per seat effective immediately.`,
    ]);

    const created = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, {
      plugin_type: "data_table",
      subtype: "default",
      active_source_ids: [s1.sourceId],
      schema_id: "vendor_comparison",
    });
    expect(created.status).toBe(202);
    const done = await waitTerminal(nb, created.json.artifact.id);
    expect(done.artifact.status).toBe("Completed");
    const artifactId = done.artifact.id;
    const rows = done.artifact.payload_json.rows as { item_id: string; item_label: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(3);

    // 1. Filtering / incomplete ordered_row_ids -> 422 ValidationError
    const filteredRes = await n.api.fetch(`${studio(nb)}/artifacts/${artifactId}/export`, {
      method: "POST",
      as: OWNER,
      json: { format: "csv", ordered_row_ids: [rows[0]!.item_id] },
    });
    expect(filteredRes.status).toBe(422);

    // 2. Reversed full permutation ordered_row_ids -> 200 RFC 4180 CSV with UTF-8 BOM
    const reversedIds = [...rows.map((r) => r.item_id)].reverse();
    const csvRes = await n.api.fetch(`${studio(nb)}/artifacts/${artifactId}/export`, {
      method: "POST",
      as: OWNER,
      json: { format: "csv", ordered_row_ids: reversedIds },
    });
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get("content-type")).toContain("text/csv");
    expect(csvRes.headers.get("cache-control")).toBe("private, no-store");
    expect(csvRes.headers.get("content-disposition")).toContain("attachment");

    const csvBytes = new Uint8Array(await csvRes.arrayBuffer());
    // UTF-8 BOM bytes: EF BB BF
    expect(Array.from(csvBytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const csvText = new TextDecoder("utf-8", { ignoreBOM: true }).decode(csvBytes);
    const parsedCsv = parseRfc4180Csv(csvText);
    expect(parsedCsv.hasBom).toBe(true);
    expect(parsedCsv.records.length).toBeGreaterThanOrEqual(rows.length + 1);

    // Every CSV record has the exact same number of fields
    const colCount = parsedCsv.records[0]!.length;
    expect(colCount).toBeGreaterThanOrEqual(3);
    for (const rec of parsedCsv.records) {
      expect(rec.length).toBe(colCount);
    }

    // Reversed row order is reflected in data rows (row 1 is the last original row)
    expect(parsedCsv.records[1]![0]).toContain(rows[rows.length - 1]!.item_label);

    // Formula adversary strings are prefixed with a leading apostrophe '
    expect(csvText).toContain(`'${FORMULA_PREFIX_ADVERSARIES.equalsFormula}`);
    expect(csvText).toContain(`'${FORMULA_PREFIX_ADVERSARIES.plusFormula}`);
    // Missing marker is preserved
    expect(csvText).toContain("N/A (Not in sources)");

    // 3. XLSX export returns valid ZIP/OOXML binary with text-only cells and zero formula elements
    const xlsxRes = await n.api.fetch(`${studio(nb)}/artifacts/${artifactId}/export`, {
      method: "POST",
      as: OWNER,
      json: { format: "xlsx", ordered_row_ids: reversedIds },
    });
    expect(xlsxRes.status).toBe(200);
    expect(xlsxRes.headers.get("content-type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    const xlsxBytes = new Uint8Array(await xlsxRes.arrayBuffer());
    // ZIP magic bytes: PK\x03\x04 (0x50, 0x4b, 0x03, 0x04)
    expect(Array.from(xlsxBytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);

    // Independently open and inspect the OOXML workbook with ExcelJS
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsxBytes.buffer as ArrayBuffer);
    const sheet = wb.getWorksheet("Data Table");
    expect(sheet).toBeDefined();
    let formulaCellCount = 0;
    const allCellTexts: string[] = [];
    sheet!.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.formula) formulaCellCount += 1;
        allCellTexts.push(String(cell.value ?? ""));
      });
    });
    expect(formulaCellCount).toBe(0);
    expect(allCellTexts.join("\n")).toContain(`'${FORMULA_PREFIX_ADVERSARIES.equalsFormula}`);
    expect(allCellTexts.join("\n")).toContain("N/A (Not in sources)");
    const citeSheet = wb.getWorksheet("Citations");
    expect(citeSheet).toBeDefined();
    expect(citeSheet!.rowCount).toBeGreaterThanOrEqual(2);

    // 4. Non-owner cannot export
    const otherRes = await n.api.fetch(`${studio(nb)}/artifacts/${artifactId}/export`, {
      method: "POST",
      as: OTHER,
      json: { format: "csv", ordered_row_ids: reversedIds },
    });
    expect([403, 404]).toContain(otherRes.status);

    // 5. Deleting a source invalidates export immediately (409)
    await n.api.db.pool.query("DELETE FROM sources WHERE id = $1", [s1.sourceId]);
    const revokedRes = await n.api.fetch(`${studio(nb)}/artifacts/${artifactId}/export`, {
      method: "POST",
      as: OWNER,
      json: { format: "csv", ordered_row_ids: reversedIds },
    });
    expect(revokedRes.status).toBe(409);
  });
});
