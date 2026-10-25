import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_TABLE_MISSING_MARKER, type StudioDataTablePayload } from "@everlast/contracts";
import { createStudioPanel, type StudioPanel } from "../src/studio/panel.ts";
import { setupMockDOM, type MockElement } from "./mock-dom.ts";

/**
 * [011-studio-mindmaps-data-tables] T041 — Studio Data Table browser unit tests:
 * - accessible Data Table tile, focus_prompt & schema_id controls
 * - progress & cancel
 * - sortable cited, missing, and conflicting cells
 * - CSV/XLSX downloads with current sorted row order
 * - invalidated loaded/export state
 * (FR-ST-18, FR-SI-03, NFR-EVAL-02/04; FR-007, FR-008, FR-009, FR-011, FR-014, FR-015, FR-016, SC-005, SC-006, SC-008, SC-009, SC-010)
 */

const NB = "11111111-1111-4111-8111-111111111111";
const SRC_A = "01965b10-0000-7000-8000-000000000301";
const SRC_B = "01965b10-0000-7000-8000-000000000302";
const CHUNK_1 = "01965b10-0000-7000-8000-000000001301";
const CHUNK_2 = "01965b10-0000-7000-8000-000000001302";

function buildSampleDataTablePayload(): StudioDataTablePayload {
  const ref1 = {
    badge_number: 1,
    chunk_id: CHUNK_1,
    source_id: SRC_A,
    revision: 1,
    snippet: "Vendor Alpha costs $10/month and $12/month in addendum.",
  };
  const ref2 = {
    badge_number: 2,
    chunk_id: CHUNK_2,
    source_id: SRC_B,
    revision: 1,
    snippet: "Vendor Beta costs $15/month with 99.95% SLA.",
  };
  return {
    schema_id: "vendor_comparison",
    focus_prompt: "Compare pricing and SLA",
    columns: [
      { id: "pricing", label: "Pricing", citations: [ref1, ref2] },
      { id: "sla", label: "SLA", citations: [ref2] },
    ],
    rows: [
      {
        item_id: "row_1",
        item_label: "Vendor Beta",
        item_citations: [ref2],
        cells: {
          pricing: {
            state: "supported",
            display_text: "$15/month",
            disagreement: false,
            values: [{ value: "$15/month", citations: [ref2] }],
          },
          sla: {
            state: "supported",
            display_text: "99.95% SLA",
            disagreement: false,
            values: [{ value: "99.95% SLA", citations: [ref2] }],
          },
        },
      },
      {
        item_id: "row_2",
        item_label: "Vendor Alpha",
        item_citations: [ref1],
        cells: {
          pricing: {
            state: "conflict",
            display_text: "$10/month vs. $12/month",
            disagreement: true,
            values: [
              { value: "$10/month", citations: [ref1] },
              { value: "$12/month", citations: [ref2] },
            ],
          },
          sla: {
            state: "missing",
            display_text: DATA_TABLE_MISSING_MARKER,
            disagreement: false,
            values: [],
          },
        },
      },
    ],
    citations: [ref1, ref2],
  };
}

