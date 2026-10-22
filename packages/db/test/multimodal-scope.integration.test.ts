import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@everlast/contracts";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "../src/testing.ts";
import { createNotebook } from "../src/notebooks.ts";
import { countOccupiedSources, getSourceById, reserveSources } from "../src/quota.ts";
import { captureScopeSnapshot, verifyScopeSnapshot } from "../src/scope-guard.ts";
import { listSnapshotChunks, readSourceForInspection, retrieveScopedChunks } from "../src/scoped-context.ts";
import { publishReadySource } from "../src/ingestion.ts";
import * as sync from "../src/source-sync.ts";

/**
 * [009-multimodal-ingestion-sync] T005 — Owner-only admission, shared quota, explicit scope and current-revision
 * filters for v3 sources (FR-SI-03, FR-SI-05, FR-WM-04/05/07, FR-NM-03, C-02/C-03, NFR-EVAL-02/04;
 * spec FR-007, FR-013, FR-014, FR-015, FR-016).
 */

let db: TestDatabase;
let owner: string;
let stranger: string;
const vec = (i: number) => Array.from({ length: 768 }, (_, j) => (j === i ? 1 : 0));
const embed = async (texts: string[]) => texts.map(() => vec(0));

beforeAll(async () => {
  db = await createTestDatabase();
  owner = await createTestUser(db.pool);
  stranger = await createTestUser(db.pool);
});

afterAll(async () => {
  await db?.drop();
});

const notebook = async (as = owner) => (await createNotebook(db.pool, as, {})).notebook.id;
const webImport = (url = "https://news.example.test/a") => ({ attempt_id: randomUUID(), kind: "web" as const, url });

describe("Owner-only v3 admission (FR-WM-04/05, NFR-SEC-02; spec FR-016)", () => {
  it("SCOPE-D01: foreign notebook → 403, absent notebook → 404; nothing is reserved", async () => {
    const nb = await notebook();
    await expect(sync.admitLinkedImport(db.pool, stranger, nb, webImport())).rejects.toMatchObject({ status: 403 });
    await expect(sync.admitLinkedImport(db.pool, owner, randomUUID(), webImport())).rejects.toMatchObject({ status: 404 });
    expect(await countOccupiedSources(db.pool, nb)).toBe(0);
  });

  it("SCOPE-D02: re-sync and operation status are owner-checked", async () => {
    const nb = await notebook();
    const { sourceId } = await seedReadySource(db.pool, owner, nb, { pages: ["Release v1 in May."], embed, mediaType: "text/plain" });
    await db.pool.query("UPDATE sources SET link_kind = 'web', external_url = 'https://intranet.corp/r', media_type = 'text/html' WHERE id = $1", [sourceId]);
    await expect(sync.requestSourceSync(db.pool, stranger, nb, sourceId, { attemptId: randomUUID(), trigger: "manual" })).rejects.toMatchObject({ status: 403 });
    const op = await sync.requestSourceSync(db.pool, owner, nb, sourceId, { attemptId: randomUUID(), trigger: "manual" });
    await expect(sync.getSourceOperation(db.pool, stranger, nb, sourceId, op.operation.operation_id)).rejects.toMatchObject({ status: 403 });
  });

  it("SCOPE-D03: only linked Ready sources are re-sync eligible", async () => {
    const nb = await notebook();
    const { sourceId } = await seedReadySource(db.pool, owner, nb, { pages: ["Upload."], embed });
    await expect(sync.requestSourceSync(db.pool, owner, nb, sourceId, { attemptId: randomUUID(), trigger: "manual" })).rejects.toMatchObject({ status: 409, code: "ValidationFailed" });
  });
});

