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
  return chunkDocumentAnchored(doc, sourceId, revision, options).map((c) => c.chunk);
}

export interface AnchoredChunk {
  chunk: UnifiedDocumentChunk;
  /** Viewer page (canonical `source_pages` row) the chunk is displayed on; database-only (specs/009). */
  anchorPage: number;
}

/** Transcript policy (FR-SI-01, Gate v3.0 #1): segment-aligned chunks so every citation seeks to its own statement. */
export const TRANSCRIPT_CHUNK_MAX_TOKENS = 120;
export const TRANSCRIPT_CHUNK_MAX_MS = 60_000;

/**
 * Transcript chunking (C-01 `time_span`): consecutive segments are merged only while the merged chunk stays within
 * TRANSCRIPT_CHUNK_MAX_TOKENS / TRANSCRIPT_CHUNK_MAX_MS and the previous segment did not end a sentence, so a cited
 * statement starts its own chunk. Locators are the integer [start_ms, end_ms] of the merged segments.
 */
export function chunkTranscript(doc: CanonicalDocument, sourceId: string, revision: number): AnchoredChunk[] {
  const out: AnchoredChunk[] = [];
  let group: typeof doc.pages = [];
  let tokens = 0;
  const flush = () => {
    if (group.length === 0) return;
    const text = group.map((p) => p.text.trim()).join(" ");
    out.push({
      chunk: {
        chunk_id: uuidv7(),
        source_id: sourceId,
        revision,
        locator: { start_ms: group[0]!.start_ms!, end_ms: group.at(-1)!.end_ms! },
        token_count: tokenizeRange(text, 0, text.length).length,
        text,
      },
      anchorPage: group[0]!.page_number,
    });
    group = [];
    tokens = 0;
  };
  for (const page of doc.pages) {
    if (page.start_ms === undefined || page.end_ms === undefined) throw new Error("Transcript page without a time interval");
    if (!page.text.trim()) continue;
    const pageTokens = tokenizeRange(page.text, 0, page.text.length).length;
    const last = group.at(-1);
    const sentenceEnded = last ? /[.!?…]["')\]]?\s*$/.test(last.text) : false;
    if (last && (sentenceEnded || tokens + pageTokens > TRANSCRIPT_CHUNK_MAX_TOKENS || page.end_ms - group[0]!.start_ms! > TRANSCRIPT_CHUNK_MAX_MS)) flush();
    group.push(page);
    tokens += pageTokens;
  }
  flush();
  return out;
}

/** Page/section chunking with viewer anchors; article pages emit `dom_path` locators into their section. */
export function chunkDocumentAnchored(
  doc: CanonicalDocument,
  sourceId: string,
  revision: number,
  options: ChunkerOptions = {}
): AnchoredChunk[] {
  const out: AnchoredChunk[] = [];
  const minTokens = options.minTokens ?? 300;
  const maxTokens = options.maxTokens ?? 600;
  const overlap = options.overlapTokens ?? 50;

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
        const startOffset = startCp(start16);
        const endOffset = endCp(end16);
        out.push({
          chunk: {
            chunk_id: uuidv7(),
            source_id: sourceId,
            revision,
            locator: page.dom_selector
              ? { selector: page.dom_selector, start_offset: startOffset, end_offset: endOffset }
              : {
                  page_number: page.page_number,
                  ...(page.physical_page !== undefined ? { physical_page: page.physical_page } : {}),
                  start_offset: startOffset,
                  end_offset: endOffset,
                },
            token_count: last - first + 1,
            text: page.text.slice(start16, end16),
          },
          anchorPage: page.page_number,
        });
        if (last >= tokens.length - 1) break;
        first = Math.max(first + 1, last + 1 - overlap);
      }
    }
  }
  return out;
}
