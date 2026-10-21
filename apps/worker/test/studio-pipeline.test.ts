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

/** Text of one `## heading` section of a rendered report. */
const section = (md: string, heading: string): string => {
  const lines = md.split("\n");
  const at = lines.indexOf(`## ${heading}`);
  if (at < 0) return "";
  const rest = lines.slice(at + 1);
  const next = rest.findIndex((l) => l.startsWith("## "));
  return (next < 0 ? rest : rest.slice(0, next)).join("\n").trim();
};
const keys = (out: Awaited<ReturnType<typeof run>>) => (out.status === "completed" ? out.payload.sections.map((x) => x.key) : []);

describe("generateReport per template (FR-ST-10, FR-002..FR-005, [008-studio-text-reports] T041)", () => {
  it("Briefing doc: executive_summary, core_themes, key_takeaways and verbatim cited quotes", async () => {
    const out = await run("briefing_doc");
    if (out.status !== "completed") throw new Error(`refused: ${out.message}`);
    expect(keys(out)).toEqual(["executive_summary", "core_themes", "key_takeaways", "quotes"]);
    const md = out.payload.content_md;
    for (const h of ["Executive Summary", "Core Themes", "Key Takeaways", "Quotes"]) expect(section(md, h)).not.toBe("");
    expect(section(md, "Quotes")).toMatch(/^> The Treaty of Westphalia was signed in 1648.* \[\d+\]$/m);
    expect(validateReportPayload(out.payload, chunks, snapshot, "briefing_doc")).toBeNull();
  });
  it("Study guide: topic review, short-answer questions, a separate matching answer key, essay questions, glossary", async () => {
    const out = await run("study_guide");
    if (out.status !== "completed") throw new Error(`refused: ${out.message}`);
    expect(keys(out)).toEqual(["topic_review", "short_answer_questions", "answer_key", "essay_questions", "glossary"]);
    const md = out.payload.content_md;
    const questions = section(md, "Short-Answer Questions").split("\n").filter((l) => /^\d+\. /.test(l));
    const answers = section(md, "Answer Key").split("\n").filter((l) => /^\d+\. /.test(l));
    expect(questions.length).toBeGreaterThan(0);
    expect(answers).toHaveLength(questions.length);
    for (const q of questions) expect(q).toMatch(/\?$/);
    for (const a of answers) expect(a).toMatch(/\[\d+\]$/);
    expect(section(md, "Glossary")).toMatch(/hash function/i);
    expect(section(md, "Essay Questions")).not.toBe("");
    expect(validateReportPayload(out.payload, chunks, snapshot, "study_guide")).toBeNull();
  });
  it("FAQ yields at least one cited question/answer pair", async () => {
    const out = await run("faq");
    if (out.status !== "completed") throw new Error("refused");
    expect(keys(out)).toEqual(["faq"]);
    expect(out.payload.content_md).toMatch(/\*\*Q: .+\?\*\*/);
    expect(out.payload.content_md).toMatch(/^A: .+ \[\d+\]$/m);
    expect(validateReportPayload(out.payload, chunks, snapshot, "faq")).toBeNull();
  });
  it("Timeline: chronological events plus cast_of_characters", async () => {
    const out = await run("timeline");
    if (out.status !== "completed") throw new Error("refused");
    expect(keys(out)).toEqual(["events", "cast_of_characters"]);
    const events = section(out.payload.content_md, "Events");
    expect(events.indexOf("1648")).toBeGreaterThan(-1);
    expect(events.indexOf("1648")).toBeLessThan(events.indexOf("1815"));
    expect(section(out.payload.content_md, "Cast of Characters")).toContain("Axel Oxenstierna");
  });
  it("Timeline over undated sources completes with the no-dated-events notice plus cast, inventing no date", async () => {
    const nd = noDateChunks();
    const out = await run("timeline", nd);
    if (out.status !== "completed") throw new Error("refused");
    expect(keys(out)).toEqual(["events", "cast_of_characters"]);
    expect(section(out.payload.content_md, "Events")).toBe("_The selected sources contain no dated events._");
    expect(out.payload.content_md).not.toMatch(/\b1[0-9]{3}\b|\b20[0-9]{2}\b/);
    expect(section(out.payload.content_md, "Cast of Characters")).toContain("Alice Johnson");
    expect(nd[0]!.source_id).toBe(SRC_NODATES);
    expect(validateReportPayload(out.payload, nd, [{ source_id: SRC_NODATES, revision: 1 }], "timeline")).toBeNull();
  });
  it("Timeline with neither dated events nor actors fails", async () => {
    const out = await run("timeline", [makeChunk(SRC_NODATES, "the policy covers equipment and communication rules.")]);
    expect(out).toMatchObject({ status: "refused", code: "InsufficientEvidence" });
  });
  it("one empty required section refuses the report (InsufficientEvidence), never a filler note", async () => {
    // History alone defines no terms, so the Study Guide glossary would be empty.
    const study = await run("study_guide", historyChunks());
    expect(study).toMatchObject({ status: "refused", code: "InsufficientEvidence" });
    const base = new DeterministicReportModel();
    const noThemes: ReportModelClient = {
      extract: (r) => base.extract(r),
      compose: async (r) => (await base.compose(r)).map((b) => (b.id === "core_themes" ? { ...b, items: [] } : b)),
    };
    expect(await run("briefing_doc", chunks, noThemes)).toMatchObject({ status: "refused", code: "InsufficientEvidence" });
    const missing: ReportModelClient = {
      extract: (r) => base.extract(r),
      compose: async (r) => (await base.compose(r)).filter((b) => b.id !== "quotes"),
    };
    expect(await run("briefing_doc", chunks, missing)).toMatchObject({ status: "refused", code: "InsufficientEvidence" });
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

/** [008-studio-text-reports] T045 — effective output language reaches the model and localizes headings (FR-UI-02). */
describe("generateReport output language (FR-UI-02, FR-ST-10/11)", () => {
  it("passes output_language to extract and compose and localizes headings by stable key", async () => {
    const seen: (string | undefined)[] = [];
    const base = new DeterministicReportModel();
    const spy: ReportModelClient = {
      extract: (r) => (seen.push(r.output_language), base.extract(r)),
      compose: (r) => (seen.push(r.output_language), base.compose(r)),
    };
    const out = await generateReport({ subtype: "timeline", chunks, model: spy, output_language: "de-DE", signal: new AbortController().signal, reportProgress: () => undefined });
    if (out.status !== "completed") throw new Error("refused");
    expect(seen.length).toBeGreaterThan(1);
    expect(new Set(seen)).toEqual(new Set(["de-DE"]));
    expect(out.payload.sections).toEqual([{ key: "events", heading: "Ereignisse" }, { key: "cast_of_characters", heading: "Hauptakteure" }]);
    expect(out.payload.content_md).toContain("## Hauptakteure");
    const en = await generateReport({ subtype: "timeline", chunks, model: base, output_language: "en-US", signal: new AbortController().signal, reportProgress: () => undefined });
    if (en.status !== "completed") throw new Error("refused");
    expect(en.payload.sections.map((x) => x.key)).toEqual(["events", "cast_of_characters"]);
    expect(en.payload.sections[1]!.heading).toBe("Cast of Characters");
  });
});

describe("map step latency (D12, Gate v2.0 #3 P95 ≤ 25 s)", () => {
  it("extracts bounded batches concurrently (≤ EXTRACT_CONCURRENCY in flight) and keeps findings in batch order", async () => {
    const { EXTRACT_CONCURRENCY } = await import("../src/studio/reports/pipeline.ts");
    const inner = new DeterministicReportModel();
    let inFlight = 0;
    let peak = 0;
    let calls = 0;
    const seen: string[] = [];
    const model: ReportModelClient = {
      async extract(req) {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        // Later batches finish first, so order must come from the batch index, not completion time.
        await new Promise((r) => setTimeout(r, Math.max(1, 40 - 10 * calls++)));
        inFlight -= 1;
        return inner.extract(req);
      },
      async compose(req) {
        seen.push(...req.findings.map((f) => f.chunk_id));
        return inner.compose(req);
      },
    };
    const out = await generateReport({ subtype: "faq", chunks, model, limits: { maxTokens: 100_000, maxChunks: 1 }, signal: new AbortController().signal, reportProgress: () => undefined });
    expect(out.status).toBe("completed");
    expect(EXTRACT_CONCURRENCY).toBeGreaterThan(1);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(EXTRACT_CONCURRENCY);
    const order = [...new Set(seen)];
    expect(order).toEqual(chunks.map((c) => c.chunk_id).filter((id) => order.includes(id)));
  });
});
