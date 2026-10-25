import type { DataTableCell, DataTableRow, StudioDataTablePayload, StudioEvidenceRef } from "@everlast/contracts";
import { clear, h } from "../lib/dom.ts";

/**
 * Literal missing-cell marker (FR-008). Mirrors `DATA_TABLE_MISSING_MARKER` in @everlast/contracts; the browser
 * build has no bundler and cannot resolve runtime imports from workspace packages (type-only imports only).
 */
export const DATA_TABLE_MISSING_MARKER = "N/A (Not in sources)";

/**
 * [011-studio-mindmaps-data-tables] T046 — Safe sortable Data Table viewer, citation badges,
 * conflict/missing cell presentation, and CSV/XLSX download actions
 * (FR-ST-18, NFR-SEC-02, NFR-EVAL-02/04; FR-007, FR-008, FR-009, FR-011, FR-014, FR-015, FR-016, SC-005, SC-006, SC-008, SC-009, SC-010).
 */

export interface DataTableViewerOptions {
  artifactId: string;
  title: string;
  payload: StudioDataTablePayload;
  onCitationClick?(sourceId: string, chunkId: string): void;
  onExport?(format: "csv" | "xlsx", orderedRowIds: string[]): void;
  onClose?(): void;
  actions?: HTMLElement[];
}

export interface DataTableViewer {
  element: HTMLElement;
  getOrderedRowIds(): string[];
  destroy(): void;
}

