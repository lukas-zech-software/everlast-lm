/**
 * Text limits and Unicode code-point helpers (FR-WM-01, FR-WM-07).
 * Pure normalization and length validation respecting Unicode code points.
 */

export const DEFAULT_NOTEBOOK_TITLE = "Untitled notebook";

/** Counts Unicode code points (treating surrogate pairs as 1 code point) without array allocation. */
export function countCodePoints(text: string): number {
  let count = 0;
  for (const _cp of text) {
    count += 1;
  }
  return count;
}

/** Splits a string into Unicode code points (treating surrogate pairs as 1 element). */
export function toCodePoints(text: string): string[] {
  const codePoints: string[] = [];
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i);
    const step = cp !== undefined && cp > 0xffff ? 2 : 1;
    codePoints.push(text.slice(i, i + step));
    i += step;
  }
  return codePoints;
}

export interface TitleValidationResult {
  valid: boolean;
  codePoints: number;
  normalized?: string;
  error?: string;
}

/**
 * Normalizes notebook title input.
 * If input is null, undefined, or empty/whitespace-only, returns "Untitled notebook".
 * Otherwise trims outer whitespace while preserving internal content.
 */
export function normalizeNotebookTitle(input: string | null | undefined): string {
  if (input === null || input === undefined) {
    return DEFAULT_NOTEBOOK_TITLE;
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return DEFAULT_NOTEBOOK_TITLE;
  }
  return trimmed;
}

/**
 * Legacy/general title trimmer.
 */
export function normalizeTitle(title: string): string {
  return title.trim();
}

/**
 * Validates notebook title against 1–100 Unicode code point constraints.
 * Uses Array.from to accurately count Unicode code points (treating surrogate pairs as 1 code point).
 * Rejects 0 or >100 code points after outer whitespace trimming without silent truncation.
 */
export function validateNotebookTitle(title: string): TitleValidationResult {
  const trimmed = title.trim();
  const codePoints = countCodePoints(trimmed);

  if (codePoints < 1) {
    return {
      valid: false,
      codePoints: 0,
      error: "Title must not be empty or whitespace only.",
    };
  }

  if (codePoints > 100) {
    return {
      valid: false,
      codePoints,
      error: `Title exceeds 100 code points limit (received ${codePoints}).`,
    };
  }

  return {
    valid: true,
    codePoints,
    normalized: trimmed,
  };
}

export function validateTitleLength(title: string): TitleValidationResult {
  return validateNotebookTitle(title);
}

/**
 * Extracted-word convention shared by API pre-checks and the ingestion worker (FR-WM-07, FR-SI-01):
 * runs of non-whitespace separated by Unicode whitespace.
 */
export function countWords(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length;
}
