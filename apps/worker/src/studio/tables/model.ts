import {
  DATA_TABLE_COLUMN_ID_PATTERN,
  DATA_TABLE_MAX_COLUMNS,
  DATA_TABLE_MAX_ROWS,
  DATA_TABLE_MIN_COLUMNS,
  DATA_TABLE_MIN_ROWS,
  DATA_TABLE_MISSING_MARKER,
  type DataTableCell,
  type DataTableColumn,
  type DataTableRow,
  type DataTableSchemaId,
  type StudioDataTablePayload,
  type StudioEvidenceRef,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";
import { splitSentences } from "../reports/sentences.ts";

/**
 * [011-studio-mindmaps-data-tables] T042 — Structured Data Table extraction, equivalent-item merge,
 * and model interface (FR-ST-18, C-02/C-03, FR-GC-02; FR-007, FR-008, FR-010, FR-011, FR-013, FR-015, FR-016, SC-006, SC-008, SC-009, SC-010).
 */

export interface TableObservation {
  item_label: string;
  attribute_id: string;
  attribute_label: string;
  value_text: string;
  chunk_id: string;
  source_id: string;
  revision: number;
  snippet: string;
}

export interface DataTableExtractRequest {
  chunks: UnifiedDocumentChunk[];
  focus_prompt?: string | undefined;
  schema_id?: DataTableSchemaId | undefined;
  output_language?: string | undefined;
  signal: AbortSignal;
}

export interface DataTableComposeRequest {
  observations: TableObservation[];
  chunks: readonly UnifiedDocumentChunk[];
  focus_prompt?: string | undefined;
  schema_id?: DataTableSchemaId | undefined;
  output_language?: string | undefined;
  signal: AbortSignal;
}

export interface DataTableModelClient {
  extract(request: DataTableExtractRequest): Promise<TableObservation[]>;
  compose(request: DataTableComposeRequest): Promise<{
    payload: StudioDataTablePayload;
    rawRowCount: number;
    rawColumnCount: number;
  }>;
}

export class DataTableGenerationError extends Error {
  constructor(message = "The data table model returned invalid output.") {
    super(message);
    this.name = "DataTableGenerationError";
  }
}

function normalizeColumnId(label: string, fallbackIndex: number): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const candidate = slug && /^[a-z]/.test(slug) ? slug.slice(0, 60) : `col_${slug || fallbackIndex}`.slice(0, 60);
  return DATA_TABLE_COLUMN_ID_PATTERN.test(candidate) ? candidate : `col_${fallbackIndex}`;
}

function canonicalItemKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Deterministic structured Data Table model:
 * - Extracts structured entity/vendor/item observations (`Vendor X`, `Item Y`, or general source rows)
 * - Merges observations referring to the same canonical item into a single row (`FR-008`, `SC-006`)
 * - Preserves conflicting values from different chunks in the same cell with `disagreement: true` and individual citations
 * - Marks absent cells with literal `"N/A (Not in sources)"` and empty citations (`FR-008`)
 */
/** Catch-all attribute for sentences that match no specific attribute. */
const SUMMARY_ATTRIBUTE_ID = "summary";

