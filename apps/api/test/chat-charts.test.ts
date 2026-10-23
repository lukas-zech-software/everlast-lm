import { createHash, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HashingTestEmbedder, LocalObjectStorage } from "@everlast/cloud";
import { seedReadySource } from "@everlast/db/testing";
import { insertChartCandidate } from "@everlast/db";
import { LATENCY_TABLE_PAGE, POPULATION_STDDEV_QUESTION, SAFE_SVG, TINY_PNG_BASE64 } from "@everlast/testkit/code-execution-fixtures";
import { ChatService } from "../src/chat/service.ts";
import type { GroundedModel, GroundedModelInput } from "../src/chat/model.ts";
import type { GroundedDraft } from "../src/chat/draft.ts";
import { startTestApi, type TestApi } from "./support.ts";
import { latencyComputeDraft, pngFile, resultFile, ScriptedSandbox } from "./code-execution-support.ts";

/**
 * [010-code-execution-sandbox] T034 — authorized private chart delivery (FR-GC-08, FR-GC-02, NFR-SEC-02,
 * NFR-EVAL-04; spec FR-005, FR-010, FR-011, FR-012, FR-013, SC-005). Real API/PostgreSQL/local versioned storage;
 * scripted model and sandbox are TEST DOUBLES.
 */

class Model implements GroundedModel {
  readonly id = "scripted";
  script: (i: GroundedModelInput) => GroundedDraft = ({ chunks }) => latencyComputeDraft(chunks);
  async generate(input: GroundedModelInput) {
    return this.script(input);
  }
}

let api: TestApi;
let storage: LocalObjectStorage;
const sandbox = new ScriptedSandbox();
const model = new Model();
const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
const embed = (t: string[]) => embedder.embed(t);

beforeAll(async () => {
  storage = new LocalObjectStorage({ root: await mkdtemp(join(tmpdir(), "everlast-charts-")), publicBaseUrl: "http://127.0.0.1" });
  api = await startTestApi({}, (db) => ({ embedder, storage, chat: new ChatService({ pool: db.pool, embedder, model, codeExecution: { runtime: sandbox, storage } }) }));
});
afterAll(async () => api?.close());
beforeEach(() => sandbox.reset());

async function publishedChart(as: string) {
  const res = await api.fetch("/api/notebooks", { method: "POST", as, json: {} });
  const notebookId = ((await res.json()) as any).notebook.id as string;
  const owner = (await api.db.pool.query("SELECT id FROM users WHERE subject = $1", [`local:${as}`])).rows[0].id as string;
  const src = await seedReadySource(api.db.pool, owner, notebookId, { title: "Latency.pdf", pages: [LATENCY_TABLE_PAGE], embed });
  const turn = await api.fetch(`/api/notebooks/${notebookId}/chat/turns`, { method: "POST", as, json: { message: POPULATION_STDDEV_QUESTION, active_source_ids: [src.sourceId], request_id: randomUUID() } });
  const final = JSON.parse(/event: final\ndata: (.+)/.exec(await turn.text())![1]!);
  const answer = final.messages[1];
  const url = answer.code_execution_trace.attempts[0].artifacts[0] as string;
  return { notebookId, owner, src, answer, url, artifactId: url.split("/").at(-1)! };
}

