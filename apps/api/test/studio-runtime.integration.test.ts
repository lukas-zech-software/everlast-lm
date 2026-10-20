import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedReadySource } from "@everlast/db/testing";
import { DeterministicReportModel } from "@everlast/worker/studio/reports/deterministic-model";
import type { ComposeRequest, ExtractRequest, ReportModelClient } from "@everlast/worker/studio/reports/model";
import { startNotesApi, type NotesApi } from "./notes-pg-support.ts";

/**
 * [008-studio-text-reports] T040, T043 (composition), T047 — Studio reports on the mounted v2 runtime with real
 * PostgreSQL (`TEST_DATABASE_URL`, else UNAVAILABLE), the C-02 PostgreSQL read path and the v1 note-source
 * conversion. The report model is a labelled TEST DOUBLE (the deterministic extractor behind a recording spy).
 * v2 has no source-delete route, so deletion is simulated by removing the source row in PostgreSQL.
 * Per Constitution IV / D12, C-02, FR-ST-10, FR-012, FR-013, FR-008, FR-NM-03, C-03.
 */

/** TEST DOUBLE: records every extract batch and can hold extraction until released. */
class SpyReportModel implements ReportModelClient {
  readonly inner = new DeterministicReportModel();
  batches: string[][] = [];
  languages: (string | undefined)[] = [];
  private gate: Promise<void> | null = null;
  private release: (() => void) | null = null;
  started: Promise<void>;
  private markStarted!: () => void;
  constructor() {
    this.started = new Promise((r) => (this.markStarted = r));
  }
  hold(): void {
    this.gate = new Promise((r) => (this.release = r));
    this.started = new Promise((r) => (this.markStarted = r));
  }
  open(): void {
    this.release?.();
    this.gate = null;
  }
  async extract(req: ExtractRequest) {
    this.batches.push(req.chunks.map((c) => c.chunk_id));
    this.languages.push(req.output_language);
    this.markStarted();
    if (this.gate) await this.gate;
    return this.inner.extract(req);
  }
  compose(req: ComposeRequest) {
    return this.inner.compose(req);
  }
}

const OWNER = "studio-runtime-owner";
let n: NotesApi;
const spy = new SpyReportModel();

beforeAll(async () => {
  n = await startNotesApi({ v2: { reportModel: spy } });
});
afterAll(async () => {
  spy.open();
  await n?.close();
});

const studio = (nb: string) => `/api/notebooks/${nb}/studio`;
const paragraphs = (prefix: string, count: number, from = 1600) =>
  Array.from({ length: count }, (_, i) => `${prefix} fact ${i + 1} was recorded in ${from + i}. It concerned Count ${prefix} Archive.`).join("\n\n");

async function waitTerminal(nb: string, id: string): Promise<any> {
  for (let i = 0; i < 400; i++) {
    const r = await n.call(OWNER, "GET", `${studio(nb)}/artifacts/${id}`);
    if (["Completed", "Failed", "Cancelled"].includes(r.json.artifact.status)) return r.json;
    await new Promise((res) => setTimeout(res, 15));
  }
  throw new Error("Studio job never finished");
}

async function seed(nb: string, title: string, pages: string[]) {
  const owner = await n.userId(OWNER);
  return seedReadySource(n.api.db.pool, owner, nb, { title, mediaType: "text/plain", pages, embed: (t) => n.embedder.embed(t, "RETRIEVAL_DOCUMENT") });
}

async function deleteSource(sourceId: string) {
  const pool = n.api.db.pool;
  await pool.query("DELETE FROM sources WHERE id = $1", [sourceId]);
}

describe("T040 Studio jobs read every scoped chunk in bounded batches (D12, C-02, FR-ST-10)", () => {
  it("passes all chunks of two sources (> 200 in total, > 200 in the first) to the plugin, in order", async () => {
    const nb = await n.notebook(OWNER);
    const a = await seed(nb, "Archive A.txt", [paragraphs("Alpha", 230)]);
    const b = await seed(nb, "Archive B.txt", [paragraphs("Beta", 30, 1900)]);
    expect(a.chunkIds.length).toBe(230);
    spy.batches = [];
    const created = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, { plugin_type: "report", subtype: "briefing_doc", active_source_ids: [a.sourceId, b.sourceId] });
    expect(created.status).toBe(202);
    const done = await waitTerminal(nb, created.json.artifact.id);
    expect(done.artifact.status).toBe("Completed");
    const ordered = [a, b].sort((x, y) => x.sourceId.localeCompare(y.sourceId)).flatMap((s) => s.chunkIds);
    expect(spy.batches.flat()).toEqual(ordered);
    expect(spy.batches.length).toBeGreaterThan(1);
    for (const batch of spy.batches) expect(batch.length).toBeLessThanOrEqual(40);
  });
});

