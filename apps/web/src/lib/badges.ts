/**
 * Citation badge parsing (FR-GC-02, FR-GC-03). Answers store badges as `[[n]]` markers; consecutive markers form
 * one group rendered after the sentence. Groups longer than three show the first three plus "+N".
 */

export type AnswerSegment = { type: "text"; text: string } | { type: "badges"; numbers: number[] };

const MARKER = /(?:\[\[\d+\]\])+/g;

export function parseAnswer(content: string): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let last = 0;
  for (const match of content.matchAll(MARKER)) {
    if (match.index! > last) segments.push({ type: "text", text: content.slice(last, match.index) });
    segments.push({ type: "badges", numbers: [...match[0].matchAll(/\[\[(\d+)\]\]/g)].map((m) => Number(m[1])) });
    last = match.index! + match[0].length;
  }
  if (last < content.length) segments.push({ type: "text", text: content.slice(last) });
  return segments;
}

export function splitBadgeGroup(numbers: number[], visible = 3): { shown: number[]; hidden: number[] } {
  return { shown: numbers.slice(0, visible), hidden: numbers.slice(visible) };
}
