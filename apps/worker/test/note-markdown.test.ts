import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { UnifiedDocumentChunkSchema } from "@everlast/contracts";
import { createNoteMarkdownIngestor } from "../src/ingestion/note-markdown.ts";

describe("FR-SI-01, C-01, FR-NM-03: note markdown ingestion adapter", () => {
  const input = (markdown: string) => ({
    attempt_id: randomUUID(),
    notebook_id: randomUUID(),
    source_id: randomUUID(),
    revision_id: 1,
    title: "Combined notes",
    markdown,
  });

  it("produces valid C-01 chunks through the Markdown ingestion path", async () => {
    const ingestor = createNoteMarkdownIngestor();
    const i = input("# Raw data\n\nProject codename is TITAN-77.");
    const r = await ingestor.ingest(i);
    expect(r.status).toBe("Ready");
    expect(r.chunks.length).toBeGreaterThan(0);
    for (const c of r.chunks) {
      expect(UnifiedDocumentChunkSchema.safeParse(c).success).toBe(true);
      expect(c.source_id).toBe(i.source_id);
      expect(c.revision).toBe(1);
    }
    expect(r.chunks.map((c) => c.text).join(" ")).toContain("TITAN-77");
  });

  it("reports Failed for empty markdown", async () => {
    const r = await createNoteMarkdownIngestor().ingest(input("   "));
    expect(r.status).toBe("Failed");
    expect(r.chunks).toEqual([]);
  });
});