describe("T043 composition: the Vertex Flash report adapter is wired when Vertex is configured (model routing, D3)", () => {
  it("createV2ReportModel returns the Vertex adapter only under the grounded-model condition", async () => {
    const { VertexReportModel } = await import("@everlast/worker/studio/reports/vertex-model");
    const { createV2ReportModel } = await import("../src/server.ts");
    expect(createV2ReportModel({ VERTEX_PROJECT: "everlast-eu" }, true)).toBeInstanceOf(VertexReportModel);
    expect(createV2ReportModel({ VERTEX_PROJECT: "everlast-eu" }, false)).toBeUndefined();
  });
  it("createV2Runtime uses the injected report model (the spy above), else the deterministic one", async () => {
    const nb = await n.notebook(OWNER);
    const a = await seed(nb, "Small.txt", [paragraphs("Gamma", 3)]);
    spy.batches = [];
    const created = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, { plugin_type: "report", subtype: "faq", active_source_ids: [a.sourceId] });
    expect((await waitTerminal(nb, created.json.artifact.id)).artifact.status).toBe("Completed");
    expect(spy.batches.flat()).toEqual(a.chunkIds);
  });
});

describe("T047 a captured source deleted before publication fails the job (FR-ST-10 Gherkin, FR-013, C-02/03)", () => {
  async function runHeldAndDelete(nb: string, sourceId: string) {
    spy.hold();
    const created = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, { plugin_type: "report", subtype: "faq", active_source_ids: [sourceId] });
    expect(created.status).toBe(202);
    await spy.started;
    await deleteSource(sourceId);
    spy.open();
    const done = await waitTerminal(nb, created.json.artifact.id);
    expect(done.artifact.status).toBe("Failed");
    expect(done.artifact.failure.code).toBe("SourceChanged");
    expect(done.artifact.failure.message).toMatch(/no longer current|changed|deleted/i);
    expect(done.artifact.payload_json).toBeNull();
    const listed = await n.call(OWNER, "GET", `${studio(nb)}/artifacts`);
    expect(listed.json.artifacts.find((x: any) => x.id === created.json.artifact.id)).not.toHaveProperty("payload_json");
    expect((await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${created.json.artifact.id}/retry`, {})).status).toBe(400);
  }

  it("an uploaded source (revision 1) deleted after submission", async () => {
    const nb = await n.notebook(OWNER);
    const a = await seed(nb, "Source A.txt", [paragraphs("Delta", 4)]);
    await runHeldAndDelete(nb, a.sourceId);
  });

  it("a note-source deleted after submission", async () => {
    const nb = await n.notebook(OWNER);
    const note = (await n.call(OWNER, "POST", `/api/notebooks/${nb}/notes`, { title: "Field notes", content_md: "The survey began in 1921. It was led by Count Epsilon Survey." })).json.note;
    const converted = await n.call(OWNER, "POST", `/api/notebooks/${nb}/notes/convert-to-source`, { note_ids: [note.id] });
    expect(converted.status).toBe(201);
    await runHeldAndDelete(nb, converted.json.source.id);
  });
});

describe("T047 Convert to source saves the report as a note and converts it through FR-NM-03 (FR-008)", () => {
  it("creates a note (GET /notes) and a Ready note-source without [n] markers, keeping origin_citations", async () => {
    const nb = await n.notebook(OWNER);
    const a = await seed(nb, "History.txt", [paragraphs("Zeta", 3)]);
    const created = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, { plugin_type: "report", subtype: "faq", active_source_ids: [a.sourceId] });
    const done = await waitTerminal(nb, created.json.artifact.id);
    expect(done.artifact.status).toBe("Completed");
    const citations = done.artifact.payload_json.citations;
    expect(done.artifact.payload_json.content_md).toMatch(/\[1\]/);

    const conv = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${created.json.artifact.id}/convert-to-source`, {});
    expect(conv.status).toBe(201);
    const notes = (await n.call(OWNER, "GET", `/api/notebooks/${nb}/notes`)).json.notes;
    const saved = notes.find((x: any) => x.title === "FAQ");
    expect(saved).toBeTruthy();
    expect(saved.citations_json.map((c: any) => c.chunk_id)).toEqual(citations.map((c: any) => c.chunk_id));

    const source = await n.call(OWNER, "GET", `/api/notebooks/${nb}/sources/${conv.json.source_id}`);
    expect(source.json.source.status).toBe("Ready");
    const text = (await n.api.db.pool.query("SELECT string_agg(text, '' ORDER BY page_number) AS t FROM source_pages WHERE source_id = $1", [conv.json.source_id])).rows[0].t as string;
    expect(text).toContain("Zeta fact 1 was recorded in 1600.");
    expect(text).not.toMatch(/\[\d+\]/);
    const prov = (await n.api.db.pool.query("SELECT origin_citations FROM note_source_provenance WHERE source_id = $1", [conv.json.source_id])).rows[0];
    expect(prov.origin_citations.map((c: any) => c.chunk_id)).toEqual(citations.map((c: any) => c.chunk_id));
    expect(prov.origin_citations[0]).toMatchObject({ source_id: a.sourceId, source_title: "History.txt" });
  });

  it("rejects conversion of a report whose captured snapshot is no longer valid (409)", async () => {
    const nb = await n.notebook(OWNER);
    const a = await seed(nb, "Gone.txt", [paragraphs("Eta", 3)]);
    const created = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, { plugin_type: "report", subtype: "faq", active_source_ids: [a.sourceId] });
    expect((await waitTerminal(nb, created.json.artifact.id)).artifact.status).toBe("Completed");
    await deleteSource(a.sourceId);
    const conv = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${created.json.artifact.id}/convert-to-source`, {});
    expect(conv.status).toBe(409);
    expect((await n.call(OWNER, "GET", `/api/notebooks/${nb}/notes`)).json.notes).toHaveLength(0);
  });
});
