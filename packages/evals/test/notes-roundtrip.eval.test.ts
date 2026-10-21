import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HashingTestEmbedder, LocalObjectStorage } from "@everlast/cloud";
import { captureScopeSnapshot, createNotebook } from "@everlast/db";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "@everlast/db/testing";
import { ChatService, type TurnObservation } from "@everlast/api/chat/service";
import type { GroundedModel } from "@everlast/api/chat/model";
import { createPostgresNoteSources } from "@everlast/api/notes/note-sources";

/**
 * Deterministic NFR-EVAL-02 (citation ID precision) and NFR-EVAL-04 (scope leakage) for note-sources
 * (FR-NM-03, Gate v2.0 #2; owner decision 2026-10-20: note-sources are v1 PostgreSQL sources). Real PostgreSQL,
 * the v1 ingestion and C-02 retrieval; the model is a scripted TEST DOUBLE that cites every retrieved chunk.
 */

let db: TestDatabase;
let dir: string;
const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
const citesEverything: GroundedModel = {
  id: "eval:cite-all",
  async generate({ chunks }) {
    return { status: "answered", sentences: chunks.map((c) => ({ text: c.text, citations: [c.chunk_id], kind: "claim" as const })) };
  },
};

beforeAll(async () => {
  db = await createTestDatabase();
  dir = await mkdtemp(join(tmpdir(), "everlast-eval-notes-"));
});
afterAll(async () => {
  await db?.drop();
  await rm(dir, { recursive: true, force: true });
});

describe("NFR-EVAL-02, NFR-EVAL-04: note-source scope", () => {
  it("retrieves only the selected note-source (leakage = 0) and every badge resolves (precision = 1.0)", async () => {
    const owner = await createTestUser(db.pool);
    const nb = (await createNotebook(db.pool, owner, {})).notebook.id;
    const storage = new LocalObjectStorage({ root: dir, publicBaseUrl: "http://127.0.0.1:9" });
    const notes = createPostgresNoteSources({ pool: db.pool, storage, embedder, sourceLimit: 50 });
    await seedReadySource(db.pool, owner, nb, { title: "Decoy.txt", mediaType: "text/plain", pages: ["Project codename is DECOY-99."], embed: (t) => embedder.embed(t) });
    const source = await notes.create(owner, nb, {
      title: "Raw data note",
      markdown: "# Raw data note\n\nProject codename is TITAN-77.",
      origin_notes: [{ note_id: randomUUID(), revision: 1, title: "Raw data note" }],
      origin_citations: [],
    });
    expect(source.status).toBe("Ready");

    const observations: TurnObservation[] = [];
    const chat = new ChatService({ pool: db.pool, embedder, model: citesEverything, observer: (o) => observations.push(o) });
    for await (const _ of chat.runTurn({ ownerId: owner, notebookId: nb, message: "What is the project codename?", activeSourceIds: [source.id], requestId: randomUUID() })) void _;

    const [observation] = observations;
    const leaked = observation!.retrieved.filter((c) => c.source_id !== source.id);
    expect(leaked).toHaveLength(0);
    expect(observation!.result.kind).toBe("answer");
    const citations = observation!.result.kind === "answer" ? observation!.result.citations : [];
    const valid = citations.filter((c) => observation!.retrieved.some((r) => r.chunk_id === c.chunk_id && r.source_id === source.id));
    expect(citations.length).toBeGreaterThan(0);
    expect(valid.length / citations.length).toBe(1);
  });

  it("rejects a note-source id from another notebook", async () => {
    const owner = await createTestUser(db.pool);
    const nb1 = (await createNotebook(db.pool, owner, {})).notebook.id;
    const nb2 = (await createNotebook(db.pool, owner, {})).notebook.id;
    const storage = new LocalObjectStorage({ root: dir, publicBaseUrl: "http://127.0.0.1:9" });
    const notes = createPostgresNoteSources({ pool: db.pool, storage, embedder, sourceLimit: 50 });
    const source = await notes.create(owner, nb1, {
      title: "Secret", markdown: "# Secret\n\nsecret", origin_notes: [{ note_id: randomUUID(), revision: 1, title: "Secret" }], origin_citations: [],
    });
    await expect(captureScopeSnapshot(db.pool, owner, nb2, [source.id])).rejects.toThrow();
  });
});
