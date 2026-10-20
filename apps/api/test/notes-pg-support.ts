import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HashingTestEmbedder, LocalObjectStorage, type Embedder, type EmbeddingTask } from "@everlast/cloud";
import { seedReadySource } from "@everlast/db/testing";
import { createWorkerHandler } from "@everlast/worker";
import { ChatService } from "../src/chat/service.ts";
import type { GroundedModel, GroundedModelInput } from "../src/chat/model.ts";
import type { GroundedDraft } from "../src/chat/draft.ts";
import { createV2Runtime, type V2Runtime } from "../src/v2/runtime.ts";
import { startTestApi, type TestApi } from "./support.ts";

/**
 * TEST-ONLY harness for the Package 2.3 PostgreSQL suites (FR-NM-01..04, FR-WM-07, C-01, C-02, Gate v2.0 #2).
 * Real API, real PostgreSQL, the mounted v2 runtime, the real v1 ingestion (in-process worker drain, local
 * storage) and the production citation verifier. Two labelled test doubles: a lexical embedder that can be held
 * or failed, and a scripted grounded model.
 */

export type Script = (input: GroundedModelInput) => Promise<GroundedDraft> | GroundedDraft;

export class ScriptedModel implements GroundedModel {
  readonly id = "scripted-notes-model";
  calls: GroundedModelInput[] = [];
  script: Script = citeMatching;
  async generate(input: GroundedModelInput): Promise<GroundedDraft> {
    this.calls.push(input);
    return this.script(input);
  }
}

/** Cites every chunk that shares a 4+ letter keyword with the question; otherwise not_in_sources. */
export const citeMatching: Script = ({ question, chunks }) => {
  const words = (question.toLowerCase().match(/[\p{L}\p{N}-]{4,}/gu) ?? []).filter((w) => !["what", "selected", "notes", "from"].includes(w));
  const hits = chunks.filter((c) => words.some((w) => c.text.toLowerCase().includes(w)));
  if (hits.length === 0) return { status: "not_in_sources", missing_topic: "the question", sentences: [] };
  return { status: "answered", sentences: hits.map((c) => ({ text: c.text.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim() ?? c.text, citations: [c.chunk_id], kind: "claim" as const })) };
};

/** Cites every chunk it was given (Note Assistant actions). */
export const citeAll: Script = ({ chunks }) =>
  chunks.length === 0
    ? { status: "not_in_sources", sentences: [] }
    : { status: "answered", sentences: chunks.map((c) => ({ text: `Point from ${c.source_id.slice(0, 8)}.`, citations: [c.chunk_id], kind: "claim" as const })) };

/** Lexical test embedder whose document embeddings can be held open or made to fail. */
export class ControlledEmbedder implements Embedder {
  readonly model: string;
  private readonly inner = new HashingTestEmbedder({ NODE_ENV: "test" });
  private gate: Promise<void> | null = null;
  private release: (() => void) | null = null;
  failDocuments = false;
  documentCalls = 0;

  constructor() {
    this.model = this.inner.model;
  }

  hold(): void {
    this.gate = new Promise((resolve) => (this.release = resolve));
  }

  open(): void {
    this.release?.();
    this.gate = null;
    this.release = null;
  }

  async embed(texts: string[], task: EmbeddingTask): Promise<number[][]> {
    if (task === "RETRIEVAL_DOCUMENT") {
      this.documentCalls += 1;
      if (this.gate) await this.gate;
      if (this.failDocuments) throw new Error("embedding backend unavailable: secret upstream detail");
    }
    return this.inner.embed(texts);
  }
}

export interface SseEvent {
  event: string;
  data: any;
}

export interface NotesApi {
  api: TestApi;
  v2: V2Runtime;
  model: ScriptedModel;
  embedder: ControlledEmbedder;
  drain(): Promise<unknown>;
  call(as: string, method: string, path: string, json?: unknown): Promise<{ status: number; json: any }>;
  notebook(as: string): Promise<string>;
  userId(as: string): Promise<string>;
  addText(as: string, nb: string, text: string): Promise<string>;
  seedSources(as: string, nb: string, count: number): Promise<void>;
  turn(as: string, nb: string, message: string, sources: string[]): Promise<{ status: number; messages: any[]; error?: any; json?: any }>;
  saveNote(as: string, nb: string, messageId: string): Promise<{ status: number; json: any }>;
  close(): Promise<void>;
}

