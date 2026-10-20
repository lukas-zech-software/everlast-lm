import type { Citation } from "@everlast/contracts";

export interface SavedResponseNote {
  origin_type: "manual" | "saved_response";
  content_md: string;
  citations_json: Pick<Citation, "badge_number" | "source_id" | "source_title" | "chunk_id">[];
}

export type SavedResponseSegment = { type: "text"; text: string } | { type: "badge"; badge_number: number };

export const isEditable = (note: Pick<SavedResponseNote, "origin_type">): boolean => note.origin_type === "manual";

/**
 * FR-NM-02: read-only view whose verified badges stay clickable (open the Source Inspector). Markers are `[[n]]` as
 * stored by the v1 chat, or the legacy `[n]`; only numbers that have a copied citation become badges.
 */
export function savedResponseView(note: SavedResponseNote): { readOnly: boolean; segments: SavedResponseSegment[] } {
  const known = new Set(note.citations_json.map((c) => c.badge_number));
  const segments: SavedResponseSegment[] = [];
  let last = 0;
  for (const m of note.content_md.matchAll(/\[\[(\d{1,6})\]\]|\[(\d{1,6})\]/g)) {
    const n = Number(m[1] ?? m[2]);
    if (!known.has(n)) continue;
    if (m.index! > last) segments.push({ type: "text", text: note.content_md.slice(last, m.index) });
    segments.push({ type: "badge", badge_number: n });
    last = m.index! + m[0].length;
  }
  if (last < note.content_md.length) segments.push({ type: "text", text: note.content_md.slice(last) });
  return { readOnly: !isEditable(note), segments };
}

export function citationForBadge(note: SavedResponseNote, badge: number) {
  return note.citations_json.find((c) => c.badge_number === badge) ?? null;
}
