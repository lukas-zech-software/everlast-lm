import { describe, expect, it } from "vitest";
import { parseAnswer, splitBadgeGroup } from "../src/lib/badges.ts";
import { SelectionModel, sourcesLabel } from "../src/lib/selection.ts";
import { breakpointFor, defaultPreferences } from "../src/lib/layout.ts";
import { codePointLength, validateMessage, validateTitle } from "../src/lib/text.ts";
import { displaySpans } from "../src/sources/inspector.ts";

/** Pure UI logic (FR-GC-02, FR-SI-03, FR-UI-01, FR-WM-01, FR-SI-04) — DOM-free unit tests. */

describe("citation badges (FR-GC-02)", () => {
  it("WEB-01: parses [[n]] markers into grouped badges after sentences", () => {
    expect(parseAnswer("A.[[1]] B.[[2]][[3]] C.")).toEqual([
      { type: "text", text: "A." },
      { type: "badges", numbers: [1] },
      { type: "text", text: " B." },
      { type: "badges", numbers: [2, 3] },
      { type: "text", text: " C." },
    ]);
  });
  it("WEB-02: eight supporting chunks show three badges and +5", () => {
    expect(splitBadgeGroup([1, 2, 3, 4, 5, 6, 7, 8])).toEqual({ shown: [1, 2, 3], hidden: [4, 5, 6, 7, 8] });
  });
});

describe("selection (FR-SI-03)", () => {
  const sources = (statuses: string[]) => statuses.map((status, i) => ({ id: `s${i}`, status: status as "Ready" }));
  it("WEB-03: first load selects all Ready sources only; non-Ready are excluded", () => {
    const model = new SelectionModel("nb-1");
    model.sync(sources(["Ready", "Processing", "Ready", "Failed"]), true);
    expect(model.ids()).toEqual(["s0", "s2"]);
    expect(model.master()).toBe("checked");
    model.toggle("s1");
    expect(model.ids()).toEqual(["s0", "s2"]);
  });
  it("WEB-04: master state checked/indeterminate/unchecked and counter label", () => {
    const model = new SelectionModel("nb-2");
    model.sync(sources(["Ready", "Ready", "Ready", "Ready", "Ready"]), true);
    model.toggle("s0");
    model.toggle("s1");
    expect(model.count()).toBe(3);
    expect(model.master()).toBe("indeterminate");
    model.setAll(false);
    expect(model.master()).toBe("unchecked");
    expect(sourcesLabel(0)).toBe("0 sources");
    expect(sourcesLabel(1)).toBe("1 source");
  });
  it("WEB-05: newly Ready sources auto-select only when imported in this session; deleted sources leave the set", () => {
    const model = new SelectionModel("nb-3");
    model.sync(sources(["Ready"]), true);
    model.markImported("s1");
    model.sync([...sources(["Ready"]), { id: "s1", status: "Ready" }, { id: "s2", status: "Ready" }]);
    expect(model.ids()).toEqual(["s0", "s1"]);
    model.sync([{ id: "s1", status: "Ready" }]);
    expect(model.ids()).toEqual(["s1"]);
  });
});

describe("layout breakpoints (FR-UI-01)", () => {
  it("WEB-06: 1023 tabs, 1024/1279 compact (Studio collapsed), 1280 desktop", () => {
    expect(breakpointFor(1023)).toBe("tabs");
    expect(breakpointFor(1024)).toBe("compact");
    expect(breakpointFor(1279)).toBe("compact");
    expect(breakpointFor(1280)).toBe("desktop");
    expect(defaultPreferences("compact")).toEqual({ left_collapsed: false, right_collapsed: true });
    expect(defaultPreferences("desktop")).toEqual({ left_collapsed: false, right_collapsed: false });
  });
});

describe("text limits (FR-WM-01, FR-GC-01)", () => {
  it("WEB-07: titles are 1–100 and messages 1–10,000 code points after trim, counting non-BMP correctly", () => {
    expect(codePointLength("🔬🔬")).toBe(2);
    expect(validateTitle("  ").ok).toBe(false);
    expect(validateTitle("🔬".repeat(100)).ok).toBe(true);
    expect(validateTitle("🔬".repeat(101)).ok).toBe(false);
    expect(validateMessage("ü".repeat(10_000)).ok).toBe(true);
    expect(validateMessage("ü".repeat(10_001)).ok).toBe(false);
  });
});

describe("inspector display spans (FR-SI-04)", () => {
  it("WEB-08: overlapping chunks map to one element per chunk start covering the whole page exactly once", () => {
    const page = { page_number: 1, text: "Intro 🧪 alpha beta gamma delta" };
    const chunks = [
      { chunk_id: "b", locator: { page_number: 1, start_offset: 14, end_offset: 30 } },
      { chunk_id: "a", locator: { page_number: 1, start_offset: 8, end_offset: 19 } },
    ];
    const spans = displaySpans(page, chunks);
    expect(spans.map((s) => s.chunkId)).toEqual([null, "a", "b"]);
    expect(spans.map((s) => s.text).join("")).toBe(page.text);
    expect(spans[1]!.text).toBe("alpha ");
  });
});
