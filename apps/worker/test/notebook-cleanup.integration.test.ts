import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GcsObjectStorage } from "@everlast/cloud";
import { Storage } from "@google-cloud/storage";
import { createNotebook, deleteNotebook, getCleanupStatus, notebookObjectPrefix, reserveSources } from "@everlast/db";
import { createTestDatabase, createTestUser, type TestDatabase } from "@everlast/db/testing";
import { approvedLiveFixture } from "@everlast/testkit/live-fixtures";
import { processNotebookCleanup } from "../src/notebook-cleanup.ts";
/** [001-workspace-foundation] T046/T060 — FR-WM-01/04, NFR-SEC-01/02.
 * Writes only random notebook prefixes in a pre-created, labelled disposable EU bucket.
 */
describe.skipIf(process.env.WORKSPACE_STORAGE_IT !== "1")("approved real versioned GCS cleanup", () => {
  let db: TestDatabase, bucket: ReturnType<Storage["bucket"]>, storage: GcsObjectStorage;
  const prefixes: string[] = [];
  beforeAll(async () => {
    const fixture = approvedLiveFixture(process.env, "storage");
    const client = new Storage({ projectId: fixture.project });
    bucket = client.bucket(fixture.target);
    const [metadata] = await bucket.getMetadata();
    expect(metadata.labels?.["everlast-fixture"]).toBe("disposable");
    expect(metadata.location?.toLowerCase()).toBe("europe-west4");
    expect(metadata.versioning?.enabled).toBe(true);
    expect(metadata.retentionPolicy, "Do not mutate a bucket with a retention policy").toBeUndefined();
    expect(Number(metadata.softDeletePolicy?.retentionDurationSeconds ?? 0), "Require disabled soft delete so absence means hard purge").toBe(0);
    storage = new GcsObjectStorage({ bucket: fixture.target, storage: client });
    db = await createTestDatabase();
  });
  afterAll(async () => {
    // Never sweep an entire bucket: only prefixes allocated by this process.
    if (storage) for (const prefix of prefixes) for (const v of await storage.listVersions(prefix)) {
      await bucket.file(v.name, { generation: Number(v.generation) }).setMetadata({ temporaryHold: false });
      await storage.deleteVersion(v.name, v.generation);
    }
    await db?.drop();
  });
  it("retains held objects, recovers, waits for active capability expiry and purges all generations privately", async () => {
    const owner = await createTestUser(db.pool);
    const { notebook } = await createNotebook(db.pool, owner, { title: "PRIVATE_FIXTURE_TITLE" });
    const prefix = notebookObjectPrefix(notebook.id); prefixes.push(prefix);
    const name = `${prefix}sources/fixture/raw`;
    const first = await storage.write(name, Buffer.from("private fixture v1"), "text/plain");
    await storage.write(name, Buffer.from("private fixture v2"), "text/plain");
    await bucket.file(name, { generation: Number(first.generation) }).setMetadata({ temporaryHold: true });
    const expires = Date.now() + 31_000;
    await reserveSources(db.pool, owner, notebook.id, [{ attempt_id: crypto.randomUUID(), title: "late.txt", media_type: "text/plain", declared_bytes: 1 }], { uploadTtlSeconds: 30 });
    const late = `${prefix}sources/late/raw`;
    const cap = await storage.createUploadUrl(late, { contentType: "text/plain", maxBytes: 1, expiresAt: new Date(Date.now() + 20_000) });
    const { deletion_id } = await deleteNotebook(db.pool, owner, notebook.id);
    expect(await processNotebookCleanup({ pool: db.pool, storage }, deletion_id)).toMatchObject({ status: "retry", errorCode: "RetainedObject" });
    await bucket.file(name, { generation: Number(first.generation) }).setMetadata({ temporaryHold: false });
    expect(await processNotebookCleanup({ pool: db.pool, storage }, deletion_id)).toMatchObject({ status: "deferred" });
    // A real pending signed PUT may land before expiry; sweep only after it can no longer write.
    const post = await fetch(cap.url, { method: "POST", headers: { ...cap.headers, "x-goog-resumable": "start" }, signal: AbortSignal.timeout(30_000) });
    expect(post.ok, "A PUT capability cannot create an unbounded resumable POST session").toBe(false);
    const put = await fetch(cap.url, { method: "PUT", headers: cap.headers, body: "x", signal: AbortSignal.timeout(30_000) });
    expect(put.ok).toBe(true);
    // Wait for actual signed-capability expiration; never advance only the cleanup clock.
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expires - Date.now())));
    const expired = await fetch(cap.url, { method: "PUT", headers: cap.headers, body: "x", signal: AbortSignal.timeout(30_000) });
    expect(expired.ok).toBe(false);
    expect(await processNotebookCleanup({ pool: db.pool, storage }, deletion_id)).toMatchObject({ status: "purged" });
    expect(await storage.listVersions(prefix)).toEqual([]);
    const status = await getCleanupStatus(db.pool, owner, deletion_id);
    expect(status.status).toBe("Purged");
    expect(JSON.stringify(status)).not.toMatch(/PRIVATE_FIXTURE_TITLE|sources\/|private fixture/);
    await expect(getCleanupStatus(db.pool, await createTestUser(db.pool), deletion_id)).rejects.toThrow();
  }, 120_000);
});
