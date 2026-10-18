import { describe, it, expect } from "vitest";
import {
  IngestionPipeline,
  type IngestionJobInput,
} from "../src/ingestion/pipeline.js";

describe("FR-SI-01: User Story 1 - Boundary & Error Tests", () => {
  const pipeline = new IngestionPipeline();
  const notebookId = "11111111-1111-4111-8111-111111111111";

  it("US1-B01: Rejects empty .txt or .md file (0 bytes) with exact message 'File is empty'", async () => {
    const input: IngestionJobInput = {
      attempt_id: "44444444-4444-4444-8444-444444444401",
      notebook_id: notebookId,
      source_id: "22222222-2222-4222-8222-222222222231",
      revision_id: 1,
      title: "empty.txt",
      media_type: "text/plain",
      content: "",
    };

    const result = await pipeline.process(input);
    expect(result.status).toBe("Failed");
    expect(result.error_message).toBe("File is empty");
  });

  it("US1-B02: Rejects whitespace-only file with exact message 'File is empty'", async () => {
    const input: IngestionJobInput = {
      attempt_id: "44444444-4444-4444-8444-444444444402",
      notebook_id: notebookId,
      source_id: "22222222-2222-4222-8222-222222222232",
      revision_id: 1,
      title: "whitespace.md",
      media_type: "text/markdown",
      content: "   \n\t  \r\n   ",
    };

    const result = await pipeline.process(input);
    expect(result.status).toBe("Failed");
    expect(result.error_message).toBe("File is empty");
  });

  it("US1-B03: Rejects vector graphics PDF with zero extractable text with 'No extractable text found'", async () => {
    const input: IngestionJobInput = {
      attempt_id: "44444444-4444-4444-8444-444444444403",
      notebook_id: notebookId,
      source_id: "22222222-2222-4222-8222-222222222233",
      revision_id: 1,
      title: "vector_graphics_only.pdf",
      media_type: "application/pdf",
      content: Buffer.from("%PDF-1.4 [ZERO_EXTRACTABLE_TEXT_VECTOR_GRAPHICS]"),
    };

    const result = await pipeline.process(input);
    expect(result.status).toBe("Failed");
    expect(result.error_message).toBe("No extractable text found");
  });

  it("US1-B04: Accepts file at exact 200 MB limit (200,000,000 bytes)", async () => {
    const input: IngestionJobInput = {
      attempt_id: "44444444-4444-4444-8444-444444444404",
      notebook_id: notebookId,
      source_id: "22222222-2222-4222-8222-222222222234",
      revision_id: 1,
      title: "large_max_size.txt",
      media_type: "text/plain",
      content: "valid text content",
      byte_size_override: 200_000_000,
    };

    const result = await pipeline.process(input);
    expect(result.status).toBe("Ready");
    expect(result.byte_size).toBe(200_000_000);
  });

  it("US1-B05: Rejects file exceeding 200 MB limit by 1 byte (200,000,001 bytes)", async () => {
    const input: IngestionJobInput = {
      attempt_id: "44444444-4444-4444-8444-444444444405",
      notebook_id: notebookId,
      source_id: "22222222-2222-4222-8222-222222222235",
      revision_id: 1,
      title: "oversized.txt",
      media_type: "text/plain",
      content: "oversized content",
      byte_size_override: 200_000_001,
    };

    const result = await pipeline.process(input);
    expect(result.status).toBe("Failed");
    expect(result.error_message).toMatch(/exceeds 200 MB limit/i);
  });

  it("US1-B06: Accepts source with exact 500,000 extracted words", async () => {
    const input: IngestionJobInput = {
      attempt_id: "44444444-4444-4444-8444-444444444406",
      notebook_id: notebookId,
      source_id: "22222222-2222-4222-8222-222222222236",
      revision_id: 1,
      title: "words_500k.txt",
      media_type: "text/plain",
      content: "content",
      word_count_override: 500_000,
    };

    const result = await pipeline.process(input);
    expect(result.status).toBe("Ready");
    expect(result.word_count).toBe(500_000);
  });

  it("US1-B07: Rejects source exceeding 500,000 extracted words", async () => {
    const input: IngestionJobInput = {
      attempt_id: "44444444-4444-4444-8444-444444444407",
      notebook_id: notebookId,
      source_id: "22222222-2222-4222-8222-222222222237",
      revision_id: 1,
      title: "words_500001.txt",
      media_type: "text/plain",
      content: "content",
      word_count_override: 500_001,
    };

    const result = await pipeline.process(input);
    expect(result.status).toBe("Failed");
    expect(result.error_message).toMatch(/exceeds 500,000 words limit/i);
  });

  it("US1-B08: Copied text accepts 1 character after outer trim", async () => {
    const input: IngestionJobInput = {
      attempt_id: "44444444-4444-4444-8444-444444444408",
      notebook_id: notebookId,
      source_id: "22222222-2222-4222-8222-222222222238",
      revision_id: 1,
      media_type: "copied_text",
      content: "  Z  ",
    };

    const result = await pipeline.process(input);
    expect(result.status).toBe("Ready");
    expect(result.chunks[0]?.text).toBe("Z");
  });

  it("US1-B09: Copied text rejects 0 characters after outer trim", async () => {
    const input: IngestionJobInput = {
      attempt_id: "44444444-4444-4444-8444-444444444409",
      notebook_id: notebookId,
      source_id: "22222222-2222-4222-8222-222222222239",
      revision_id: 1,
      media_type: "copied_text",
      content: "     ",
    };

    const result = await pipeline.process(input);
    expect(result.status).toBe("Failed");
    expect(result.error_message).toBe("File is empty");
  });
});
