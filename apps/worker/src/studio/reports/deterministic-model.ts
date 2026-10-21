import type { ReportSuggestion } from "@everlast/contracts";
import type {
  ComposeRequest,
  ExtractRequest,
  Finding,
  ReportBlock,
  ReportItem,
  ReportModelClient,
  ReportSuggestionModel,
  SuggestRequest,
} from "./model.ts";
import { splitSentences } from "./sentences.ts";

const YEAR = /\b(1[0-9]{3}|20[0-9]{2})\b/;
const DEFINITION = /^(?:A |An |The )?([A-Za-z][A-Za-z -]{1,40}?) (?:is a|is an|means|refers to)\b/;
const NAME = /\b[A-Z][a-z]+(?: (?:von|van|de) )?(?: ?[A-Z][a-z]+)+\b/g;
const NAME_STOP = new Set(["The", "In", "A", "An", "It", "This", "Vendor"]);

export { splitSentences };

/** Deterministic, offline stand-in for the production model; no randomness, no network. */
export class DeterministicReportModel implements ReportModelClient, ReportSuggestionModel {
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
    const firstPerSource = (fs: Finding[]): Finding[] => {
      const seen = new Set<string>();
      return fs.filter((f) => (seen.has(f.source_id) ? false : (seen.add(f.source_id), true)));
    };
    switch (req.subtype) {
      case "briefing_doc":
        return [
          { id: "executive_summary", items: items(firstPerSource(of("summary"))) },
          { id: "core_themes", items: items(of("summary")) },
          { id: "key_takeaways", items: items(of("fact")) },
          { id: "quotes", items: items(of("quote").slice(0, 3)) },
        ];
      case "study_guide": {
        const quiz = items(of("qa").slice(0, 5));
        return [
          { id: "topic_review", items: items(of("summary")) },
          { id: "short_answer_questions", items: quiz },
          { id: "answer_key", items: quiz },
          {
            id: "essay_questions",
            items: items(of("summary")).map((i) => ({ ...i, question: `Discuss: ${i.text.replace(/[.!?]$/, "")}.` })),
          },
          { id: "glossary", items: items(of("term")) },
        ];
      }
      case "faq":
        return [{ id: "faq", items: items(of("qa")) }];
      case "timeline":
        return [
          { id: "events", items: items(of("event")) },
          { id: "cast_of_characters", items: items(of("person")) },
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
      return { id: "report", items: [], table: { columns: ["Source", "Risk"], rows } };
    }
    return { id: "report", items: items(of("fact").concat(of("summary"))) };
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