export async function startNotesApi(options: { sourceLimit?: number } = {}): Promise<NotesApi> {
  const sourceLimit = options.sourceLimit ?? 50;
  const dir = await mkdtemp(join(tmpdir(), "everlast-notes-"));
  const embedder = new ControlledEmbedder();
  const model = new ScriptedModel();
  const storage = new LocalObjectStorage({ root: dir, publicBaseUrl: "http://127.0.0.1:9" });
  let drain: () => Promise<unknown> = async () => undefined;
  let pending: Promise<unknown> = Promise.resolve();
  const notifyJobs = () => {
    pending = pending.then(() => drain()).catch(() => undefined);
  };
  let v2!: V2Runtime;
  const api = await startTestApi({ sourceLimit }, (db) => {
    v2 = createV2Runtime({ pool: db.pool, sourceLimit, model, storage, embedder, notifyJobs });
    return { embedder, storage, notifyJobs, v2, chat: new ChatService({ pool: db.pool, embedder, model }) };
  });
  const worker = createWorkerHandler({ pool: api.db.pool, storage, embedder, ocr: { name: "none", recognize: async () => new Map() } }, { NODE_ENV: "test" });
  drain = () => worker.drain();

  const call = async (as: string, method: string, path: string, json?: unknown) => {
    const res = await api.fetch(path, { method, as, ...(json !== undefined ? { json } : {}) });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
  const userId = async (as: string) => {
    await api.fetch("/api/notebooks", { as });
    return (await api.db.pool.query("SELECT id FROM users WHERE subject = $1", [`local:${as}`])).rows[0].id as string;
  };

  return {
    api,
    v2,
    model,
    embedder,
    drain: () => drain(),
    call,
    userId,
    async notebook(as) {
      return (await call(as, "POST", "/api/notebooks", {})).json.notebook.id;
    },
    async addText(as, nb, text) {
      const r = await call(as, "POST", `/api/notebooks/${nb}/sources/text`, { attempt_id: randomUUID(), text });
      if (r.status !== 201) throw new Error(`addText failed: ${r.status} ${JSON.stringify(r.json)}`);
      const id: string = r.json.source.id;
      for (let i = 0; i < 200; i++) {
        await drain();
        const s = await call(as, "GET", `/api/notebooks/${nb}/sources/${id}`);
        if (s.json.source.status === "Ready") return id;
        if (s.json.source.status === "Failed") throw new Error("text source failed");
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error("text source never became Ready");
    },
    async seedSources(as, nb, count) {
      const owner = await userId(as);
      for (let i = 0; i < count; i++) {
        await seedReadySource(api.db.pool, owner, nb, { title: `Upload ${i + 1}.txt`, mediaType: "text/plain", pages: [`Filler upload number ${i + 1}.`], embed: (t) => embedder.embed(t, "RETRIEVAL_DOCUMENT") });
      }
    },
    async turn(as, nb, message, sources) {
      const res = await api.fetch(`/api/notebooks/${nb}/chat/turns`, { method: "POST", as, json: { message, active_source_ids: sources, request_id: randomUUID() } });
      if (res.headers.get("content-type")?.startsWith("application/json")) return { status: res.status, messages: [], json: await res.json() };
      const events: SseEvent[] = (await res.text())
        .split("\n\n")
        .filter(Boolean)
        .map((block) => ({ event: /^event: (.+)$/m.exec(block)![1]!, data: JSON.parse(/^data: (.+)$/m.exec(block)![1]!) }));
      const final = events.find((e) => e.event === "final")?.data;
      return { status: res.status, messages: final?.messages ?? [], error: events.find((e) => e.event === "error")?.data };
    },
    saveNote(as, nb, messageId) {
      return call(as, "POST", `/api/notebooks/${nb}/chat/messages/${messageId}/note`, { notebook_id: nb, message_id: messageId });
    },
    async close() {
      embedder.open();
      v2.close();
      await pending;
      await api.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