export class DeterministicDataTableModel implements DataTableModelClient {
  async extract(req: DataTableExtractRequest): Promise<TableObservation[]> {
    req.signal.throwIfAborted();
    const out: TableObservation[] = [];

    for (const chunk of req.chunks) {
      const sentences = splitSentences(chunk.text);
      const list = sentences.length > 0 ? sentences : [chunk.text.trim()].filter(Boolean);

      // Detect whether this chunk describes named vendors/entities (e.g. "Vendor Alpha", "Vendor Beta", "Vendor Gamma")
      let currentVendor: string | null = null;
      const vendorHeaderMatch = /\b(Vendor\s+[A-Z][A-Za-z0-9_-]*|Provider\s+[A-Z][A-Za-z0-9_-]*|Product\s+[A-Z][A-Za-z0-9_-]*)\b/.exec(chunk.text);
      if (vendorHeaderMatch) {
        currentVendor = vendorHeaderMatch[1]!.trim();
      }

      for (const sentence of list) {
        const inlineVendor = /\b(Vendor\s+[A-Z][A-Za-z0-9_-]*|Provider\s+[A-Z][A-Za-z0-9_-]*|Product\s+[A-Z][A-Za-z0-9_-]*)\b/.exec(sentence);
        const itemLabel = inlineVendor ? inlineVendor[1]!.trim() : currentVendor ?? `Source ${chunk.source_id.slice(-4)}`;

        let matchedSpecific = false;

        // Price / Cost pattern
        const priceMatch = /(\$\d[\d,.]*(?:\s*\/\s*[A-Za-z]+|\s+per\s+[A-Za-z]+)?|\d+\s*(?:EUR|USD)\b[^.;,]*)/i.exec(sentence);
        if (priceMatch && chunk.text.includes(priceMatch[1]!)) {
          matchedSpecific = true;
          out.push({
            item_label: itemLabel,
            attribute_id: "pricing",
            attribute_label: "Pricing",
            value_text: priceMatch[1]!.trim(),
            chunk_id: chunk.chunk_id,
            source_id: chunk.source_id,
            revision: chunk.revision,
            snippet: sentence.trim(),
          });
        }

        // SLA / Uptime pattern
        const slaMatch = /(\d{2,3}(?:\.\d+)?%\s*(?:uptime\s*)?SLA|\bSLA\s*(?:of\s*|is\s*)?\d{2,3}(?:\.\d+)?%)/i.exec(sentence);
        if (slaMatch && chunk.text.includes(slaMatch[1]!)) {
          matchedSpecific = true;
          out.push({
            item_label: itemLabel,
            attribute_id: "sla",
            attribute_label: "SLA",
            value_text: slaMatch[1]!.trim(),
            chunk_id: chunk.chunk_id,
            source_id: chunk.source_id,
            revision: chunk.revision,
            snippet: sentence.trim(),
          });
        }

        // Deployment region / Residency pattern
        const regionMatch = /\b(europe-west4|us-central1|EU-only|multi-region[A-Za-z0-9 -]*)/i.exec(sentence);
        if (regionMatch && chunk.text.includes(regionMatch[1]!)) {
          matchedSpecific = true;
          out.push({
            item_label: itemLabel,
            attribute_id: "region",
            attribute_label: "Region",
            value_text: regionMatch[1]!.trim(),
            chunk_id: chunk.chunk_id,
            source_id: chunk.source_id,
            revision: chunk.revision,
            snippet: sentence.trim(),
          });
        }

        // Certification / Security pattern
        const certMatch = /\b(ISO-27001|SOC2(?:\s+Type\s+II)?|HIPAA|FedRAMP|CMEK|VPC-SC)\b/i.exec(sentence);
        if (certMatch && chunk.text.includes(certMatch[1]!)) {
          matchedSpecific = true;
          out.push({
            item_label: itemLabel,
            attribute_id: "security",
            attribute_label: "Security & Compliance",
            value_text: certMatch[1]!.trim(),
            chunk_id: chunk.chunk_id,
            source_id: chunk.source_id,
            revision: chunk.revision,
            snippet: sentence.trim(),
          });
        }

        // Key: Value pattern (e.g., "Support: 24/7 enterprise", or "Source 1 overview: ..." normalized to "Source Overview")
        const kvMatch = /^([A-Z][A-Za-z0-9 /_-]{1,35}):\s+(.+)$/.exec(sentence.trim());
        if (kvMatch && chunk.text.includes(kvMatch[2]!.trim())) {
          matchedSpecific = true;
          const rawLabel = kvMatch[1]!.trim();
          const sourceSectionMatch = /^Source\s+\d+\s+([A-Za-z0-9 _-]+)$/i.exec(rawLabel);
          const attrLabel = sourceSectionMatch
            ? sourceSectionMatch[1]!
                .trim()
                .replace(/\b\w/g, (c) => c.toUpperCase())
            : rawLabel;
          out.push({
            item_label: itemLabel,
            attribute_id: normalizeColumnId(attrLabel, out.length + 1),
            attribute_label: attrLabel,
            value_text: kvMatch[2]!.trim(),
            chunk_id: chunk.chunk_id,
            source_id: chunk.source_id,
            revision: chunk.revision,
            snippet: sentence.trim(),
          });
        }

        if (!matchedSpecific) {
          out.push({
            item_label: itemLabel,
            attribute_id: SUMMARY_ATTRIBUTE_ID,
            attribute_label: "Key Finding",
            value_text: sentence.trim(),
            chunk_id: chunk.chunk_id,
            source_id: chunk.source_id,
            revision: chunk.revision,
            snippet: sentence.trim(),
          });
        }
      }
    }

    return out;
  }

