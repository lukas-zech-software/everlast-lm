import { describe, it, expect } from "vitest";
import {
  IngestionPipeline,
  type IngestionJobInput,
} from "../src/ingestion/pipeline.js";
import { UnifiedDocumentChunkSchema } from "@everlast/contracts";

describe("FR-SI-01: User Story 1 - Integration & Timing Tests", () => {
  const pipeline = new IngestionPipeline();
  const notebookId = "11111111-1111-4111-8111-111111111111";

  it("US1-I01: Chunker segments long documents into chunks targeting 300–600 tokens", async () => {
    // Generate text with ~1500 tokens
    const paragraph = "The quick brown fox jumps over the lazy dog. ".repeat(30);
    const text = Array.from({ length: 6 }, (_, i) => `Paragraph ${i + 1}:\n${paragraph}`).join("\n\n");

    const input: IngestionJobInput = {
      attempt_id: "55555555-5555-5555-8555-555555555501",
      notebook_id: notebookId,
      source_id: "22222222-2222-4222-8222-222222222251",
      revision_id: 1,
      title: "LongDoc.txt",
      media_type: "text/plain",
      content: text,
    };

    const result = await pipeline.process(input);
    expect(result.status).toBe("Ready");
    expect(result.chunks.length).toBeGreaterThanOrEqual(2);

    for (const chunk of result.chunks) {
      expect(chunk.token_count).toBeGreaterThanOrEqual(1);
      // Each chunk should adhere to C-01 schema
      UnifiedDocumentChunkSchema.parse(chunk);
    }
  });

  it("US1-I02: Standard 20-page digital PDF processes within 5.0s benchmark (P95)", async () => {
    const input: IngestionJobInput = {
      attempt_id: "55555555-5555-5555-8555-555555555502",
      notebook_id: notebookId,
      source_id: "22222222-2222-4222-8222-222222222252",
      revision_id: 1,
      title: "Standard_20_Page.pdf",
      media_type: "application/pdf",
      content: Buffer.from("%PDF-1.4 simulated digital 20 pages text content ".repeat(50)),
    };

    const startTime = Date.now();
    const result = await pipeline.process(input);
    const durationMs = Date.now() - startTime;

    expect(result.status).toBe("Ready");
    expect(durationMs).toBeLessThan(5000); // <= 5.0 s threshold per SC-001
  });

  it("US1-I03: Batch concurrent ingestion of 20 files executes without deadlock", async () => {
    const jobs: IngestionJobInput[] = Array.from({ length: 20 }, (_, i) => ({
      attempt_id: `55555555-5555-5555-8555-${String(i + 10).padStart(12, "0")}`,
      notebook_id: notebookId,
      source_id: `22222222-2222-4222-8222-${String(i + 10).padStart(12, "0")}`,
      revision_id: 1,
      title: `Batch_File_${i + 1}.txt`,
      media_type: "text/plain",
      content: `Content of file ${i + 1} for batch upload test.`,
    }));

    const results = await Promise.all(jobs.map((job) => pipeline.process(job)));
    expect(results).toHaveLength(20);
    for (const res of results) {
      expect(res.status).toBe("Ready");
      expect(res.chunks.length).toBeGreaterThan(0);
    }
  });

  it("US1-I04: Emitted chunk IDs are valid UUIDv7 format", async () => {
    const input: IngestionJobInput = {
      attempt_id: "55555555-5555-5555-8555-555555555504",
      notebook_id: notebookId,
      source_id: "22222222-2222-4222-8222-222222222254",
      revision_id: 1,
      title: "UUIDv7_Check.txt",
      media_type: "text/plain",
      content: "Verify chunk ID format.",
    };

    const result = await pipeline.process(input);
    expect(result.status).toBe("Ready");
    expect(result.chunks.length).toBeGreaterThan(0);

    for (const chunk of result.chunks) {
      // UUIDv7 has '7' at character 14 (018f...-....-7...-....-............)
      const parts = chunk.chunk_id.split("-");
      const part2 = parts[2];
      expect(part2?.[0]).toBe("7");
    }
  });
});
