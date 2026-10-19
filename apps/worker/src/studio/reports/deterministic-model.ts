import type { ReportSuggestion } from "@everlast/contracts";
import type {
  ComposeRequest,
  ExtractRequest,
  Finding,
  ReportBlock,
  ReportItem,
  ReportModelClient,
  SuggestRequest,
} from "./model.ts";

const YEAR = /\b(1[0-9]{3}|20[0-9]{2})\b/;
const DEFINITION = /^(?:A |An |The )?([A-Za-z][A-Za-z -]{1,40}?) (?:is a|is an|means|refers to)\b/;
const NAME = /\b[A-Z][a-z]+(?: (?:von|van|de) )?(?: ?[A-Z][a-z]+)+\b/g;
const NAME_STOP = new Set(["The", "In", "A", "An", "It", "This", "Vendor"]);

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Deterministic, offline stand-in for the production model; no randomness, no network. */
export class DeterministicReportModel implements ReportModelClient {
  async extract(req: ExtractRequest): Promise<Finding[]> {
    const out: Finding[] = [];
    for (const chunk of req.chunks) {
      const base = { chunk_id: chunk.chunk_id, source_id: chunk.source_id };
      splitSentences(chunk.text).forEach((sentence, index) => {
        if (index === 0) out.push({ ...base, kind: "summary", text: sentence });
        else out.push({ ...base, kind: "fact", text: sentence });
        out.push({ ...base, kind: "quote", text: sentence, quote: sentence });
        const year = YEAR.exec(sentence)?.[1];
        if (year) out.push({ ...base, kind: "event", text: sentence, date: year });
        const term = DEFINITION.exec(sentence)?.[1];
        if (term) out.push({ ...base, kind: "term", text: sentence, quote: term });
        for (const match of sentence.match(NAME) ?? []) {
          const words = match.split(" ");
          const name = NAME_STOP.has(words[0]!) ? words.slice(1).join(" ") : match;
          if (name.includes(" ")) out.push({ ...base, kind: "person", text: name, quote: name });
        }
        if (/\brisk\b/i.test(sentence)) out.push({ ...base, kind: "risk", text: sentence });
        const question = term
          ? `What is ${term.toLowerCase()}?`
          : year
            ? `What happened in ${year}?`
            : `What does the source say about "${sentence.split(" ").slice(0, 5).join(" ")}"?`;
        out.push({ ...base, kind: "qa", text: sentence, question });
      });
    }
    return out;
  }

  async compose(req: ComposeRequest): Promise<ReportBlock[]> {
    const of = (kind: Finding["kind"]): Finding[] => req.findings.filter((f) => f.kind === kind);
    const items = (fs: Finding[]): ReportItem[] =>
      fs.map((f) => ({
        text: f.text,
        chunk_id: f.chunk_id,
        ...(f.quote !== undefined ? { quote: f.quote } : {}),
        ...(f.date !== undefined ? { date: f.date } : {}),
        ...(f.question !== undefined ? { question: f.question } : {}),
      }));
    switch (req.subtype) {
      case "briefing_doc":
        return [
          { id: "executive_summary", items: items(of("summary")) },
          { id: "key_points", items: items(of("fact")) },
          { id: "key_quotes", items: items(of("quote").slice(0, 3)) },
        ];
      case "study_guide":
        return [
          { id: "topic_review", items: items(of("summary")) },
          { id: "glossary", items: items(of("term")) },
          {
            id: "short_answer_quiz",
            items: items(of("qa").slice(0, 5)),
          },
          {
            id: "essay_questions",
            items: items(of("summary")).map((i) => ({ ...i, question: `Discuss: ${i.text.replace(/[.!?]$/, "")}.` })),
          },
        ];
      case "faq":
        return [{ id: "faq", items: items(of("qa")) }];
      case "timeline":
        return [
          { id: "timeline_events", items: items(of("event")) },
          { id: "cast", items: items(of("person")) },
        ];
      default:
        return [this.composeCustom(req, of, items)];
    }
  }

  private composeCustom(
    req: ComposeRequest,
    of: (k: Finding["kind"]) => Finding[],
    items: (fs: Finding[]) => ReportItem[]
  ): ReportBlock {
    if (/risk matrix/i.test(req.custom_prompt ?? "")) {
      const firstPerSource = new Map<string, Finding>();
      for (const f of of("risk")) if (!firstPerSource.has(f.source_id)) firstPerSource.set(f.source_id, f);
      const rows = [...firstPerSource.values()].map((f, i) => ({
        cells: [`Source ${i + 1}`, f.text],
        chunk_id: f.chunk_id,
      }));
      return { id: "response", items: [], table: { columns: ["Source", "Risk"], rows } };
    }
    return { id: "response", items: items(of("fact").concat(of("summary"))) };
  }

  async suggest(req: SuggestRequest): Promise<ReportSuggestion[]> {
    const topics = req.guides.flatMap((g) => g.key_topics ?? []).slice(0, 2);
    const focus = topics.length > 0 ? topics.join(" and ") : "the selected sources";
    const base: ReportSuggestion[] = [
      { title: "Compare the sources", description: `Compare perspectives on ${focus}.`, prompt_template: `Compare how the sources treat ${focus}.` },
      { title: "Risk overview", description: `Summarise the main risks in ${focus}.`, prompt_template: `Summarise the main risks of ${focus}.` },
      { title: "Decision brief", description: `Brief a decision maker on ${focus}.`, prompt_template: `Write a decision brief about ${focus}.` },
    ];
    return base;
  }
}
