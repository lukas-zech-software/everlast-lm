import { describe, it, expect } from "vitest";
import {
  UnifiedDocumentChunkSchema,
  PageSpanLocatorSchema,
  TimeSpanLocatorSchema,
  DomPathLocatorSchema,
  ChunkLocatorSchema,
  type UnifiedDocumentChunk,
} from "../src/document-chunk.js";

describe("Contract C-01: UnifiedDocumentChunk", () => {
  const validChunkIdV7 = "018f6b40-0001-7000-8000-000000000001";
  const validSourceIdV4 = "a1000000-0000-4000-8000-000000000001";

  const validPageSpanChunk: UnifiedDocumentChunk = {
    chunk_id: validChunkIdV7,
    source_id: validSourceIdV4,
    revision: 1,
    locator: {
      page_number: 1,
      start_offset: 0,
      end_offset: 150,
    },
    token_count: 42,
    text: "This is a valid extracted document chunk text.",
  };

  it("C01-01: accepts valid chunk with page_span locator", () => {
    const parsed = UnifiedDocumentChunkSchema.parse(validPageSpanChunk);
    expect(parsed).toEqual(validPageSpanChunk);
  });

  it("C01-02: accepts valid chunk with time_span locator", () => {
    const timeSpanChunk = {
      ...validPageSpanChunk,
      locator: {
        start_ms: 1000,
        end_ms: 5000,
      },
    };
    const parsed = UnifiedDocumentChunkSchema.parse(timeSpanChunk);
    expect(parsed.locator).toEqual({ start_ms: 1000, end_ms: 5000 });
  });

  it("C01-03: accepts valid chunk with dom_path locator", () => {
    const domPathChunk = {
      ...validPageSpanChunk,
      locator: {
        selector: "article > section#sec-1 > p:first-child",
        start_offset: 10,
        end_offset: 200,
      },
    };
    const parsed = UnifiedDocumentChunkSchema.parse(domPathChunk);
    expect(parsed.locator).toEqual({
      selector: "article > section#sec-1 > p:first-child",
      start_offset: 10,
      end_offset: 200,
    });
  });

  it("C01-04: accepts page_span with optional physical_page", () => {
    const chunkWithPhysicalPage = {
      ...validPageSpanChunk,
      locator: {
        page_number: 3,
        physical_page: 5,
        start_offset: 0,
        end_offset: 100,
      },
    };
    const parsed = UnifiedDocumentChunkSchema.parse(chunkWithPhysicalPage);
    expect(parsed.locator).toMatchObject({
      page_number: 3,
      physical_page: 5,
      start_offset: 0,
      end_offset: 100,
    });
  });

  it("C01-05: rejects non-UUIDv7 chunk_id", () => {
    // UUID v4 format (has '4' in version position, not '7')
    const v4Chunk = {
      ...validPageSpanChunk,
      chunk_id: "a1111111-1111-4111-8111-111111111111",
    };
    expect(() => UnifiedDocumentChunkSchema.parse(v4Chunk)).toThrow(/v7|UUID/i);
  });

  it("C01-06: rejects invalid source_id", () => {
    const invalidSourceChunk = {
      ...validPageSpanChunk,
      source_id: "not-a-valid-uuid",
    };
    expect(() => UnifiedDocumentChunkSchema.parse(invalidSourceChunk)).toThrow();
  });

  it("C01-07: rejects non-positive revision", () => {
    expect(() =>
      UnifiedDocumentChunkSchema.parse({ ...validPageSpanChunk, revision: 0 })
    ).toThrow();
    expect(() =>
      UnifiedDocumentChunkSchema.parse({ ...validPageSpanChunk, revision: -1 })
    ).toThrow();
    expect(() =>
      UnifiedDocumentChunkSchema.parse({ ...validPageSpanChunk, revision: 1.5 })
    ).toThrow();
  });

  it("C01-08: rejects negative token_count", () => {
    expect(() =>
      UnifiedDocumentChunkSchema.parse({ ...validPageSpanChunk, token_count: -1 })
    ).toThrow();
    expect(() =>
      UnifiedDocumentChunkSchema.parse({ ...validPageSpanChunk, token_count: 3.5 })
    ).toThrow();
  });

  it("C01-09: rejects empty or whitespace-only text", () => {
    expect(() =>
      UnifiedDocumentChunkSchema.parse({ ...validPageSpanChunk, text: "" })
    ).toThrow();
  });

  it("C01-10: rejects extra unknown fields on C-01 chunk (strict 5-field projection)", () => {
    const extraFieldChunk = {
      ...validPageSpanChunk,
      extra_metadata: "forbidden extra field",
    };
    expect(() => UnifiedDocumentChunkSchema.parse(extraFieldChunk)).toThrow();
  });

  it("C01-11: rejects unknown locator variants like char_span or slide_number", () => {
    const charSpanChunk = {
      ...validPageSpanChunk,
      locator: {
        char_span: [0, 100],
      },
    };
    expect(() => UnifiedDocumentChunkSchema.parse(charSpanChunk)).toThrow();

    const slideNumberChunk = {
      ...validPageSpanChunk,
      locator: {
        slide_number: 5,
      },
    };
    expect(() => UnifiedDocumentChunkSchema.parse(slideNumberChunk)).toThrow();
  });

  it("C01-12: rejects page_span where end_offset < start_offset", () => {
    const invertedOffsets = {
      page_number: 1,
      start_offset: 150,
      end_offset: 50,
    };
    expect(() => PageSpanLocatorSchema.parse(invertedOffsets)).toThrow();
  });

  it("C01-13: rejects page_span with negative start_offset or non-positive page_number", () => {
    expect(() =>
      PageSpanLocatorSchema.parse({ page_number: 0, start_offset: 0, end_offset: 10 })
    ).toThrow();
    expect(() =>
      PageSpanLocatorSchema.parse({ page_number: 1, start_offset: -5, end_offset: 10 })
    ).toThrow();
  });

  it("C01-14: rejects time_span where end_ms < start_ms or negative start_ms", () => {
    expect(() =>
      TimeSpanLocatorSchema.parse({ start_ms: 5000, end_ms: 1000 })
    ).toThrow();
    expect(() =>
      TimeSpanLocatorSchema.parse({ start_ms: -10, end_ms: 1000 })
    ).toThrow();
  });

  it("C01-15: rejects dom_path where end_offset < start_offset or selector is empty", () => {
    expect(() =>
      DomPathLocatorSchema.parse({ selector: "", start_offset: 0, end_offset: 100 })
    ).toThrow();
    expect(() =>
      DomPathLocatorSchema.parse({ selector: "div", start_offset: 100, end_offset: 50 })
    ).toThrow();
  });

  it("C01-16: rejects extra unknown fields in locators (strict locator schema)", () => {
    const extraLocator = {
      page_number: 1,
      start_offset: 0,
      end_offset: 100,
      unknown_field: true,
    };
    expect(() => PageSpanLocatorSchema.parse(extraLocator)).toThrow();
    expect(() => ChunkLocatorSchema.parse(extraLocator)).toThrow();
  });
});