describe("shared atomic quota across uploads, imports and note-sources (FR-WM-07, FR-NM-03; spec FR-007)", () => {
  it("SCOPE-D04: concurrent imports and uploads never over-admit the notebook limit", async () => {
    const nb = await notebook();
    const filler = Array.from({ length: 48 }, () => ({ attempt_id: randomUUID(), title: "f.txt", media_type: "text/plain", declared_bytes: 1 }));
    await reserveSources(db.pool, owner, nb, filler, { sourceLimit: 50 });
    const attempts = await Promise.allSettled([
      sync.admitLinkedImport(db.pool, owner, nb, webImport(), { sourceLimit: 50 }),
      sync.admitLinkedImport(db.pool, owner, nb, webImport(), { sourceLimit: 50 }),
      sync.admitLinkedImport(db.pool, owner, nb, { attempt_id: randomUUID(), kind: "video", url: "https://media.example.test/v/1" }, { sourceLimit: 50 }),
      reserveSources(db.pool, owner, nb, [{ attempt_id: randomUUID(), title: "n", media_type: "note_markdown", declared_bytes: 1 }], { sourceLimit: 50 }),
      reserveSources(db.pool, owner, nb, [{ attempt_id: randomUUID(), title: "d.docx", media_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", declared_bytes: 1 }], { sourceLimit: 50 }),
    ]);
    expect(await countOccupiedSources(db.pool, nb)).toBe(50);
    const rejectedImports = attempts.slice(0, 3).filter((a) => a.status === "rejected");
    for (const r of rejectedImports) expect((r as PromiseRejectedResult).reason).toMatchObject({ code: "SourceQuotaExceeded", status: 409 });
  });

  it("SCOPE-D05: a failed import releases its slot exactly once and keeps a dismissible error row", async () => {
    const nb = await notebook();
    const admitted = await sync.admitLinkedImport(db.pool, owner, nb, webImport());
    expect(admitted.source.status).toBe("Processing");
    expect(await countOccupiedSources(db.pool, nb)).toBe(1);
    const claim = (await sync.claimSourceOperation(db.pool, admitted.operation.operation_id, { leaseSeconds: 60 })) as { fencingToken: number };
    const failure = { operationId: admitted.operation.operation_id, fencingToken: claim.fencingToken, code: "WebExtractionFailed", message: "Unable to extract content from URL" };
    expect(await sync.failSourceOperation(db.pool, failure)).toBe(true);
    expect(await sync.failSourceOperation(db.pool, failure)).toBe(false);
    expect(await countOccupiedSources(db.pool, nb)).toBe(0);
    expect(await getSourceById(db.pool, admitted.source.id)).toMatchObject({ status: "Failed", failure_message: "Unable to extract content from URL" });
  });

  it("SCOPE-D06: replaying the same import attempt returns the same source; a mismatched payload is 409", async () => {
    const nb = await notebook();
    const request = webImport("https://news.example.test/same");
    const a = await sync.admitLinkedImport(db.pool, owner, nb, request);
    const b = await sync.admitLinkedImport(db.pool, owner, nb, request);
    expect(b).toMatchObject({ replayed: true, source: { id: a.source.id }, operation: { operation_id: a.operation.operation_id } });
    await expect(sync.admitLinkedImport(db.pool, owner, nb, { ...request, url: "https://news.example.test/other" })).rejects.toMatchObject({ status: 409 });
    expect(await countOccupiedSources(db.pool, nb)).toBe(1);
  });
});

describe("explicit scope, singleton inspection and current revision (FR-SI-03/04, C-02, NFR-EVAL-04; spec FR-013/014)", () => {
  it("SCOPE-D07: empty or omitted scope is rejected; there is no all-sources fallback", async () => {
    const nb = await notebook();
    await seedReadySource(db.pool, owner, nb, { pages: ["text"], embed });
    await expect(captureScopeSnapshot(db.pool, owner, nb, [])).rejects.toMatchObject({ code: "EmptyScope" });
    await expect(captureScopeSnapshot(db.pool, owner, nb, undefined)).rejects.toMatchObject({ code: "EmptyScope" });
  });

  it("SCOPE-D08: after a re-sync, old snapshots fail and retrieval returns only the current revision", async () => {
    const nb = await notebook();
    const { sourceId } = await seedReadySource(db.pool, owner, nb, { pages: ["Release v1 in May."], embed, mediaType: "text/plain" });
    await db.pool.query("UPDATE sources SET link_kind = 'web', external_url = 'https://intranet.corp/r', media_type = 'text/html' WHERE id = $1", [sourceId]);
    const old = await captureScopeSnapshot(db.pool, owner, nb, [sourceId]);
    const op = await sync.requestSourceSync(db.pool, owner, nb, sourceId, { attemptId: randomUUID(), trigger: "manual" });
    const claim = (await sync.claimSourceOperation(db.pool, op.operation.operation_id, { leaseSeconds: 60 })) as { fencingToken: number };
    const text = "Release v1 in June.";
    await sync.commitSyncReplacement(db.pool, {
      operationId: op.operation.operation_id,
      fencingToken: claim.fencingToken,
      sourceId,
      expectedRevision: 1,
      byteSize: text.length,
      wordCount: 4,
      pageCount: 1,
      embeddingModel: "test",
      contentHash: "h2",
      pages: [{ page_number: 1, text }],
      chunks: [{ chunk: { chunk_id: uuidv7(), source_id: sourceId, revision: 2, locator: { page_number: 1, start_offset: 0, end_offset: text.length }, token_count: 4, text }, embedding: vec(0) }],
    });
    await expect(verifyScopeSnapshot(db.pool, old)).rejects.toMatchObject({ code: "SourceSnapshotInvalid" });
    const current = await captureScopeSnapshot(db.pool, owner, nb, [sourceId]);
    const chunks = await retrieveScopedChunks(db.pool, current, { queryText: "release", queryEmbedding: vec(0), limit: 10 });
    expect(chunks.map((c) => c.text)).toEqual([text]);
    expect((await listSnapshotChunks(db.pool, current)).every((c) => c.revision === 2)).toBe(true);
    // Singleton inspection reads the current revision and never needs a chat selection.
    const view = await readSourceForInspection(db.pool, owner, nb, sourceId);
    expect(view.source.revision).toBe(2);
    expect(view.pages.map((p) => p.text)).toEqual([text]);
  });

  it("SCOPE-D09: publication is refused for a source deleted or failed in flight", async () => {
    const nb = await notebook();
    const admitted = await sync.admitLinkedImport(db.pool, owner, nb, webImport());
    const claim = (await sync.claimSourceOperation(db.pool, admitted.operation.operation_id, { leaseSeconds: 60 })) as { fencingToken: number };
    await sync.deleteSource(db.pool, owner, nb, admitted.source.id);
    const text = "late";
    const outcome = await publishReadySource(db.pool, {
      sourceId: admitted.source.id,
      attemptId: admitted.source.attempt_id,
      revision: 1,
      byteSize: 4,
      wordCount: 1,
      pageCount: 1,
      embeddingModel: "test",
      pages: [{ page_number: 1, text }],
      chunks: [{ chunk: { chunk_id: uuidv7(), source_id: admitted.source.id, revision: 1, locator: { page_number: 1, start_offset: 0, end_offset: 4 }, token_count: 1, text }, embedding: vec(0) }],
      operation: { id: admitted.operation.operation_id, fencingToken: claim.fencingToken },
    });
    expect(outcome).toEqual({ published: false, reason: "fenced" });
  });
});
