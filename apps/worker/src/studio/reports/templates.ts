import { REQUIRED_REPORT_SECTIONS, type ReportSubtype } from "@everlast/contracts";

/**
 * Report templates (FR-ST-10, FR-ST-11). Template subtypes carry the card's required section keys
 * (`REQUIRED_REPORT_SECTIONS`, C-03 payload `sections`); dynamic and custom reports use model-defined sections.
 */
export interface TemplateSpec {
  /** Artifact title shown in the Studio list (UI language). */
  title: string;
  /** Required section keys in render order; empty for model-defined sections. */
  sections: readonly string[];
}

export const TEMPLATES: Record<ReportSubtype, TemplateSpec> = {
  briefing_doc: { title: "Briefing doc", sections: REQUIRED_REPORT_SECTIONS.briefing_doc },
  study_guide: { title: "Study guide", sections: REQUIRED_REPORT_SECTIONS.study_guide },
  faq: { title: "FAQ", sections: REQUIRED_REPORT_SECTIONS.faq },
  timeline: { title: "Timeline", sections: REQUIRED_REPORT_SECTIONS.timeline },
  dynamic: { title: "Custom report", sections: [] },
  custom: { title: "Custom report", sections: [] },
};

/** Default key of a model-defined (dynamic/custom) report with a single section. */
export const CUSTOM_REPORT_SECTION = "report";

/** Sections whose lines are questions, not factual sentences (Gate v2.0 #3 per-sentence citation rule). */
export const QUESTION_SECTIONS: ReadonlySet<string> = new Set(["short_answer_questions", "essay_questions"]);

type Lang = "en" | "de";
const HEADINGS: Record<Lang, Record<string, string>> = {
  en: {
    executive_summary: "Executive Summary",
    core_themes: "Core Themes",
    key_takeaways: "Key Takeaways",
    quotes: "Quotes",
    topic_review: "Topic Review",
    short_answer_questions: "Short-Answer Questions",
    answer_key: "Answer Key",
    essay_questions: "Essay Questions",
    glossary: "Glossary",
    faq: "Frequently Asked Questions",
    events: "Events",
    cast_of_characters: "Cast of Characters",
    report: "Report",
  },
  de: {
    executive_summary: "Zusammenfassung",
    core_themes: "Kernthemen",
    key_takeaways: "Wichtigste Erkenntnisse",
    quotes: "Zitate",
    topic_review: "Themenüberblick",
    short_answer_questions: "Kurzantwortfragen",
    answer_key: "Lösungen",
    essay_questions: "Essayfragen",
    glossary: "Glossar",
    faq: "Häufig gestellte Fragen",
    events: "Ereignisse",
    cast_of_characters: "Hauptakteure",
    report: "Bericht",
  },
};
const TITLES: Record<Lang, Record<ReportSubtype, string>> = {
  en: { briefing_doc: "Briefing doc", study_guide: "Study guide", faq: "FAQ", timeline: "Timeline", dynamic: "Custom report", custom: "Custom report" },
  de: { briefing_doc: "Briefing-Dokument", study_guide: "Studienleitfaden", faq: "FAQ", timeline: "Zeitleiste", dynamic: "Eigener Bericht", custom: "Eigener Bericht" },
};
const NO_DATED_EVENTS: Record<Lang, string> = {
  en: "The selected sources contain no dated events.",
  de: "Die ausgewählten Quellen enthalten keine datierten Ereignisse.",
};

/** Known heading language of a BCP-47 tag, or null when the model supplies headings (FR-UI-02). */
function lang(tag: string | undefined): Lang | null {
  const base = (tag ?? "en").toLowerCase().split("-")[0];
  return base === "de" ? "de" : base === "en" ? "en" : null;
}

const humanize = (key: string) => key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");

/** Section heading by stable key: fixed table for en/de, else the model's localized heading, else English. */
export function sectionHeading(key: string, outputLanguage: string | undefined, modelHeading?: string): string {
  const l = lang(outputLanguage);
  if (l) return HEADINGS[l][key] ?? modelHeading ?? humanize(key);
  return modelHeading?.trim() || HEADINGS.en[key] || humanize(key);
}

export function reportTitle(subtype: ReportSubtype, outputLanguage: string | undefined): string {
  return TITLES[lang(outputLanguage) ?? "en"][subtype];
}

export function noDatedEventsNotice(outputLanguage: string | undefined): string {
  return NO_DATED_EVENTS[lang(outputLanguage) ?? "en"];
}
