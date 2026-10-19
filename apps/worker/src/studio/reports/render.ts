import type { ReportCitation, StudioReportPayload, UnifiedDocumentChunk } from "@everlast/contracts";
import type { ReportBlock, ReportItem } from "./model.js";
import type { BlockSpec } from "./templates.js";

const SNIPPET_MAX = 160;

export class CitationRegistry {
  private readonly badges = new Map<string, number>();
  readonly citations: ReportCitation[] = [];
  constructor(private readonly byId: Map<string, UnifiedDocumentChunk>) {}

  mark(chunkId: string, quote?: string): string {
    let n = this.badges.get(chunkId);
    if (n === undefined) {
      const chunk = this.byId.get(chunkId)!;
      n = this.citations.length + 1;
      this.badges.set(chunkId, n);
      const snippet = quote && chunk.text.includes(quote) ? quote : chunk.text.slice(0, SNIPPET_MAX).trim();
      this.citations.push({ badge_number: n, chunk_id: chunkId, source_id: chunk.source_id, revision: chunk.revision, snippet });
    }
    return `[${n}]`;
  }
}

const cell = (s: string): string =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");

function renderItem(block: BlockSpec, item: ReportItem, reg: CitationRegistry): string {
  const m = reg.mark(item.chunk_id, item.quote);
  switch (block.id) {
    case "key_quotes":
      return `> ${item.text} ${m}`;
    case "glossary":
      return `- **${item.quote ?? item.text}**: ${item.text} ${m}`;
    case "timeline_events":
      return `- **${item.date}**: ${item.text} ${m}`;
    case "faq":
      return `**Q: ${item.question}**\n\nA: ${item.text} ${m}\n`;
    case "short_answer_quiz":
      return `1. ${item.question}\n   - Answer: ${item.text} ${m}`;
    case "essay_questions":
      return `- ${item.question} ${m}`;
    default:
      return `- ${item.text} ${m}`;
  }
}

/** Renders ordered, validated blocks to Markdown with deduplicated [n] badges. */
export function renderReport(
  title: string,
  specs: BlockSpec[],
  blocks: ReportBlock[],
  chunks: UnifiedDocumentChunk[]
): StudioReportPayload {
  const reg = new CitationRegistry(new Map(chunks.map((c) => [c.chunk_id, c])));
  const lines: string[] = [`# ${title}`, ""];
  for (const spec of specs) {
    const block = blocks.find((b) => b.id === spec.id);
    lines.push(`## ${spec.heading}`, "");
    const table = block?.table;
    if (table && table.rows.length > 0) {
      lines.push(`| ${table.columns.map(cell).join(" | ")} |`, `| ${table.columns.map(() => "---").join(" | ")} |`);
      for (const row of table.rows) lines.push(`| ${row.cells.map(cell).join(" | ")} ${reg.mark(row.chunk_id)} |`);
    } else if (block && block.items.length > 0) {
      const out = block.items.map((i) => renderItem(spec, i, reg));
      lines.push(...out);
    } else if (spec.emptyNote) {
      lines.push(`_${spec.emptyNote}_`);
    }
    lines.push("");
  }
  return { content_md: lines.join("\n").trimEnd() + "\n", citations: reg.citations };
}
