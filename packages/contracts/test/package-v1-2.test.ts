import { describe, it, expect } from "vitest";
import {
  SourceSchema,
  SourceMediaTypeSchema,
  SourceStatusSchema,
  CopiedTextInputSchema,
  ActiveSourceSelectionSchema,
  SourceInspectorQuerySchema,
  type Source,
  type CopiedTextInput,
  type ActiveSourceSelection,
  type SourceInspectorQuery,
} from "../src/package-v1-2.js";

describe("Package 1.2 Contracts: Text/PDF Ingestion & Inspector", () => {
  const validSourceId = "11111111-1111-4111-8111-111111111111";
  const validNotebookId = "22222222-2222-4222-8222-222222222222";
  const validAttemptId = "33333333-3333-4333-8333-333333333333";
  const validChunkId = "018f6b40-0001-7000-8000-000000000001";

  const validSource: Source = {
    id: validSourceId,
    notebook_id: validNotebookId,
    title: "Quantum Computing Overview.pdf",
    media_type: "application/pdf",
    status: "Ready",
    byte_size: 15_000_000,
    word_count: 45_000,
    revision_id: 1,
    attempt_id: validAttemptId,
    created_at: "2026-10-18T12:00:00.000Z",
    updated_at: "2026-10-18T12:00:05.000Z",
  };

  describe("Source Entity Contract (FR-SI-01, C-01, Gate v1.0)", () => {
    it("PKG12-01: accepts valid Source entity with all valid fields", () => {
      const parsed = SourceSchema.parse(validSource);
      expect(parsed).toEqual(validSource);
    });

    it("PKG12-02: accepts all valid media types and statuses", () => {
      const mediaTypes = ["application/pdf", "text/plain", "text/markdown", "copied_text"] as const;
      for (const mt of mediaTypes) {
        expect(SourceMediaTypeSchema.parse(mt)).toBe(mt);
        const parsed = SourceSchema.parse({ ...validSource, media_type: mt });
        expect(parsed.media_type).toBe(mt);
      }

      const statuses = ["Uploading", "Processing", "Ready", "Failed"] as const;
      for (const st of statuses) {
        expect(SourceStatusSchema.parse(st)).toBe(st);
        const parsed = SourceSchema.parse({ ...validSource, status: st });
        expect(parsed.status).toBe(st);
      }
    });

    it("PKG12-03: accepts exact boundary values: 0 and 200MB byte_size, 0 and 500,000 words", () => {
      // 200 MB = 200,000,000 bytes per Constitution II
      const minBounds = SourceSchema.parse({
        ...validSource,
        byte_size: 0,
        word_count: 0,
      });
      expect(minBounds.byte_size).toBe(0);
      expect(minBounds.word_count).toBe(0);

      const maxBounds = SourceSchema.parse({
        ...validSource,
        byte_size: 200_000_000,
        word_count: 500_000,
      });
      expect(maxBounds.byte_size).toBe(200_000_000);
      expect(maxBounds.word_count).toBe(500_000);
    });

    it("PKG12-04: rejects byte_size > 200,000,000 (Constitution II: 200MB = 200,000,000 bytes)", () => {
      expect(() =>
        SourceSchema.parse({ ...validSource, byte_size: 200_000_001 })
      ).toThrow();
    });

    it("PKG12-05: rejects negative or non-integer byte_size", () => {
      expect(() => SourceSchema.parse({ ...validSource, byte_size: -1 })).toThrow();
      expect(() => SourceSchema.parse({ ...validSource, byte_size: 1024.5 })).toThrow();
    });

    it("PKG12-06: rejects word_count > 500,000", () => {
      expect(() =>
        SourceSchema.parse({ ...validSource, word_count: 500_001 })
      ).toThrow();
    });

    it("PKG12-07: rejects negative or non-integer word_count", () => {
      expect(() => SourceSchema.parse({ ...validSource, word_count: -1 })).toThrow();
      expect(() => SourceSchema.parse({ ...validSource, word_count: 100.5 })).toThrow();
    });

    it("PKG12-08: rejects non-positive revision_id", () => {
      expect(() => SourceSchema.parse({ ...validSource, revision_id: 0 })).toThrow();
      expect(() => SourceSchema.parse({ ...validSource, revision_id: -1 })).toThrow();
      expect(() => SourceSchema.parse({ ...validSource, revision_id: 1.5 })).toThrow();
    });

    it("PKG12-09: rejects invalid UUID for id, notebook_id, or attempt_id", () => {
      expect(() => SourceSchema.parse({ ...validSource, id: "invalid-uuid" })).toThrow();
      expect(() => SourceSchema.parse({ ...validSource, notebook_id: "not-a-uuid" })).toThrow();
      expect(() => SourceSchema.parse({ ...validSource, attempt_id: "12345" })).toThrow();
    });

    it("PKG12-10: rejects title with 0 code points after outer trim (empty or whitespace)", () => {
      expect(() => SourceSchema.parse({ ...validSource, title: "" })).toThrow();
      expect(() => SourceSchema.parse({ ...validSource, title: "   " })).toThrow();
    });

    it("PKG12-11: accepts title with 100 Unicode code points (including multi-byte emoji)", () => {
      // 90 ASCII chars + 10 emoji = 100 code points
      const title100 = "A".repeat(90) + "🔬".repeat(10);
      expect(Array.from(title100).length).toBe(100);
      const parsed = SourceSchema.parse({ ...validSource, title: title100 });
      expect(parsed.title).toBe(title100);
    });

    it("PKG12-12: rejects title with > 100 Unicode code points", () => {
      const title101 = "A".repeat(101);
      expect(() => SourceSchema.parse({ ...validSource, title: title101 })).toThrow();
    });

    it("PKG12-13: rejects unknown media_type or unknown status", () => {
      expect(() =>
        SourceSchema.parse({ ...validSource, media_type: "application/msword" as any })
      ).toThrow();
      expect(() =>
        SourceSchema.parse({ ...validSource, status: "Archived" as any })
      ).toThrow();
    });

    it("PKG12-14: rejects extra unknown fields on Source (strict schema)", () => {
      const withExtra = { ...validSource, unexpected_extra_field: "disallowed" };
      expect(() => SourceSchema.parse(withExtra)).toThrow();
    });
  });

  describe("CopiedTextInput Contract (FR-SI-01, Copied text sub-dialog)", () => {
    it("PKG12-15: accepts valid CopiedTextInput with explicit title and valid text", () => {
      const input: CopiedTextInput = {
        text: "Here is some research notes copied from a paper.",
        title: "Paper Notes",
      };
      const parsed = CopiedTextInputSchema.parse(input);
      expect(parsed.text).toBe(input.text);
      expect(parsed.title).toBe("Paper Notes");
    });

    it("PKG12-16: defaults title to 'Pasted text' when title is omitted or undefined", () => {
      const parsed = CopiedTextInputSchema.parse({
        text: "Sample pasted content without title.",
      });
      expect(parsed.title).toBe("Pasted text");
      expect(parsed.text).toBe("Sample pasted content without title.");
    });

    it("PKG12-17: rejects empty or whitespace-only text (0 code points after outer trim)", () => {
      expect(() => CopiedTextInputSchema.parse({ text: "" })).toThrow();
      expect(() => CopiedTextInputSchema.parse({ text: "   \n\t  " })).toThrow();
    });

    it("PKG12-18: rejects text exceeding 500,000 words", () => {
      // 500,001 words
      const words500001 = "word ".repeat(500_001);
      expect(() => CopiedTextInputSchema.parse({ text: words500001 })).toThrow();
    });

    it("PKG12-19: accepts text up to 500,000 words and 1 char text", () => {
      const singleChar = CopiedTextInputSchema.parse({ text: "A" });
      expect(singleChar.text).toBe("A");

      const words10 = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
      const parsed = CopiedTextInputSchema.parse({ text: words10 });
      expect(parsed.text).toBe(words10);
    });

    it("PKG12-20: rejects title > 100 code points or whitespace-only title when provided", () => {
      expect(() =>
        CopiedTextInputSchema.parse({ text: "Content", title: "   " })
      ).toThrow();
      expect(() =>
        CopiedTextInputSchema.parse({ text: "Content", title: "A".repeat(101) })
      ).toThrow();
    });

    it("PKG12-21: rejects extra unknown fields on CopiedTextInput (strict schema)", () => {
      expect(() =>
        CopiedTextInputSchema.parse({
          text: "Content",
          extra_param: 123,
        })
      ).toThrow();
    });
  });

  describe("ActiveSourceSelection Contract (FR-SI-03, C-02)", () => {
    it("PKG12-22: accepts valid ActiveSourceSelection with empty and non-empty array", () => {
      const emptySelection: ActiveSourceSelection = {
        notebook_id: validNotebookId,
        active_source_ids: [],
      };
      expect(ActiveSourceSelectionSchema.parse(emptySelection)).toEqual(emptySelection);

      const multiSelection: ActiveSourceSelection = {
        notebook_id: validNotebookId,
        active_source_ids: [validSourceId, "44444444-4444-4444-8444-444444444444"],
      };
      expect(ActiveSourceSelectionSchema.parse(multiSelection)).toEqual(multiSelection);
    });

    it("PKG12-23: rejects non-UUID entries in active_source_ids", () => {
      expect(() =>
        ActiveSourceSelectionSchema.parse({
          notebook_id: validNotebookId,
          active_source_ids: ["not-a-uuid"],
        })
      ).toThrow();
    });

    it("PKG12-24: rejects non-UUID notebook_id", () => {
      expect(() =>
        ActiveSourceSelectionSchema.parse({
          notebook_id: "invalid-notebook-id",
          active_source_ids: [],
        })
      ).toThrow();
    });

    it("PKG12-25: rejects extra unknown fields on ActiveSourceSelection (strict schema)", () => {
      expect(() =>
        ActiveSourceSelectionSchema.parse({
          notebook_id: validNotebookId,
          active_source_ids: [],
          unauthorized_override: true,
        })
      ).toThrow();
    });
  });

  describe("SourceInspectorQuery Contract (FR-SI-04, C-02)", () => {
    it("PKG12-26: accepts SourceInspectorQuery with valid source_id and null/omitted highlight_chunk_id", () => {
      const query1 = { source_id: validSourceId };
      const parsed1 = SourceInspectorQuerySchema.parse(query1);
      expect(parsed1.source_id).toBe(validSourceId);

      const query2 = { source_id: validSourceId, highlight_chunk_id: null };
      const parsed2 = SourceInspectorQuerySchema.parse(query2);
      expect(parsed2.source_id).toBe(validSourceId);
      expect(parsed2.highlight_chunk_id).toBeNull();
    });

    it("PKG12-27: accepts SourceInspectorQuery with valid source_id and valid highlight_chunk_id", () => {
      const query: SourceInspectorQuery = {
        source_id: validSourceId,
        highlight_chunk_id: validChunkId,
      };
      const parsed = SourceInspectorQuerySchema.parse(query);
      expect(parsed.source_id).toBe(validSourceId);
      expect(parsed.highlight_chunk_id).toBe(validChunkId);
    });

    it("PKG12-28: rejects non-UUID source_id or invalid highlight_chunk_id", () => {
      expect(() =>
        SourceInspectorQuerySchema.parse({ source_id: "invalid-source-id" })
      ).toThrow();

      expect(() =>
        SourceInspectorQuerySchema.parse({
          source_id: validSourceId,
          highlight_chunk_id: "not-a-valid-uuid",
        })
      ).toThrow();
    });

    it("PKG12-29: rejects extra unknown fields on SourceInspectorQuery (strict schema)", () => {
      expect(() =>
        SourceInspectorQuerySchema.parse({
          source_id: validSourceId,
          extra_filter: "disallowed",
        })
      ).toThrow();
    });
  });
});
