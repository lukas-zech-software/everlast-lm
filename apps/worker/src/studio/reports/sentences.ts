/** Splits text into sentences at `.`, `!` or `?` followed by whitespace (linear; no backtracking). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
