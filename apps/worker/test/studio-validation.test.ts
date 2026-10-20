import { describe, it, expect } from "vitest";
import { validateReportPayload } from "../src/studio/runner.ts";
import { SRC_HISTORY, SRC_UNSELECTED, historyChunks, unselectedChunks } from "./studio-fixtures.ts";

const chunks = historyChunks();
const snapshot = [{ source_id: SRC_HISTORY, revision: 1 }];
const c = chunks[0]!;
const good = () => ({
  content_md: "Claim [1]",
  citations: [{ badge_number: 1, chunk_id: c.chunk_id, source_id: c.source_id, revision: 1, snippet: "Treaty of Westphalia" }],
  sections: [{ key: "report", heading: "Report" }],
});

describe("validateReportPayload (FR-014, NFR-EVAL-02, NFR-EVAL-04)", () => {
  it("accepts a fully grounded payload", () => expect(validateReportPayload(good(), chunks, snapshot)).toBeNull());
  it("rejects unknown chunk", () => {
    const p = good();
    p.citations[0]!.chunk_id = "01890000-0000-7000-8000-ffffffffffff";
    expect(validateReportPayload(p, chunks, snapshot)).toMatch(/resolve/);
  });
  it("rejects wrong revision", () => {
    const p = good();
    p.citations[0]!.revision = 2;
    expect(validateReportPayload(p, chunks, snapshot)).toMatch(/snapshot/);
  });
  it("rejects quote not in chunk", () => {
    const p = good();
    p.citations[0]!.snippet = "invented words";
    expect(validateReportPayload(p, chunks, snapshot)).toMatch(/snippet/);
  });
  it("rejects dangling marker and unreferenced citation", () => {
    expect(validateReportPayload({ ...good(), content_md: "Claim [2]" }, chunks, snapshot)).toMatch(/\[2\]/);
    expect(validateReportPayload({ ...good(), content_md: "No marker" }, chunks, snapshot)).toMatch(/not referenced/);
  });
  it("rejects a foreign-source chunk (leakage)", () => {
    const foreign = unselectedChunks()[0]!;
    const p = {
      content_md: "x [1]",
      citations: [{ badge_number: 1, chunk_id: foreign.chunk_id, source_id: SRC_UNSELECTED, revision: 1, snippet: "Zorblax" }],
      sections: [{ key: "report", heading: "Report" }],
    };
    expect(validateReportPayload(p, [...chunks, foreign], snapshot)).toMatch(/snapshot/);
  });
});
