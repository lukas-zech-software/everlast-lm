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

type FindingBase = Pick<Finding, "chunk_id" | "source_id">;

function questionFor(term: string | undefined, year: string | undefined, sentence: string): string {
  if (term) return `What is ${term.toLowerCase()}?`;
  if (year) return `What happened in ${year}?`;
  return `What does the source say about "${sentence.split(" ").slice(0, 5).join(" ")}"?`;
}

function personNames(sentence: string): string[] {
  const names: string[] = [];
  for (const match of sentence.match(NAME) ?? []) {
    const words = match.split(" ");
    const [first = ""] = words;
    const name = NAME_STOP.has(first) ? words.slice(1).join(" ") : match;
    if (name.includes(" ")) names.push(name);
  }
  return names;
}

function extractSentenceFindings(base: FindingBase, sentence: string, index: number): Finding[] {
  const out: Finding[] = [];
  out.push({ ...base, kind: index === 0 ? "summary" : "fact", text: sentence });
  out.push({ ...base, kind: "quote", text: sentence, quote: sentence });
  const year = YEAR.exec(sentence)?.[1];
  if (year) out.push({ ...base, kind: "event", text: sentence, date: year });
  const term = DEFINITION.exec(sentence)?.[1];
  if (term) out.push({ ...base, kind: "term", text: sentence, quote: term });
  for (const name of personNames(sentence)) out.push({ ...base, kind: "person", text: name, quote: name });
  if (/\brisk\b/i.test(sentence)) out.push({ ...base, kind: "risk", text: sentence });
  out.push({ ...base, kind: "qa", text: sentence, question: questionFor(term, year, sentence) });
  return out;
}

function extractFindings(req: ExtractRequest): Finding[] {
  const out: Finding[] = [];
  for (const chunk of req.chunks) {
    const base = { chunk_id: chunk.chunk_id, source_id: chunk.source_id };
    splitSentences(chunk.text).forEach((sentence, index) => {
      out.push(...extractSentenceFindings(base, sentence, index));
    });
  }
  return out;
}

type FindingSelector = (kind: Finding["kind"]) => Finding[];
type ItemMapper = (findings: Finding[]) => ReportItem[];

function toItems(findings: Finding[]): ReportItem[] {
  return findings.map((f) => ({
    text: f.text,
    chunk_id: f.chunk_id,
    ...(f.quote === undefined ? {} : { quote: f.quote }),
    ...(f.date === undefined ? {} : { date: f.date }),
    ...(f.question === undefined ? {} : { question: f.question }),
  }));
}

function firstPerSource(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    if (seen.has(f.source_id)) return false;
    seen.add(f.source_id);
    return true;
  });
}

function composeStudyGuide(of: FindingSelector, items: ItemMapper): ReportBlock[] {
  const quiz = items(of("qa").slice(0, 5));
  return [
    { id: "topic_review", items: items(of("summary")) },
    { id: "short_answer_questions", items: quiz },
    { id: "answer_key", items: quiz },
    {
      id: "essay_questions",
      items: items(of("summary")).map((i) => ({
        ...i,
        question: `Discuss: ${i.text.replace(/[.!?]$/, "")}.`,
      })),
    },
    { id: "glossary", items: items(of("term")) },
  ];
}

function composeCustom(req: ComposeRequest, of: FindingSelector, items: ItemMapper): ReportBlock {
  if (/risk matrix/i.test(req.custom_prompt ?? "")) {
    const rows = firstPerSource(of("risk")).map((f, i) => ({
      cells: [`Source ${i + 1}`, f.text],
      chunk_id: f.chunk_id,
    }));
    return { id: "report", items: [], table: { columns: ["Source", "Risk"], rows } };
  }
  return { id: "report", items: items([...of("fact"), ...of("summary")]) };
}

function composeBlocks(req: ComposeRequest): ReportBlock[] {
  const of: FindingSelector = (kind) => req.findings.filter((f) => f.kind === kind);
  const items = toItems;
  switch (req.subtype) {
    case "briefing_doc":
      return [
        { id: "executive_summary", items: items(firstPerSource(of("summary"))) },
        { id: "core_themes", items: items(of("summary")) },
        { id: "key_takeaways", items: items(of("fact")) },
        { id: "quotes", items: items(of("quote").slice(0, 3)) },
      ];
    case "study_guide":
      return composeStudyGuide(of, items);
    case "faq":
      return [{ id: "faq", items: items(of("qa")) }];
    case "timeline":
      return [
        { id: "events", items: items(of("event")) },
        { id: "cast_of_characters", items: items(of("person")) },
      ];
    case "custom":
    case "dynamic":
      return [composeCustom(req, of, items)];
  }
}

function suggestReports(req: SuggestRequest): ReportSuggestion[] {
  const topics = req.guides.flatMap((g) => g.key_topics ?? []).slice(0, 2);
  const focus = topics.length > 0 ? topics.join(" and ") : "the selected sources";
  return [
    {
      title: "Compare the sources",
      description: `Compare perspectives on ${focus}.`,
      prompt_template: `Compare how the sources treat ${focus}.`,
    },
    {
      title: "Risk overview",
      description: `Summarise the main risks in ${focus}.`,
      prompt_template: `Summarise the main risks of ${focus}.`,
    },
    {
      title: "Decision brief",
      description: `Brief a decision maker on ${focus}.`,
      prompt_template: `Write a decision brief about ${focus}.`,
    },
  ];
}

/** Deterministic, offline stand-in for the production model; no randomness, no network. */
export class DeterministicReportModel implements ReportModelClient, ReportSuggestionModel {
  extract(req: ExtractRequest): Promise<Finding[]> {
    return Promise.resolve(extractFindings(req));
  }

  compose(req: ComposeRequest): Promise<ReportBlock[]> {
    return Promise.resolve(composeBlocks(req));
  }

  suggest(req: SuggestRequest): Promise<ReportSuggestion[]> {
    return Promise.resolve(suggestReports(req));
  }
}
