import type { ReportCitation, ReportSection, ReportSubtype, StudioReportPayload, UnifiedDocumentChunk } from "@everlast/contracts";
import type { ReportBlock, ReportItem } from "./model.ts";
import { noDatedEventsNotice, reportTitle, sectionHeading, TEMPLATES } from "./templates.ts";
import { splitSentences } from "./sentences.ts";

const SNIPPET_MAX = 160;

export class CitationRegistry {
  private readonly badges = new Map<string, number>();
  readonly citations: ReportCitation[] = [];
  private readonly byId: Map<string, UnifiedDocumentChunk>;
  constructor(byId: Map<string, UnifiedDocumentChunk>) {
    this.byId = byId;
  }

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

const oneLine = (s: string): string => s.replace(/\s*\r?\n\s*/g, " ").trim();

/** Every factual sentence carries the badge of its cited chunk (Gate v2.0 #3). */
const cited = (text: string, marker: string): string =>
  (splitSentences(oneLine(text)).length > 0 ? splitSentences(oneLine(text)) : [oneLine(text)]).map((s) => `${s} ${marker}`).join(" ");

function renderItems(key: string, items: ReportItem[], reg: CitationRegistry): string[] {
  return items.map((item, i) => {
    const m = reg.mark(item.chunk_id, item.quote);
    switch (key) {
      case "quotes":
        return `> ${cited(item.quote ?? item.text, m)}`;
      case "glossary":
        return `- **${oneLine(item.quote ?? item.text)}**: ${cited(item.text, m)}`;
      case "events":
        return `- **${oneLine(item.date ?? "")}**: ${cited(item.text, m)}`;
      case "faq":
        return `**Q: ${oneLine(item.question ?? "")}**\n\nA: ${cited(item.text, m)}\n`;
      case "short_answer_questions":
        return `${i + 1}. ${oneLine(item.question ?? item.text)}`;
      case "answer_key":
        return `${i + 1}. ${cited(item.text, m)}`;
      case "essay_questions":
        return `- ${oneLine(item.question ?? item.text)} ${m}`;
      default:
        return `- ${cited(item.text, m)}`;
    }
  });
}

export interface RenderInput {
  subtype: ReportSubtype;
  blocks: ReportBlock[];
  chunks: UnifiedDocumentChunk[];
  output_language?: string | undefined;
  /** Timeline without dated events: `events` carries the explicit notice (FR-005). */
  noDatedEvents?: boolean;
}

/** Renders validated sections to Markdown with deduplicated [n] badges and the stable `sections` list. */
export function renderReport(input: RenderInput): StudioReportPayload {
  const { subtype, blocks, output_language } = input;
  const reg = new CitationRegistry(new Map(input.chunks.map((c) => [c.chunk_id, c])));
  const required = TEMPLATES[subtype].sections;
  const ordered = required.length > 0 ? required.map((key) => blocks.find((b) => b.id === key) ?? { id: key, items: [] }) : blocks;
  const lines: string[] = [`# ${reportTitle(subtype, output_language)}`, ""];
  const sections: ReportSection[] = [];
  for (const block of ordered) {
    const table = block.table;
    const hasContent = block.items.length > 0 || (table?.rows.length ?? 0) > 0;
    const notice = !hasContent && block.id === "events" && input.noDatedEvents;
    if (!hasContent && !notice) continue;
    const heading = oneLine(sectionHeading(block.id, output_language, block.heading));
    sections.push({ key: block.id, heading });
    lines.push(`## ${heading}`, "");
    if (notice) {
      lines.push(`_${noDatedEventsNotice(output_language)}_`);
    } else if (table && table.rows.length > 0) {
      lines.push(`| ${table.columns.map(cell).join(" | ")} |`, `| ${table.columns.map(() => "---").join(" | ")} |`);
      for (const row of table.rows) lines.push(`| ${row.cells.map(cell).join(" | ")} ${reg.mark(row.chunk_id)} |`);
    }
    if (block.items.length > 0) lines.push(...renderItems(block.id, block.items, reg));
    lines.push("");
  }
  return { content_md: lines.join("\n").trimEnd() + "\n", citations: reg.citations, sections };
}