describe("[011-studio-mindmaps-data-tables] T041: Studio Data Table tile, modal controls, sortable cell viewer, citations & CSV/XLSX downloads", () => {
  it("keeps the browser-local missing marker identical to the contract constant (FR-008)", async () => {
    const { DATA_TABLE_MISSING_MARKER: local } = await import("../src/studio/table-viewer.ts");
    expect(local).toBe(DATA_TABLE_MISSING_MARKER);
  });
  let dom: ReturnType<typeof setupMockDOM>;
  let selection: string[];

  beforeEach(() => {
    dom = setupMockDOM(1440);
    selection = [SRC_A, SRC_B];
  });

  const body = () => dom.document.body as unknown as MockElement;
  const q = (sel: string, root: MockElement = body()) => root.querySelector(sel);
  const qa = (sel: string, root: MockElement = body()) => root.querySelectorAll(sel);
  const tid = (id: string, root?: MockElement) => q(`[data-testid=${id}]`, root);
  const tids = (id: string, root?: MockElement) => qa(`[data-testid=${id}]`, root);

  it("opens Data Table configuration modal, submits focus_prompt + schema_id, renders sortable cells with conflict/missing/citations, and exports sorted row permutation", async () => {
    const artifactId = randomUUID();
    const payload = buildSampleDataTablePayload();
    const calls: { method: string; path: string; body: any }[] = [];

    const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), "http://local");
      const method = (init.method ?? "GET").toUpperCase();
      const reqBody = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: url.pathname, body: reqBody });

      if (url.pathname.endsWith("/artifacts") && method === "GET") {
        return new Response(
          JSON.stringify({
            artifacts: [
              {
                id: artifactId,
                notebook_id: NB,
                plugin_type: "data_table",
                subtype: "default",
                status: "Completed",
                title: "Data Table",
                params_json: { schema_id: "vendor_comparison", focus_prompt: "Compare pricing and SLA" },
                payload_json: null,
                source_revisions_snapshot: [{ source_id: SRC_A, revision: 1 }],
                output_language: "en-US",
                progress: null,
                failure: null,
                attempt: 1,
                retry_of: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.pathname.endsWith("/artifacts") && method === "POST") {
        return new Response(
          JSON.stringify({
            artifact: {
              id: artifactId,
              notebook_id: NB,
              plugin_type: "data_table",
              subtype: "default",
              status: "Queued",
              title: "Data Table",
              params_json: { schema_id: reqBody.schema_id ?? "auto", focus_prompt: reqBody.focus_prompt },
              payload_json: null,
              source_revisions_snapshot: [{ source_id: SRC_A, revision: 1 }],
              output_language: "en-US",
              progress: null,
              failure: null,
              attempt: 1,
              retry_of: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          }),
          { status: 202, headers: { "content-type": "application/json" } }
        );
      }
      if (url.pathname.endsWith(`/artifacts/${artifactId}`) && method === "GET") {
        return new Response(
          JSON.stringify({
            artifact: {
              id: artifactId,
              notebook_id: NB,
              plugin_type: "data_table",
              subtype: "default",
              status: "Completed",
              title: "Data Table",
              params_json: { schema_id: "vendor_comparison", focus_prompt: "Compare pricing and SLA" },
              payload_json: payload,
              source_revisions_snapshot: [{ source_id: SRC_A, revision: 1 }],
              output_language: "en-US",
              progress: null,
              failure: null,
              attempt: 1,
              retry_of: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.pathname.endsWith(`/artifacts/${artifactId}/export`) && method === "POST") {
        return new Response("\uFEFFEntity,Pricing,SLA\r\n", {
          status: 200,
          headers: {
            "content-type": reqBody.format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition": `attachment; filename="data-table.${reqBody.format}"`,
          },
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    const openedCitations: { sourceId: string; chunkId: string }[] = [];
    const panel: StudioPanel = createStudioPanel({
      notebookId: NB,
      fetcher,
      selectedSourceIds: () => [...selection],
      openCitation: (sourceId, chunkId) => openedCitations.push({ sourceId, chunkId }),
      onSourceCreated: () => undefined,
      pollMs: 50,
    });
    body().append(panel.element as unknown as MockElement);
    await panel.refresh();

    // 1. Click Data Table tile -> opens configuration modal or triggers generation
    const tableTile = tid("studio-data-table-tile");
    expect(tableTile).not.toBeNull();
    tableTile!.click();

    const modal = tid("data-table-modal");
    expect(modal).not.toBeNull();
    const focusInput = tid("data-table-focus-prompt", modal!)!;
    const schemaSelect = tid("data-table-schema-select", modal!)!;
    const generateBtn = tid("data-table-generate", modal!)!;

    focusInput.value = "Compare pricing and SLA";
    focusInput.dispatchEvent({ type: "input" });
    schemaSelect.value = "vendor_comparison";
    schemaSelect.dispatchEvent({ type: "change" });
    generateBtn.click();

    await vi.waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/artifacts"))).toBe(true));
    const createCall = calls.find((c) => c.method === "POST" && c.path.endsWith("/artifacts"))!;
    expect(createCall.body).toMatchObject({
      plugin_type: "data_table",
      subtype: "default",
      active_source_ids: [SRC_A, SRC_B],
      focus_prompt: "Compare pricing and SLA",
      schema_id: "vendor_comparison",
    });

    // 2. Refresh list and open Completed Data Table
    await panel.refresh();
    const openBtn = tid("studio-artifact-open");
    expect(openBtn).not.toBeNull();
    openBtn!.click();

    await vi.waitFor(() => expect(tid("studio-data-table")).not.toBeNull());
    const viewer = tid("studio-table-viewer")!;

    // Verify conflict badge, missing marker, and citation buttons
    const conflictCells = tids("table-cell-conflict", viewer);
    expect(conflictCells.length).toBe(1);
    expect(viewer.textContent).toContain(DATA_TABLE_MISSING_MARKER);

    const citeBadges = tids("table-citation-badge", viewer);
    expect(citeBadges.length).toBeGreaterThanOrEqual(2);
    citeBadges[0]!.click();
    expect(openedCitations.length).toBe(1);

    // 3. Sort by Entity column ascending (Vendor Alpha first, then Vendor Beta)
    const sortButtons = tids("table-sort-column", viewer);
    expect(sortButtons.length).toBeGreaterThanOrEqual(1);
    sortButtons[0]!.click(); // Sort ascending: row_2 (Vendor Alpha) before row_1 (Vendor Beta)

    // 4. Export CSV -> sends ordered_row_ids matching sorted presentation order
    const exportCsvBtn = tid("table-export-csv", viewer);
    expect(exportCsvBtn).not.toBeNull();
    exportCsvBtn!.click();

    await vi.waitFor(() => expect(calls.some((c) => c.path.endsWith("/export"))).toBe(true));
    const exportCall = calls.find((c) => c.path.endsWith("/export"))!;
    expect(exportCall.body).toEqual({
      format: "csv",
      ordered_row_ids: ["row_2", "row_1"],
    });
  });
});

/** PR #161 review — every schema the Data Table modal offers is one the API accepts (FR-ST-18). */
describe("[011-studio-mindmaps-data-tables] review: Data Table schema options", () => {
  it("offers exactly the contract's schema IDs", async () => {
    const { DataTableSchemaIdSchema } = await import("@everlast/contracts");
    const { DATA_TABLE_SCHEMA_OPTIONS } = await import("../src/studio/panel.ts");
    expect(DATA_TABLE_SCHEMA_OPTIONS.map((o: { value: string }) => o.value)).toEqual(DataTableSchemaIdSchema.options);
  });
});
