import { describe, expect, it } from "vitest";
import {
  DATA_TABLE_MAX_COLUMNS,
  DATA_TABLE_MAX_ROWS,
  DATA_TABLE_MISSING_MARKER,
  StudioDataTablePayloadSchema,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";
import {
  buildFiftySourceFixture,
  buildThreeVendorTableFixture,
  makeStudioChunk,
  makeStudioSourceId,
} from "@everlast/testkit/studio-structure-fixtures";
import { DeterministicDataTableModel, type DataTableModelClient, type TableObservation } from "../src/studio/tables/model.ts";
import { generateDataTable } from "../src/studio/tables/pipeline.ts";
import { validateDataTablePayload } from "../src/studio/tables/validation.ts";

/**
 * [011-studio-mindmaps-data-tables] T038 — Data Table pipeline/model tests:
 * - all-original vendor merge / one item one row across 3 vendors + 1 pricing addendum
 * - each conflicting alternative individually cited + disagreement: true
 * - literal missing marker ("N/A (Not in sources)") only for absent evidence with zero citations
 * - factual item/header evidence
 * - whole-result 500/501 row & 25/26 column overflow before publication
 * (FR-ST-18, C-02/C-03, NFR-EVAL-02/04; FR-007, FR-008, FR-010, FR-011, FR-013, FR-015, FR-016, SC-006, SC-008, SC-009, SC-010)
 */
describe("[011-studio-mindmaps-data-tables] T038: Data Table extraction, vendor merge, conflict preservation, missing marker & 500×25 bounds", () => {
  it("merges equivalent items across 4 sources into 3 vendor rows, preserves conflicting Alpha pricing with per-value citations, and marks Gamma SLA as missing", async () => {
    const fixture = buildThreeVendorTableFixture();
    const model = new DeterministicDataTableModel();

    const outcome = await generateDataTable({
      chunks: fixture.chunks,
      snapshot: fixture.snapshot,
      model,
      schema_id: "vendor_comparison",
      focus_prompt: "Compare pricing and SLA across vendors",
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed" || !("rows" in outcome.payload)) {
      throw new Error("Expected completed data table payload");
    }

    const parsed = StudioDataTablePayloadSchema.parse(outcome.payload);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.schema_id).toBe("vendor_comparison");
    expect(parsed.focus_prompt).toBe("Compare pricing and SLA across vendors");

    // Verify one item per row: Vendor Alpha, Vendor Beta, Vendor Gamma
    const alphaRow = parsed.rows.find((r) => r.item_label.includes("Vendor Alpha"));
    const betaRow = parsed.rows.find((r) => r.item_label.includes("Vendor Beta"));
    const gammaRow = parsed.rows.find((r) => r.item_label.includes("Vendor Gamma"));
    expect(alphaRow).toBeDefined();
    expect(betaRow).toBeDefined();
    expect(gammaRow).toBeDefined();

    // Every column header and row item has valid citations
    for (const col of parsed.columns) {
      expect(col.citations.length).toBeGreaterThanOrEqual(1);
    }
    for (const row of parsed.rows) {
      expect(row.item_citations.length).toBeGreaterThanOrEqual(1);
    }

    // Vendor Alpha pricing cell has state: "conflict", disagreement: true, and two individually cited values ($10/month and $12/month)
    const alphaPricing = alphaRow!.cells["pricing"];
    expect(alphaPricing).toBeDefined();
    expect(alphaPricing!.state).toBe("conflict");
    expect(alphaPricing!.disagreement).toBe(true);
    expect(alphaPricing!.values).toHaveLength(2);
    expect(alphaPricing!.values.map((v) => v.value)).toEqual(
      expect.arrayContaining([expect.stringMatching(/\$10\/month/), expect.stringMatching(/\$12\/month/)])
    );
    for (const val of alphaPricing!.values) {
      expect(val.citations.length).toBeGreaterThanOrEqual(1);
    }

    // Vendor Beta SLA cell is supported with 1 value and disagreement: false
    const betaSla = betaRow!.cells["sla"];
    expect(betaSla).toBeDefined();
    expect(betaSla!.state).toBe("supported");
    expect(betaSla!.disagreement).toBe(false);
    expect(betaSla!.values).toHaveLength(1);
    expect(betaSla!.values[0]!.value).toContain("99.95%");

    // Vendor Gamma SLA cell is missing with literal "N/A (Not in sources)" and zero citations
    const gammaSla = gammaRow!.cells["sla"];
    expect(gammaSla).toBeDefined();
    expect(gammaSla!.state).toBe("missing");
    expect(gammaSla!.display_text).toBe(DATA_TABLE_MISSING_MARKER);
    expect(gammaSla!.disagreement).toBe(false);
    expect(gammaSla!.values).toHaveLength(0);

    // Validator accepts the payload
    expect(validateDataTablePayload(parsed, fixture.chunks, fixture.snapshot)).toBeNull();
  });

  it("processes all original chunks across 52 sources without Source Guide shortcutting and retains late-batch facts", async () => {
    const fifty = buildFiftySourceFixture(52);
    const model = new DeterministicDataTableModel();

    const outcome = await generateDataTable({
      chunks: fifty.chunks,
      snapshot: fifty.snapshot,
      model,
      limits: { maxChunksPerBatch: 25, maxTokensPerBatch: 5000 },
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed" || !("rows" in outcome.payload)) {
      throw new Error("Expected completed data table payload");
    }

    expect(outcome.payload.coverage?.batch_count).toBeGreaterThanOrEqual(4);
    expect(outcome.payload.coverage?.all_original_chunks_visited).toBe(true);
    expect(outcome.payload.coverage?.total_sources).toBe(52);
    const serialized = JSON.stringify(outcome.payload);
    expect(serialized).toContain(fifty.lateFactToken);
  });

  it("allows inclusive 500 rows × 25 columns and refuses 501 rows or 26 columns with TableBoundsExceeded and no partial payload", async () => {
    const sourceId = makeStudioSourceId(401);
    const chunk: UnifiedDocumentChunk = makeStudioChunk(
      4001,
      sourceId,
      "Synthetic bounds test chunk with verified evidence snippet."
    );
    const snapshot = [{ source_id: sourceId, revision: 1 }];

    const makeSizedModel = (rowsCount: number, colsCount: number): DataTableModelClient => ({
      async extract() {
        const obs: TableObservation[] = [];
        for (let r = 1; r <= rowsCount; r++) {
          for (let c = 1; c <= Math.min(colsCount, 2); c++) {
            obs.push({
              item_label: `Item ${r}`,
              attribute_id: `col_${c}`,
              attribute_label: `Column ${c}`,
              value_text: "Synthetic bounds test chunk",
              chunk_id: chunk.chunk_id,
              source_id: sourceId,
              revision: 1,
              snippet: "Synthetic bounds test chunk",
            });
          }
        }
        return obs;
      },
      async compose() {
        const ref = {
          badge_number: 1,
          chunk_id: chunk.chunk_id,
          source_id: sourceId,
          revision: 1,
          snippet: "Synthetic bounds test chunk",
        };
        const columns = Array.from({ length: Math.min(colsCount, DATA_TABLE_MAX_COLUMNS) }, (_, idx) => ({
          id: `col_${idx + 1}`,
          label: `Column ${idx + 1}`,
          citations: [ref],
        }));
        const rows = Array.from({ length: Math.min(rowsCount, DATA_TABLE_MAX_ROWS) }, (_, idx) => ({
          item_id: `row_${idx + 1}`,
          item_label: `Item ${idx + 1}`,
          item_citations: [ref],
          cells: Object.fromEntries(
            columns.map((c, cIdx) => [
              c.id,
              cIdx === 0
                ? {
                    state: "supported" as const,
                    display_text: "Synthetic bounds test chunk",
                    disagreement: false as const,
                    values: [{ value: "Synthetic bounds test chunk", citations: [ref] }],
                  }
                : {
                    state: "missing" as const,
                    display_text: DATA_TABLE_MISSING_MARKER,
                    disagreement: false as const,
                    values: [],
                  },
            ])
          ),
        }));
        return {
          payload: {
            columns,
            rows,
            citations: [ref],
          },
          rawRowCount: rowsCount,
          rawColumnCount: colsCount,
        };
      },
    });

    // 1. Inclusive maximum: 500 rows × 25 columns -> Completed
    const maxAllowed = await generateDataTable({
      chunks: [chunk],
      snapshot,
      model: makeSizedModel(DATA_TABLE_MAX_ROWS, DATA_TABLE_MAX_COLUMNS),
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });
    expect(maxAllowed.status).toBe("completed");

    // 2. 501 rows -> Refused with TableBoundsExceeded
    const rowOverflow = await generateDataTable({
      chunks: [chunk],
      snapshot,
      model: makeSizedModel(DATA_TABLE_MAX_ROWS + 1, 4),
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });
    expect(rowOverflow).toMatchObject({
      status: "refused",
      code: "TableBoundsExceeded",
    });

    // 3. 26 columns -> Refused with TableBoundsExceeded
    const colOverflow = await generateDataTable({
      chunks: [chunk],
      snapshot,
      model: makeSizedModel(10, DATA_TABLE_MAX_COLUMNS + 1),
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });
    expect(colOverflow).toMatchObject({
      status: "refused",
      code: "TableBoundsExceeded",
    });
  });
});
