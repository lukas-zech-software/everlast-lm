import { describe, expect, it } from "vitest";
import { chunkDocumentAnchored, extractPlainText, IngestionFailure, MSG_EMPTY } from "../src/index.ts";

/** [007] FR-NM-03, FR-SI-01, C-01, D21: the note-markdown normalizer is pure and keeps the v1 Markdown output. */
describe("note_markdown normalizer", () => {
  it("splits Markdown headings into sections and chunks never cross them", () => {
    const doc = extractPlainText(Buffer.from("# A\n\nalpha body\n\n# B\n\nbeta body"), "note_markdown");
    expect(doc.pageCount).toBe(1);
    expect(doc.pages[0]!.sections).toHaveLength(2);
    const chunks = chunkDocumentAnchored(doc, "00000000-0000-7000-8000-000000000001", 1);
    expect(chunks.map((c) => c.chunk.text)).toEqual(["# A\n\nalpha body", "# B\n\nbeta body"]);
  });

  it("parses note_markdown exactly like uploaded text/markdown", () => {
    const bytes = Buffer.from("# T\r\n\r\nline\r\n## U\r\n\r\nmore");
    expect(extractPlainText(bytes, "note_markdown")).toEqual(extractPlainText(bytes, "text/markdown"));
  });

  it("rejects empty and non-UTF-8 input with the user-visible failure", () => {
    expect(() => extractPlainText(Buffer.from("  \n"), "note_markdown")).toThrow(IngestionFailure);
    expect(() => extractPlainText(Buffer.alloc(0), "note_markdown")).toThrowError(MSG_EMPTY);
    expect(() => extractPlainText(Buffer.from([0xff, 0xfe, 0xfd]), "note_markdown")).toThrow(/password-protected or corrupted/);
  });
});
