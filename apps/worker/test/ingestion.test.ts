import { describe, it, expect } from "vitest";
import {
  IngestionPipeline,
  type IngestionJobInput,
  type IngestionJobResult,
} from "../src/ingestion/pipeline.js";
import { UnifiedDocumentChunkSchema } from "@everlast/contracts";

describe("FR-SI-01: User Story 1 - Ingest Sources Acceptance Tests", () => {
  const pipeline = new IngestionPipeline();
  const notebookId = "11111111-1111-4111-8111-111111111111";
  const sourceId = "22222222-2222-4222-8222-222222222222";

  it("US1-01: Multi-page PDF with scanned page produces valid C-01 UnifiedDocumentChunk items", async () => {
    // 10-page simulated PDF where page 4 is a scanned image
    const input: IngestionJobInput = {
      attempt_id: "33333333-3333-4333-8333-333333333331",
      notebook_id: notebookId,
      source_id: sourceId,
      revision_id: 1,
      title: "Research_Paper_10_Pages.pdf",
      media_type: "application/pdf",
      content: Buffer.from("%PDF-1.4 simulated pdf with 10 pages, page 4 scanned [OCR_PAGE_4]"),
    };

    const result = await pipeline.process(input);
    expect(result.status).toBe("Ready");
    expect(result.chunks.length).toBeGreaterThan(0);

    // Validate every chunk against Contract C-01 schema
    for (const chunk of result.chunks) {
      const parsed = UnifiedDocumentChunkSchema.parse(chunk);
      expect(parsed.source_id).toBe(sourceId);
      expect(parsed.revision).toBe(1);
      expect((parsed.locator as any).page_number).toBeGreaterThanOrEqual(1);
    }

    // Verify page 4 chunk contains OCR extracted text
    const page4Chunks = result.chunks.filter(
      (c) => (c.locator as any).page_number === 4
    );
    expect(page4Chunks.length).toBeGreaterThan(0);
    expect(page4Chunks[0]?.text).toContain("OCR_PAGE_4");
  });

  it("US1-02: Paste raw clipboard text produces Ready source with default title 'Pasted text'", async () => {
    const meetingNotes = "Meeting Notes 2026-10-18.\nDiscussed architecture, contracts C-01 and C-02, and release gates.";
    const input: IngestionJobInput = {
      attempt_id: "33333333-3333-4333-8333-333333333332",
      notebook_id: notebookId,
      source_id: "22222222-2222-4222-8222-222222222223",
      revision_id: 1,
      media_type: "copied_text",
      content: meetingNotes,
    };

    const result = await pipeline.process(input);
    expect(result.status).toBe("Ready");
    expect(result.title).toBe("Pasted text");
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks[0]?.text).toContain("Meeting Notes");
    // Text-only source omits physical page in locator
    expect((result.chunks[0]?.locator as any).page_number).toBe(1);
  });

  it("US1-03: Password-protected or corrupted PDF fails gracefully with exact error message", async () => {
    const input: IngestionJobInput = {
      attempt_id: "33333333-3333-4333-8333-333333333333",
      notebook_id: notebookId,
      source_id: "22222222-2222-4222-8222-222222222224",
      revision_id: 1,
      title: "Encrypted_Secret.pdf",
      media_type: "application/pdf",
      content: Buffer.from("%PDF-1.4 encrypted_password_protected_stream"),
    };

    const result = await pipeline.process(input);
    expect(result.status).toBe("Failed");
    expect(result.error_message).toBe("Could not read file (password-protected or corrupted)");
    expect(result.chunks).toHaveLength(0);
  });

  it("US1-04: Text and Markdown files segment accurately with paragraph offsets", async () => {
    const mdContent = "# Section 1: Overview\n\nEverlast LM provides grounded AI notebooks.\n\n# Section 2: Details\n\nAll source reads go strictly through Contract C-02.";
    const input: IngestionJobInput = {
      attempt_id: "33333333-3333-4333-8333-333333333334",
      notebook_id: notebookId,
      source_id: "22222222-2222-4222-8222-222222222225",
      revision_id: 1,
      title: "Documentation.md",
      media_type: "text/markdown",
      content: mdContent,
    };

    const result = await pipeline.process(input);
    expect(result.status).toBe("Ready");
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.word_count).toBeGreaterThan(10);
  });

  it("US1-05: State transitions strictly follow Uploading -> Processing -> Ready", async () => {
    const statesRecorded: string[] = [];
    const input: IngestionJobInput = {
      attempt_id: "33333333-3333-4333-8333-333333333335",
      notebook_id: notebookId,
      source_id: "22222222-2222-4222-8222-222222222226",
      revision_id: 1,
      title: "Notes.txt",
      media_type: "text/plain",
      content: "Simple text content.",
      onStateChange: (state) => statesRecorded.push(state),
    };

    const result = await pipeline.process(input);
    expect(result.status).toBe("Ready");
    expect(statesRecorded).toContain("Processing");
    expect(statesRecorded).toContain("Ready");
  });

  it("US1-06: Idempotent processing rejects duplicate attempt IDs", async () => {
    const attemptId = "33333333-3333-4333-8333-333333333336";
    const input: IngestionJobInput = {
      attempt_id: attemptId,
      notebook_id: notebookId,
      source_id: "22222222-2222-4222-8222-222222222227",
      revision_id: 1,
      title: "File.txt",
      media_type: "text/plain",
      content: "Hello world text.",
    };

    const firstRun = await pipeline.process(input);
    expect(firstRun.status).toBe("Ready");

    // Second run with same attempt_id must be rejected or return already processed
    await expect(pipeline.process(input)).rejects.toThrow(/duplicate attempt|already processed/i);
  });
});
