import { describe, it, expect } from "vitest";
import { savedResponseView, citationForBadge, isEditable } from "../src/notes/saved-response.ts";
import { assistantActions, ASSISTANT_DISCLOSURE } from "../src/notes/assistant.ts";

const note = {
  origin_type: "saved_response" as const,
  content_md: "Port 8080 requires mTLS [1] and rotation [2]",
  citations_json: [
    { badge_number: 1, source_id: "s1", source_title: "Spec.pdf", chunk_id: "c1" },
    { badge_number: 2, source_id: "s2", source_title: "Ops.pdf", chunk_id: "c2" },
  ],
};

describe("FR-NM-02: saved response rendering", () => {
  it("is read-only and exposes working citation badges", () => {
    expect(isEditable(note)).toBe(false);
    expect(isEditable({ ...note, origin_type: "manual" as const })).toBe(true);
    const view = savedResponseView(note);
    expect(view.readOnly).toBe(true);
    expect(view.segments.filter((s) => s.type === "badge").map((s) => (s as { badge_number: number }).badge_number)).toEqual([1, 2]);
    expect(citationForBadge(note, 2)?.source_title).toBe("Ops.pdf");
    expect(citationForBadge(note, 9)).toBeNull();
  });

  it("leaves unmatched bracket numbers as plain text", () => {
    const v = savedResponseView({ ...note, content_md: "see [7]" });
    expect(v.segments).toEqual([{ type: "text", text: "see [7]" }]);
  });
});

describe("FR-NM-04: assistant actions", () => {
  it("offers four actions for 1..50 notes and requires a comparison source for two of them", () => {
    const a = assistantActions({ noteCount: 3, comparisonSourceCount: 0 });
    expect(a.map((x) => x.action)).toEqual(["summarize", "create_outline", "related_ideas", "critique"]);
    expect(a.filter((x) => !x.enabled).map((x) => x.action)).toEqual(["related_ideas", "critique"]);
    expect(a.find((x) => x.action === "critique")?.hint).toBe("Select a comparison source first");
    expect(assistantActions({ noteCount: 3, comparisonSourceCount: 1 }).every((x) => x.enabled)).toBe(true);
  });

  it("disables everything outside 1..50 notes and discloses the source snapshot", () => {
    expect(assistantActions({ noteCount: 0, comparisonSourceCount: 1 }).every((x) => !x.enabled)).toBe(true);
    expect(assistantActions({ noteCount: 51, comparisonSourceCount: 1 }).every((x) => !x.enabled)).toBe(true);
    expect(ASSISTANT_DISCLOSURE).toMatch(/source snapshot/i);
  });
});
