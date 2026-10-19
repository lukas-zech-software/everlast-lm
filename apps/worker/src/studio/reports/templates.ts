import type { ReportSubtype } from "@everlast/contracts";

export interface BlockSpec {
  id: string;
  heading: string;
  /** Text emitted when a non-core block has no supported content. */
  emptyNote: string;
}

export interface TemplateSpec {
  title: string;
  blocks: BlockSpec[];
  /** Block IDs that must be non-empty (any one suffices when coreRule is "any"). */
  core: string[];
  coreRule: "all" | "any";
}

export const TEMPLATES: Record<ReportSubtype, TemplateSpec> = {
  briefing_doc: {
    title: "Briefing doc",
    blocks: [
      { id: "executive_summary", heading: "Executive Summary", emptyNote: "" },
      { id: "key_points", heading: "Key Points", emptyNote: "The sources contain no further supported key points." },
      { id: "key_quotes", heading: "Key Quotes", emptyNote: "The sources contain no quotable passages." },
    ],
    core: ["executive_summary"],
    coreRule: "all",
  },
  study_guide: {
    title: "Study guide",
    blocks: [
      { id: "topic_review", heading: "Topic Review", emptyNote: "" },
      { id: "glossary", heading: "Glossary", emptyNote: "The sources define no terms." },
      { id: "short_answer_quiz", heading: "Short-Answer Quiz", emptyNote: "The sources support no quiz questions." },
      { id: "essay_questions", heading: "Essay Questions", emptyNote: "The sources support no essay questions." },
    ],
    core: ["topic_review"],
    coreRule: "all",
  },
  faq: {
    title: "FAQ",
    blocks: [{ id: "faq", heading: "Frequently Asked Questions", emptyNote: "" }],
    core: ["faq"],
    coreRule: "all",
  },
  timeline: {
    title: "Timeline",
    blocks: [
      { id: "timeline_events", heading: "Timeline", emptyNote: "No dates were found in the selected sources." },
      { id: "cast", heading: "Cast of Characters", emptyNote: "No people were identified in the selected sources." },
    ],
    core: ["timeline_events", "cast"],
    coreRule: "any",
  },
  dynamic: {
    title: "Custom report",
    blocks: [{ id: "response", heading: "Report", emptyNote: "" }],
    core: ["response"],
    coreRule: "all",
  },
  custom: {
    title: "Custom report",
    blocks: [{ id: "response", heading: "Report", emptyNote: "" }],
    core: ["response"],
    coreRule: "all",
  },
};