  async compose(req: DataTableComposeRequest): Promise<{
    payload: StudioDataTablePayload;
    rawRowCount: number;
    rawColumnCount: number;
  }> {
    req.signal.throwIfAborted();
    if (req.observations.length === 0) {
      throw new DataTableGenerationError("No observations extracted for data table.");
    }

    const citations: StudioEvidenceRef[] = [];
    const badgeByKey = new Map<string, StudioEvidenceRef>();
    const issueCitation = (obs: TableObservation): StudioEvidenceRef => {
      const key = `${obs.chunk_id}|${obs.snippet}`;
      const existing = badgeByKey.get(key);
      if (existing) return existing;
      const ref: StudioEvidenceRef = {
        badge_number: citations.length + 1,
        source_id: obs.source_id,
        chunk_id: obs.chunk_id,
        revision: obs.revision,
        snippet: obs.snippet,
      };
      citations.push(ref);
      badgeByKey.set(key, ref);
      return ref;
    };

    // Collect distinct attributes (columns) and canonical items (rows)
    const attrMap = new Map<string, { id: string; label: string; citations: StudioEvidenceRef[] }>();
    const itemMap = new Map<
      string,
      {
        item_id: string;
        item_label: string;
        item_citations: StudioEvidenceRef[];
        byAttr: Map<string, Map<string, StudioEvidenceRef[]>>;
      }
    >();

    for (const obs of req.observations) {
      const cite = issueCitation(obs);
      const attrId = normalizeColumnId(obs.attribute_id || obs.attribute_label, attrMap.size + 1);
      const existingAttr = attrMap.get(attrId);
      if (!existingAttr) {
        attrMap.set(attrId, { id: attrId, label: obs.attribute_label || attrId, citations: [cite] });
      } else if (!existingAttr.citations.some((c) => c.badge_number === cite.badge_number)) {
        existingAttr.citations.push(cite);
      }

      const key = canonicalItemKey(obs.item_label);
      let item = itemMap.get(key);
      if (!item) {
        item = {
          item_id: `row_${itemMap.size + 1}`,
          item_label: obs.item_label.trim(),
          item_citations: [cite],
          byAttr: new Map(),
        };
        itemMap.set(key, item);
      } else if (!item.item_citations.some((c) => c.badge_number === cite.badge_number)) {
        item.item_citations.push(cite);
      }

      let valuesForAttr = item.byAttr.get(attrId);
      if (!valuesForAttr) {
        valuesForAttr = new Map();
        item.byAttr.set(attrId, valuesForAttr);
      }
      const valKey = obs.value_text.trim();
      const valCites = valuesForAttr.get(valKey) ?? [];
      if (!valCites.some((c) => c.badge_number === cite.badge_number)) {
        valCites.push(cite);
      }
      valuesForAttr.set(valKey, valCites);
    }

    // Column 0 is always the compared Item / Entity column, followed by attribute columns
    const allItemCitations = [...itemMap.values()].flatMap((it) => it.item_citations.slice(0, 1));
    const itemCol: DataTableColumn = {
      id: "entity",
      label: "Entity",
      citations: allItemCitations.length > 0 ? allItemCitations : [citations[0]!],
    };

    const attributeColumns: DataTableColumn[] = [...attrMap.values()].map((a) => ({
      id: a.id === "entity" ? "attribute_entity" : a.id,
      label: a.label,
      citations: a.citations,
    }));

    const columns: DataTableColumn[] = [...attributeColumns];
    if (columns.length < DATA_TABLE_MIN_COLUMNS) {
      columns.unshift({
        id: "entity",
        label: "Entity",
        citations: allItemCitations.length > 0 ? allItemCitations : [citations[0]!],
      });
    }
    const rawColumnCount = columns.length;
    const rawRowCount = itemMap.size;

    const rows: DataTableRow[] = [];

    for (const item of itemMap.values()) {
      const cells: Record<string, DataTableCell> = {};

      for (const col of columns) {
        if (col.id === "entity") {
          cells[col.id] = {
            state: "supported",
            display_text: item.item_label,
            disagreement: false,
            values: [{ value: item.item_label, citations: item.item_citations }],
          };
          continue;
        }
        const valuesMap = item.byAttr.get(col.id);
        if (!valuesMap || valuesMap.size === 0) {
          cells[col.id] = {
            state: "missing",
            display_text: DATA_TABLE_MISSING_MARKER,
            disagreement: false,
            values: [],
          };
        } else if (valuesMap.size === 1 || col.id === SUMMARY_ATTRIBUTE_ID) {
          // Free-text Key Findings are separate facts, not competing values: one supported cell that keeps every
          // sentence and citation (PR #161 review, FR-008). Only specific attributes can disagree.
          const entries = [...valuesMap.entries()];
          const text = entries.map(([t]) => t).join(" ");
          const valCites = entries.flatMap(([, c]) => c);
          cells[col.id] = {
            state: "supported",
            display_text: text,
            disagreement: false,
            values: [{ value: text, citations: valCites }],
          };
        } else {
          const entries = [...valuesMap.entries()].map(([text, valCites]) => ({
            value: text,
            citations: valCites,
          }));
          cells[col.id] = {
            state: "conflict",
            display_text: entries.map((e) => e.value).join(" vs. "),
            disagreement: true,
            values: entries,
          };
        }
      }

      rows.push({
        item_id: item.item_id,
        item_label: item.item_label,
        item_citations: item.item_citations,
        cells,
      });
    }

    const schemaId = req.schema_id ?? "auto";
    const boundedColumns = columns.slice(0, Math.max(DATA_TABLE_MIN_COLUMNS, Math.min(DATA_TABLE_MAX_COLUMNS, columns.length)));
    const boundedColIds = new Set(boundedColumns.map((c) => c.id));
    const boundedRows = rows.slice(0, Math.max(DATA_TABLE_MIN_ROWS, Math.min(DATA_TABLE_MAX_ROWS, rows.length))).map((r) => ({
      ...r,
      cells: Object.fromEntries(Object.entries(r.cells).filter(([k]) => boundedColIds.has(k))),
    }));
    const payload: StudioDataTablePayload = {
      schema_id: schemaId,
      focus_prompt: req.focus_prompt ?? null,
      columns: boundedColumns,
      rows: boundedRows,
      citations,
    };

    return { payload, rawRowCount, rawColumnCount };
  }
}
