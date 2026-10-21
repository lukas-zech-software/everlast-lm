import { describe, it, expect } from "vitest";
import {
  NotebookSchema,
  CreateNotebookInputSchema,
  UpdateNotebookInputSchema,
  DEFAULT_NOTEBOOK_TITLE,
  type Notebook,
} from "../src/workspace.ts";
import {
  normalizeNotebookTitle,
  validateNotebookTitle,
} from "../src/text-limits.ts";

describe("FR-WM-01: Workspace and Notebook Contracts", () => {
  const validNotebookIdV4 = "a1111111-1111-4111-8111-111111111111";
  const validOwnerId = "usr_subject_alpha_123";

  const validNotebook: Notebook = {
    id: validNotebookIdV4,
    owner_id: validOwnerId,
    title: "My Research Notebook",
    created_at: "2026-10-18T12:00:00.000Z",
    updated_at: "2026-10-18T12:00:00.000Z",
  };

  it("WS-01: accepts valid notebook entity", () => {
    const parsed = NotebookSchema.parse(validNotebook);
    expect(parsed).toEqual(validNotebook);
  });

  it("WS-02: rejects notebook with non-UUIDv4 id", () => {
    // Non-v4 UUID (has '7' in version position instead of '4')
    const nonV4Notebook = {
      ...validNotebook,
      id: "018f6b40-0001-7000-8000-000000000001",
    };
    expect(() => NotebookSchema.parse(nonV4Notebook)).toThrow(/v4|UUID/i);

    const invalidUuid = {
      ...validNotebook,
      id: "invalid-id-string",
    };
    expect(() => NotebookSchema.parse(invalidUuid)).toThrow();
  });

  it("WS-03: rejects notebook with invalid UTC ISO timestamps", () => {
    expect(() =>
      NotebookSchema.parse({ ...validNotebook, created_at: "2026-10-18 12:00:00" })
    ).toThrow();
    expect(() =>
      NotebookSchema.parse({ ...validNotebook, updated_at: "not-a-timestamp" })
    ).toThrow();
  });

  it("WS-04: rejects extra unknown fields on Notebook (strict schema)", () => {
    const extraField = {
      ...validNotebook,
      unexpected_prop: 123,
    };
    expect(() => NotebookSchema.parse(extraField)).toThrow();
  });

  describe("Title Code Point Constraints (1–100 Unicode code points)", () => {
    it("WS-05: rejects 0 code points after outer trim (empty or whitespace)", () => {
      expect(() => NotebookSchema.parse({ ...validNotebook, title: "" })).toThrow();
      expect(() => NotebookSchema.parse({ ...validNotebook, title: "   " })).toThrow();
      expect(validateNotebookTitle("").valid).toBe(false);
      expect(validateNotebookTitle("   ").valid).toBe(false);
    });

    it("WS-06: accepts 1 code point title including single emoji", () => {
      const singleChar = NotebookSchema.parse({ ...validNotebook, title: "A" });
      expect(singleChar.title).toBe("A");

      const singleEmoji = NotebookSchema.parse({ ...validNotebook, title: "🔬" });
      expect(singleEmoji.title).toBe("🔬");

      expect(validateNotebookTitle("🔬")).toEqual({
        valid: true,
        codePoints: 1,
        normalized: "🔬",
      });
    });

    it("WS-07: accepts exactly 100 code points including multi-byte characters and emoji", () => {
      // 90 ASCII chars + 10 emoji = 100 code points
      const title100 = "A".repeat(90) + "🔬".repeat(10);
      expect(Array.from(title100).length).toBe(100);

      const parsed = NotebookSchema.parse({ ...validNotebook, title: title100 });
      expect(parsed.title).toBe(title100);

      const result = validateNotebookTitle(title100);
      expect(result.valid).toBe(true);
      expect(result.codePoints).toBe(100);
    });

    it("WS-08: rejects 101 code points", () => {
      // 101 code points
      const title101 = "A".repeat(101);
      expect(Array.from(title101).length).toBe(101);

      expect(() => NotebookSchema.parse({ ...validNotebook, title: title101 })).toThrow();

      const result = validateNotebookTitle(title101);
      expect(result.valid).toBe(false);
      expect(result.codePoints).toBe(101);
    });

    it("WS-09: normalizeNotebookTitle defaults empty or whitespace input to 'Untitled notebook'", () => {
      expect(normalizeNotebookTitle("")).toBe(DEFAULT_NOTEBOOK_TITLE);
      expect(normalizeNotebookTitle("   ")).toBe(DEFAULT_NOTEBOOK_TITLE);
      expect(normalizeNotebookTitle(undefined)).toBe(DEFAULT_NOTEBOOK_TITLE);
      expect(normalizeNotebookTitle(null)).toBe(DEFAULT_NOTEBOOK_TITLE);
    });

    it("WS-10: normalizeNotebookTitle trims outer whitespace while preserving internal content", () => {
      expect(normalizeNotebookTitle("  Deep Learning & AI 🚀  ")).toBe("Deep Learning & AI 🚀");
    });

    it("WS-11: validateNotebookTitle returns error for over-limit titles without silently truncating", () => {
      const longTitle = "B".repeat(105);
      const res = validateNotebookTitle(longTitle);
      expect(res.valid).toBe(false);
      expect(res.codePoints).toBe(105);
      expect(res.error).toBeDefined();
    });

    it("WS-12: code point counting counts surrogate pairs as 1 code point, not 2", () => {
      const emoji = "🚀";
      // UTF-16 code units (JS length) is 2
      expect(emoji.length).toBe(2);
      // Code points must be 1
      const res = validateNotebookTitle(emoji);
      expect(res.codePoints).toBe(1);
      expect(res.valid).toBe(true);
    });
  });
});
