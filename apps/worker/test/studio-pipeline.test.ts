import { describe, it, expect } from "vitest";
import type { ReportSubtype } from "@everlast/contracts";
import { generateReport } from "../src/studio/reports/pipeline.ts";
import { DeterministicReportModel } from "../src/studio/reports/deterministic-model.ts";
import type { ReportModelClient } from "../src/studio/reports/model.ts";
import { validateReportPayload } from "../src/studio/runner.ts";
import {
  SRC_HISTORY,
  SRC_NODATES,
  SRC_TECH,
  historyChunks,
  makeChunk,
  noDateChunks,
  techChunks,
} from "./studio-fixtures.ts";

const chunks = [...historyChunks(), ...techChunks()];
const snapshot = [SRC_HISTORY, SRC_TECH].map((source_id) => ({ source_id, revision: 1 }));
const run = (subtype: ReportSubtype, cs = chunks, model: ReportModelClient = new DeterministicReportModel(), custom_prompt?: string) =>
  generateReport({ subtype, chunks: cs, model, custom_prompt, signal: new AbortController().signal, reportProgress: () => undefined });

describe("generateReport per template (FR-ST-10)", () => {
  it("Briefing doc: executive summary, key points and verbatim quotes, all citation-valid", async () => {
    const out = await run("briefing_doc");
    if (out.status !== "completed") throw new Error("refused");
    expect(out.payload.content_md).toMatch(/## Executive Summary/);
    expect(out.payload.content_md).toMatch(/## Key Quotes/);
    expect(out.payload.content_md).toContain("> The Treaty of Westphalia was signed in 1648");
    expect(validateReportPayload(out.payload, chunks, snapshot)).toBeNull();
  });
  it("Study guide: glossary, short-answer quiz with answer key, essay questions", async () => {
    const out = await run("study_guide");
    if (out.status !== "completed") throw new Error("refused");
    const md = out.payload.content_md;
    expect(md).toMatch(/## Glossary/);
    expect(md).toMatch(/hash function/i);
    expect(md).toMatch(/## Short-Answer Quiz/);
    expect(md).toMatch(/Answer:/);
    expect(md).toMatch(/## Essay Questions/);
    expect(validateReportPayload(out.payload, chunks, snapshot)).toBeNull();
  });
  it("FAQ yields at least one cited question/answer pair", async () => {
    const out = await run("faq");
    if (out.status !== "completed") throw new Error("refused");
    expect(out.payload.content_md).toMatch(/\*\*Q: /);
    expect(validateReportPayload(out.payload, chunks, snapshot)).toBeNull();
  });
  it("Timeline: chronological events plus Cast of Characters", async () => {
    const out = await run("timeline");
    if (out.status !== "completed") throw new Error("refused");
    const md = out.payload.content_md;
    expect(md.indexOf("1648")).toBeGreaterThan(-1);
    expect(md.indexOf("1648")).toBeLessThan(md.indexOf("1815"));
    expect(md).toMatch(/## Cast of Characters/);
    expect(md).toContain("Axel Oxenstierna");
  });
  it("Timeline without dates says so and invents none", async () => {
    const nd = noDateChunks();
    const out = await run("timeline", nd);
    if (out.status !== "completed") throw new Error("refused");
    expect(out.payload.content_md).toMatch(/No dates were found/);
    expect(out.payload.content_md).not.toMatch(/\b1[0-9]{3}\b|\b20[0-9]{2}\b/);
    expect(out.payload.content_md).toContain("Alice Johnson");
    expect(nd[0]!.source_id).toBe(SRC_NODATES);
  });
  it("refuses with InsufficientEvidence when no core content is supported", async () => {
    const out = await run("faq", [makeChunk(SRC_HISTORY, "   ")]);
    expect(out).toMatchObject({ status: "refused", code: "InsufficientEvidence" });
    const empty = await run("briefing_doc", []);
    expect(empty).toMatchObject({ status: "refused", code: "InsufficientEvidence" });
  });
  it("processes every scoped chunk via bounded batches (no sampling)", async () => {
    const seen: string[] = [];
    const model = new DeterministicReportModel();
    const spy: ReportModelClient = {
      extract: async (req) => {
        seen.push(...req.chunks.map((c) => c.chunk_id));
        return model.extract(req);
      },
      compose: (r) => model.compose(r),
      suggest: (r) => model.suggest(r),
    };
    const many = Array.from({ length: 95 }, (_, i) => makeChunk(SRC_HISTORY, `Fact number ${i} happened in ${1000 + i}.`, 1, 50));
    await run("timeline", many, spy);
    expect(seen).toEqual(many.map((c) => c.chunk_id));
  });
  it("stops when aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      generateReport({ subtype: "faq", chunks, model: new DeterministicReportModel(), signal: ac.signal, reportProgress: () => undefined })
    ).rejects.toThrow();
  });
});