describe("T034 private publication-only delivery (FR-005, NFR-SEC-02)", () => {
  it("CH-01: the owner receives validated PNG bytes with private/no-store, nosniff and a sandboxing CSP", async () => {
    const { url } = await publishedChart("ch01");
    const res = await api.fetch(url, { as: "ch01" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("content-disposition")).toMatch(/^inline; filename="chart-1\.png"$/);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from(TINY_PNG_BASE64, "base64"));
    const download = await api.fetch(`${url}?download=1`, { as: "ch01" });
    expect(download.headers.get("content-disposition")).toMatch(/^attachment; filename="chart-1\.png"$/);
  });

  it("CH-02: unauthenticated 401, foreign owner 403, guessed/cross-message/cross-notebook IDs 404 — no bytes", async () => {
    const a = await publishedChart("ch02");
    const b = await publishedChart("ch02-other");
    expect((await api.fetch(a.url)).status).toBe(401);
    expect((await api.fetch(a.url, { as: "ch02-other" })).status).toBe(403);
    expect((await api.fetch(a.url.replace(a.artifactId, randomUUID()), { as: "ch02" })).status).toBe(404);
    expect((await api.fetch(a.url.replace(a.answer.id, randomUUID()), { as: "ch02" })).status).toBe(404);
    // b's artifact under a's notebook path (owned by ch02): must not resolve.
    expect((await api.fetch(`/api/notebooks/${a.notebookId}/chat/messages/${b.answer.id}/charts/${b.artifactId}`, { as: "ch02" })).status).toBe(404);
    expect((await api.fetch(`/api/notebooks/${a.notebookId}/chat/messages/not-a-uuid/charts/x`, { as: "ch02" })).status).toBe(404);
  });

  it("CH-03: range requests are re-authorized and served exactly; unsatisfiable ranges are 416", async () => {
    const { url } = await publishedChart("ch03");
    const partial = await api.fetch(url, { as: "ch03", headers: { range: "bytes=0-7" } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toMatch(/^bytes 0-7\/\d+$/);
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(Buffer.from(TINY_PNG_BASE64, "base64").subarray(0, 8));
    expect((await api.fetch(url, { as: "ch03", headers: { range: "bytes=99999-" } })).status).toBe(416);
    expect((await api.fetch(url, { as: "ch03-intruder", headers: { range: "bytes=0-7" } })).status).toBe(403);
  });

  it("CH-04: source deletion and Clear chat revoke delivery immediately", async () => {
    const a = await publishedChart("ch04");
    expect((await api.fetch(`/api/notebooks/${a.notebookId}/sources/${a.src.sourceId}`, { method: "DELETE", as: "ch04" })).status).toBe(204);
    expect((await api.fetch(a.url, { as: "ch04" })).status).toBe(404);
    const b = await publishedChart("ch04b");
    expect((await api.fetch(`/api/notebooks/${b.notebookId}/chat`, { method: "DELETE", as: "ch04b" })).status).toBe(200);
    expect((await api.fetch(b.url, { as: "ch04b" })).status).toBe(404);
  });

  it("CH-05: unpublished candidates (e.g. a failed attempt's chart) are never served", async () => {
    const a = await publishedChart("ch05");
    const artifactId = randomUUID();
    const bytes = Buffer.from(TINY_PNG_BASE64, "base64");
    const key = `notebooks/${a.notebookId}/chat-charts/${artifactId}.png`;
    const meta = await storage.write(key, bytes, "image/png");
    await insertChartCandidate(api.db.pool, {
      artifact_id: artifactId,
      execution_id: a.answer.code_execution_trace.execution_id,
      attempt_id: randomUUID(),
      message_id: null,
      notebook_id: a.notebookId,
      user_id: a.owner,
      object_key: key,
      object_generation: meta.generation,
      mime_type: "image/png",
      digest: createHash("sha256").update(bytes).digest("hex"),
      byte_size: bytes.length,
      source_snapshot: [{ source_id: a.src.sourceId, revision: 1 }],
      citation_chunk_ids: [a.src.chunkIds[0]!],
      state: "candidate",
    });
    expect((await api.fetch(a.url.replace(a.artifactId, artifactId), { as: "ch05" })).status).toBe(404);
  });

  it("CH-06: a sanitized SVG chart is served as image/svg+xml under the same CSP and never contains active content", async () => {
    sandbox.script = (call) => ({
      stdout: "",
      stderr: "",
      files: [
        resultFile({ status: "ok", results: [{ label: "n", value: "12", unit: null, sources: [] }] }),
        { name: "chart_1.svg", content: Buffer.from(SAFE_SVG), mimeType: "image/svg+xml" },
        pngFile("chart_2.png"),
      ],
    });
    void sandbox;
    model.script = ({ chunks }) => latencyComputeDraft(chunks, "pstdev");
    const { answer } = await publishedChart("ch06");
    const [svgUrl, pngUrl] = answer.code_execution_trace.attempts[0].artifacts;
    const svg = await api.fetch(svgUrl, { as: "ch06" });
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    expect(svg.headers.get("content-security-policy")).toMatch(/default-src 'none'/);
    const body = await svg.text();
    expect(body).toContain("<svg");
    expect(body).not.toMatch(/<script|onload|rdf:RDF/i);
    expect((await api.fetch(pngUrl, { as: "ch06" })).headers.get("content-type")).toBe("image/png");
  });
});
