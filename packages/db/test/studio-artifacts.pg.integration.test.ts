import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InvalidStudioTransitionError, StudioArtifactSchema, type StudioReportPayload } from "@everlast/contracts";
import { createNotebook, PostgresStudioArtifactRepository, StudioRetryNotAllowedError } from "../src/index.ts";
import { createTestDatabase, createTestUser, type TestDatabase } from "../src/testing.ts";

/**
 * [013-v2-persistence-postgres] T013 — `PostgresStudioArtifactRepository` keeps the C-03 behaviour of the
 * in-memory repository (FR-ST-10, FR-ST-11, C-03) and survives a new repository instance (DEV-04).
 */

let db: TestDatabase;
let repo: PostgresStudioArtifactRepository;
beforeAll(async () => {
  db = await createTestDatabase();
  repo = new PostgresStudioArtifactRepository(db.pool);
});
afterAll(async () => {
  await db?.drop();
});

const SRC = randomUUID();
const payload: StudioReportPayload = {
  content_md: "# R [1]",
  citations: [{ badge_number: 1, chunk_id: "01890000-0000-7000-8000-000000000001", source_id: SRC, revision: 1, snippet: "s" }],
  sections: [{ key: "report", heading: "Report" }],
};

async function setup() {
  const owner = await createTestUser(db.pool);
  const nb = (await createNotebook(db.pool, owner, {})).notebook.id;
  const nb2 = (await createNotebook(db.pool, owner, {})).notebook.id;
  const input = { notebook_id: nb, owner_id: owner, subtype: "briefing_doc" as const, title: "Briefing doc", params_json: {}, snapshot: [{ source_id: SRC, revision: 1 }] };
  return { owner, nb, nb2, input };
}

describe("C-03 StudioArtifactRepository (PostgreSQL)", () => {
  it("creates a Queued schema-valid artifact with snapshot", async () => {
    const { input } = await setup();
    const a = await repo.createQueued(input);
    expect(a).toMatchObject({ status: "Queued", attempt: 1, retry_of: null, payload_json: null, source_revisions_snapshot: input.snapshot, output_language: null });
    const { owner_id: _o, ...dto } = a;
    expect(StudioArtifactSchema.safeParse(dto).success).toBe(true);
  });

  it("enforces Queued → Running → Completed and terminal immutability; a new repository reads the same row", async () => {
    const { input } = await setup();
    const a = await repo.createQueued(input);
    await expect(repo.complete(a.id, payload)).rejects.toBeInstanceOf(InvalidStudioTransitionError);
    await repo.markRunning(a.id);
    const progressed = await repo.updateProgress(a.id, { stage: "extracting", percent: 40 });
    expect(progressed.progress).toEqual({ stage: "extracting", percent: 40 });
    const done = await repo.complete(a.id, payload);
    expect(done).toMatchObject({ status: "Completed", payload_json: payload, progress: null });
    await expect(repo.fail(a.id, { code: "GenerationError", message: "x" })).rejects.toBeInstanceOf(InvalidStudioTransitionError);
    await expect(repo.cancel(a.id)).rejects.toBeInstanceOf(InvalidStudioTransitionError);
    expect(await new PostgresStudioArtifactRepository(db.pool).getById(a.id)).toEqual(done);
  });

  it("records failure and cancellation without a payload; progress needs Running", async () => {
    const { input } = await setup();
    const f = await repo.createQueued(input);
    await expect(repo.updateProgress(f.id, { stage: "reading", percent: 0 })).rejects.toBeInstanceOf(InvalidStudioTransitionError);
    await repo.markRunning(f.id);
    expect(await repo.fail(f.id, { code: "SourceChanged", message: "Source A replaced" })).toMatchObject({ status: "Failed", payload_json: null, failure: { code: "SourceChanged" } });
    const c = await repo.createQueued(input);
    expect((await repo.cancel(c.id)).failure).toEqual({ code: "Cancelled", message: "Cancelled by the owner." });
    await expect(repo.complete(c.id, payload)).rejects.toBeInstanceOf(InvalidStudioTransitionError);
  });

  it("isolates by notebook and owner; list keeps insertion order and excludes payloads", async () => {
    const { owner, nb, nb2, input } = await setup();
    const other = await createTestUser(db.pool);
    const a = await repo.createQueued(input);
    const b = await repo.createQueued({ ...input, subtype: "faq", title: "FAQ" });
    const c = await repo.createQueued({ ...input, subtype: "timeline", title: "Timeline" });
    await repo.markRunning(a.id);
    await repo.complete(a.id, payload);
    expect(await repo.get(nb, owner, a.id)).not.toBeNull();
    expect(await repo.get(nb2, owner, a.id)).toBeNull();
    expect(await repo.get(nb, other, a.id)).toBeNull();
    const listed = await repo.list(nb, owner);
    expect(listed.map((x) => x.id)).toEqual([a.id, b.id, c.id]);
    expect("payload_json" in listed[0]!).toBe(false);
    expect(await repo.list(nb, other)).toEqual([]);
  });

  it("creates retries as new attempts only from Failed/Cancelled with a fresh snapshot", async () => {
    const { owner, input } = await setup();
    const a = await repo.createQueued({ ...input, output_language: "de-DE" });
    await expect(repo.createRetry({ previous_id: a.id, owner_id: owner, snapshot: input.snapshot })).rejects.toBeInstanceOf(StudioRetryNotAllowedError);
    await expect(repo.createRetry({ previous_id: randomUUID(), owner_id: owner, snapshot: input.snapshot })).rejects.toBeInstanceOf(StudioRetryNotAllowedError);
    await repo.markRunning(a.id);
    await repo.fail(a.id, { code: "SourceChanged", message: "changed" });
    const next = await repo.createRetry({ previous_id: a.id, owner_id: owner, snapshot: [{ source_id: SRC, revision: 2 }] });
    expect(next).toMatchObject({ attempt: 2, retry_of: a.id, status: "Queued", output_language: "de-DE", source_revisions_snapshot: [{ source_id: SRC, revision: 2 }] });
    expect((await repo.getById(a.id))?.status).toBe("Failed");
  });

  it("deletes one artifact and cascades per notebook", async () => {
    const { owner, nb, nb2, input } = await setup();
    const other = await createTestUser(db.pool);
    const a = await repo.createQueued(input);
    await repo.createQueued({ ...input, notebook_id: nb2 });
    expect(await repo.delete(nb, other, a.id)).toBe(false);
    expect(await repo.delete(nb, owner, a.id)).toBe(true);
    await repo.createQueued(input);
    await repo.deleteForNotebook(nb);
    expect(await repo.list(nb, owner)).toEqual([]);
    expect(await repo.list(nb2, owner)).toHaveLength(1);
  });
});
