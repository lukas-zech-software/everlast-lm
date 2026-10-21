import { uuidv7, type UnifiedDocumentChunk } from "@everlast/contracts";
import type { CanonicalDocument } from "./extract.ts";

/**
 * Structure-aware chunker (FR-SI-01, C-01). Chunks target 300–600 tokens with a configurable overlap and
 * never cross page or section boundaries; short sections may be smaller. Locator offsets are Unicode code
 * points into the canonical page text, so `[...page].slice(start_offset, end_offset).join("") === text`.
 */

export interface ChunkerOptions {
  minTokens?: number;
  maxTokens?: number;
  overlapTokens?: number;
}

interface Token {
  /** UTF-16 start/end within the page text. */
  start: number;
  end: number;
  /** A preferred cut point follows this token (sentence end or line/paragraph break). */
  boundary: boolean;
}

const TOKEN_RE = /[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu;

/** Deterministic tokenizer: letter/number runs and single punctuation marks (approximate model tokens). */
export function tokenizeRange(text: string, from: number, to: number): Token[] {
  const tokens: Token[] = [];
  const segment = text.slice(from, to);
  for (const match of segment.matchAll(TOKEN_RE)) {
    tokens.push({ start: from + match.index!, end: from + match.index! + match[0].length, boundary: false });
  }
  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t]!;
    const next = tokens[t + 1];
    const last = text[token.end - 1]!;
    const gap = next ? text.slice(token.end, next.start) : "\n";
    token.boundary = ".!?:;".includes(last) || gap.includes("\n");
  }
  return tokens;
}

/** Monotonic UTF-16 → code point index converter (each call must not go backwards). */
function codePointCounter(text: string) {
  let utf16 = 0;
  let cps = 0;
  return (target: number): number => {
    if (target < utf16) {
      utf16 = 0;
      cps = 0;
    }
    while (utf16 < target) {
      const code = text.charCodeAt(utf16);
      utf16 += code >= 0xd800 && code <= 0xdbff && utf16 + 1 < text.length ? 2 : 1;
      cps++;
    }
    return cps;
  };
}

export function chunkDocument(
  doc: CanonicalDocument,
  sourceId: string,
  revision: number,
  options: ChunkerOptions = {}
): UnifiedDocumentChunk[] {
  const minTokens = options.minTokens ?? 300;
  const maxTokens = options.maxTokens ?? 600;
  const overlap = options.overlapTokens ?? 50;
  const chunks: UnifiedDocumentChunk[] = [];

  for (const page of doc.pages) {
    const startCp = codePointCounter(page.text);
    const endCp = codePointCounter(page.text);
    for (const [sectionStart, sectionEnd] of page.sections) {
      const tokens = tokenizeRange(page.text, sectionStart, sectionEnd);
      let first = 0;
      while (first < tokens.length) {
        let last = Math.min(first + maxTokens, tokens.length) - 1;
        if (last < tokens.length - 1) {
          for (let t = last; t >= first + minTokens - 1; t--) {
            if (tokens[t]!.boundary) {
              last = t;
              break;
            }
          }
        }
        const start16 = tokens[first]!.start;
        const end16 = tokens[last]!.end;
        chunks.push({
          chunk_id: uuidv7(),
          source_id: sourceId,
          revision,
          locator: {
            page_number: page.page_number,
            ...(page.physical_page !== undefined ? { physical_page: page.physical_page } : {}),
            start_offset: startCp(start16),
            end_offset: endCp(end16),
          },
          token_count: last - first + 1,
          text: page.text.slice(start16, end16),
        });
        if (last >= tokens.length - 1) break;
        first = Math.max(first + 1, last + 1 - overlap);
      }
    }
  }
  return chunks;
}