export function createDataTableViewer(options: DataTableViewerOptions): DataTableViewer {
  const { payload } = options;
  let sortColumnId: string | null = null;
  let sortDirection: "asc" | "desc" = "asc";
  let orderedRows: DataTableRow[] = [...payload.rows];

  const closeBtn = options.onClose
    ? h("button", {
        class: "icon-btn",
        type: "button",
        "data-testid": "studio-viewer-close",
        "aria-label": "Close data table",
        text: "←",
      })
    : null;
  closeBtn?.addEventListener("click", () => options.onClose?.());

  const exportCsvBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "table-export-csv",
    text: "Export CSV",
  });
  exportCsvBtn.addEventListener("click", () => {
    options.onExport?.(
      "csv",
      orderedRows.map((r) => r.item_id)
    );
  });

  const exportXlsxBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "table-export-xlsx",
    text: "Export XLSX",
  });
  exportXlsxBtn.addEventListener("click", () => {
    options.onExport?.(
      "xlsx",
      orderedRows.map((r) => r.item_id)
    );
  });

  const aiLabel = h("span", {
    class: "studio-table-ai-badge muted",
    "data-testid": "studio-table-ai-label",
    text: "AI-generated from selected sources",
  });

  const headEl = h(
    "div",
    { class: "studio-viewer-head" },
    ...(closeBtn ? [closeBtn] : []),
    h("h3", { class: "studio-report-title", "data-testid": "studio-report-title", text: options.title }),
    aiLabel,
    h("div", { class: "studio-table-controls" }, exportCsvBtn, exportXlsxBtn, ...(options.actions ?? []))
  );

  const tableHost = h("div", { class: "studio-table-scroll" });
  const root = h(
    "article",
    {
      class: "studio-table-viewer",
      "data-testid": "studio-table-viewer",
      "data-artifact-id": options.artifactId,
      "aria-label": options.title,
    },
    headEl,
    tableHost
  );

  function renderCiteBadges(cites: readonly StudioEvidenceRef[]): HTMLElement[] {
    return cites.map((cite) => {
      const btn = h("button", {
        class: "citation-badge table-citation-badge",
        type: "button",
        "data-testid": "table-citation-badge",
        "data-badge": cite.badge_number,
        "data-chunk-id": cite.chunk_id,
        "aria-label": `Citation ${cite.badge_number}`,
        title: cite.snippet,
        text: `[${cite.badge_number}]`,
      });
      btn.addEventListener("click", () => options.onCitationClick?.(cite.source_id, cite.chunk_id));
      return btn;
    });
  }

  function renderCellContent(cell: DataTableCell): HTMLElement {
    if (cell.state === "missing") {
      return h("td", {
        class: "table-cell table-cell-missing muted",
        "data-testid": "table-cell-missing",
        text: DATA_TABLE_MISSING_MARKER,
      });
    }
    if (cell.state === "supported") {
      const entry = cell.values[0];
      return h(
        "td",
        { class: "table-cell table-cell-supported", "data-testid": "table-cell-supported" },
        h("span", { class: "table-cell-text", text: entry?.value ?? cell.display_text }),
        " ",
        ...(entry ? renderCiteBadges(entry.citations) : [])
      );
    }
    // Conflict cell: explicit disagreement badge + each alternative value with its own citation badge(s)
    const alternatives = cell.values.map((alt) =>
      h(
        "div",
        { class: "table-conflict-value", "data-testid": "table-conflict-value" },
        h("span", { class: "table-cell-text", text: alt.value }),
        " ",
        ...renderCiteBadges(alt.citations)
      )
    );
    return h(
      "td",
      { class: "table-cell table-cell-conflict", "data-testid": "table-cell-conflict" },
      h("span", { class: "badge badge-warning", "data-testid": "table-conflict-badge", text: "Conflict" }),
      ...alternatives
    );
  }

  function applySort(colId: string): void {
    if (sortColumnId === colId) {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
    } else {
      sortColumnId = colId;
      sortDirection = "asc";
    }
    const factor = sortDirection === "asc" ? 1 : -1;
    orderedRows = [...payload.rows].sort((a, b) => {
      const textA =
        colId === "__item__"
          ? a.item_label
          : (a.cells[colId]?.display_text ?? DATA_TABLE_MISSING_MARKER);
      const textB =
        colId === "__item__"
          ? b.item_label
          : (b.cells[colId]?.display_text ?? DATA_TABLE_MISSING_MARKER);
      return textA.localeCompare(textB, undefined, { numeric: true, sensitivity: "base" }) * factor;
    });
    renderTable();
  }

  function renderTable(): void {
    clear(tableHost);
    const hasEntityCol = payload.columns[0]?.id === "entity";

    const headerCells: HTMLElement[] = [];
    if (!hasEntityCol) {
      const sortBtn = h("button", {
        class: "table-sort-btn",
        type: "button",
        "data-testid": "table-sort-column",
        "data-column-id": "__item__",
        "aria-label": "Sort by Entity",
        text: `Entity ${sortColumnId === "__item__" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}`,
      });
      sortBtn.addEventListener("click", () => applySort("__item__"));
      headerCells.push(h("th", { scope: "col" }, sortBtn));
    }

    for (const col of payload.columns) {
      const sortBtn = h("button", {
        class: "table-sort-btn",
        type: "button",
        "data-testid": "table-sort-column",
        "data-column-id": col.id,
        "aria-label": `Sort by ${col.label}`,
        text: `${col.label} ${sortColumnId === col.id ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}`,
      });
      sortBtn.addEventListener("click", () => applySort(col.id));
      headerCells.push(h("th", { scope: "col" }, sortBtn, " ", ...renderCiteBadges(col.citations)));
    }

    const thead = h("thead", {}, h("tr", {}, ...headerCells));
    const bodyRows = orderedRows.map((row) => {
      const cells: HTMLElement[] = [];
      if (!hasEntityCol) {
        cells.push(
          h(
            "th",
            { scope: "row", class: "table-row-item", "data-testid": "table-row-item" },
            h("span", { text: row.item_label }),
            " ",
            ...renderCiteBadges(row.item_citations)
          )
        );
      }
      for (const col of payload.columns) {
        const cell = row.cells[col.id];
        cells.push(
          cell
            ? renderCellContent(cell)
            : h("td", { class: "table-cell table-cell-missing muted", text: DATA_TABLE_MISSING_MARKER })
        );
      }
      return h("tr", { "data-testid": "table-row", "data-row-id": row.item_id }, ...cells);
    });

    const tbody = h("tbody", {}, ...bodyRows);
    const tableEl = h("table", { class: "studio-data-table", "data-testid": "studio-data-table" }, thead, tbody);
    tableHost.append(tableEl);
  }

  renderTable();

  return {
    element: root,
    getOrderedRowIds: () => orderedRows.map((r) => r.item_id),
    destroy() {
      clear(root);
    },
  };
}
