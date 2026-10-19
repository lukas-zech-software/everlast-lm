import type { UnifiedDocumentChunk } from "@everlast/contracts";
import type { ReportBlock } from "./model.js";

/** Pre-render grounding check: every item/row cites a scoped chunk; dates and quotes are literal substrings (FR-014, NFR-EVAL-02). */
export function validateReportBlocks(blocks: ReportBlock[], chunks: UnifiedDocumentChunk[]): string | null {
  const byId = new Map(chunks.map((c) => [c.chunk_id, c]));
  for (const block of blocks) {
    for (const item of block.items) {
      const chunk = byId.get(item.chunk_id);
      if (!chunk) return `Item in ${block.id} cites an unknown chunk`;
      if (item.date !== undefined && !chunk.text.includes(item.date)) return `Date ${item.date} is not in the cited chunk`;
      if (item.quote !== undefined && !chunk.text.includes(item.quote)) return `Quote in ${block.id} is not in the cited chunk`;
    }
    for (const row of block.table?.rows ?? []) {
      if (!byId.has(row.chunk_id)) return `Row in ${block.id} cites an unknown chunk`;
    }
  }
  return null;
}
