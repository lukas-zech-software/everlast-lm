import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { configureV2Persistence, createNotebook, getNotebookOwner, getNotebookRecord, getReadySourceCount, touchNotebookModified } from "../src/index.ts";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "../src/testing.ts";

/**
 * [013-v2-persistence-postgres] T008 — with PostgreSQL configured, v2 reads notebook ownership, Ready counts and
 * the content modified time from the v1 tables, never from an in-process mirror (FR-007, FR-WM-03, FR-WM-04).
 */

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
  configureV2Persistence(db.pool);
});
afterEach(() => configureV2Persistence(db.pool));
afterAll(async () => {
  configureV2Persistence(null);
  await db?.drop();
});

const embed = async (texts: string[]) => texts.map(() => Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)));

describe("FR-007: notebook bridge over PostgreSQL", () => {
  it("reads owner and notebook from `notebooks` without any prior request mirroring it", async () => {
    const owner = await createTestUser(db.pool);
    const nb = (await createNotebook(db.pool, owner, { title: "Research" })).notebook;
    expect(await getNotebookOwner(nb.id)).toBe(owner);
    expect(await getNotebookRecord(nb.id)).toMatchObject({ id: nb.id, owner_id: owner, title: "Research", archived_at: null });
    await db.pool.query("DELETE FROM notebooks WHERE id = $1", [nb.id]);
    expect(await getNotebookOwner(nb.id)).toBeNull();
    expect(await getNotebookRecord(nb.id)).toBeNull();
  });

  it("FR-WM-03: counts Ready sources from `sources`", async () => {
    const owner = await createTestUser(db.pool);
    const nb = (await createNotebook(db.pool, owner, {})).notebook.id;
    expect(await getReadySourceCount(nb)).toBe(0);
    await seedReadySource(db.pool, owner, nb, { title: "A", mediaType: "text/plain", pages: ["a"], embed });
    await seedReadySource(db.pool, owner, nb, { title: "B", mediaType: "text/plain", pages: ["b"], embed });
    expect(await getReadySourceCount(nb)).toBe(2);
  });

  it("FR-WM-03: touchNotebookModified bumps notebooks.updated_at strictly monotonically", async () => {
    const owner = await createTestUser(db.pool);
    const nb = (await createNotebook(db.pool, owner, {})).notebook;
    const a = await touchNotebookModified(nb.id);
    const b = await touchNotebookModified(nb.id);
    expect(a).not.toBeNull();
    expect(Date.parse(a!)).toBeGreaterThanOrEqual(Date.parse(nb.updated_at));
    expect(Date.parse(b!)).toBeGreaterThan(Date.parse(a!));
    const stored = (await db.pool.query("SELECT updated_at FROM notebooks WHERE id = $1", [nb.id])).rows[0].updated_at as Date;
    expect(stored.toISOString()).toBe(b);
    expect(await touchNotebookModified("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
