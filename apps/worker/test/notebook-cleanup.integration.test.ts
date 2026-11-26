import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GcsObjectStorage } from "@everlast/cloud";
import { Storage } from "@google-cloud/storage";
import {
  createNotebook,
  deleteNotebook,
  getCleanupStatus,
  notebookObjectPrefix,
  reserveSources,
} from "@everlast/db";
import { createTestDatabase, createTestUser, type TestDatabase } from "@everlast/db/testing";
import {
  approvedLiveFixture,
  ensureDevEnvironmentForTests,
  type DevEnvironmentLease,
} from "@everlast/testkit/live-fixtures";
import { processNotebookCleanup } from "../src/notebook-cleanup.ts";

/**
 * [001-workspace-foundation] T046/T060 — FR-WM-01/04, NFR-SEC-01/02.
 * Writes only random notebook prefixes in the `dev` EU GCS bucket, cleans them up in `afterAll`,
 * uses an isolated temporary database on the same PostgreSQL instance, and restores `dev` scale-down state.
 */
describe.skipIf(process.env.WORKSPACE_STORAGE_IT !== "1")("dev versioned GCS cleanup", () => {
  type Bucket = ReturnType<Storage["bucket"]>;
  let dbRef: TestDatabase | undefined;
  let bucketRef: Bucket | undefined;
  let storageRef: GcsObjectStorage | undefined;
  let devLease: DevEnvironmentLease | undefined;
  const prefixes: string[] = [];

  beforeAll(async () => {
    devLease = await ensureDevEnvironmentForTests({ env: process.env });
    const fixture = approvedLiveFixture(process.env, "storage");
    const client = new Storage({ projectId: fixture.project });
    const bucket = client.bucket(fixture.target);
    bucketRef = bucket;
    const [metadata] = await bucket.getMetadata();
    expect(metadata.location?.toLowerCase()).toBe("europe-west4");
    expect(metadata.versioning?.enabled).toBe(true);
    storageRef = new GcsObjectStorage({ bucket: fixture.target, storage: client });
    dbRef = await createTestDatabase();
  });

  function liveFixture(): { db: TestDatabase; bucket: Bucket; storage: GcsObjectStorage } {
    if (!dbRef || !bucketRef || !storageRef) throw new Error("live fixture not initialised");
    return { db: dbRef, bucket: bucketRef, storage: storageRef };
  }

  afterAll(async () => {
    // Never sweep an entire bucket: remove only prefixes allocated by this test run.
    if (storageRef && bucketRef) {
      for (const prefix of prefixes) {
        for (const v of await storageRef.listVersions(prefix)) {
          await bucketRef
            .file(v.name, { generation: Number(v.generation) })
            .setMetadata({ temporaryHold: false })
            .catch(() => undefined);
          await storageRef.deleteVersion(v.name, v.generation);
        }
      }
    }
    await dbRef?.drop();
    await devLease?.restore();
  });

  it("retains held objects, recovers, waits for active capability expiry and purges all generations privately", async () => {
    const { db, bucket, storage } = liveFixture();
    const owner = await createTestUser(db.pool);
    const other = await createTestUser(db.pool);
    const { notebook: otherNotebook } = await createNotebook(db.pool, other, {
      title: "OTHER_FIXTURE_TITLE",
    });
    const otherPrefix = notebookObjectPrefix(otherNotebook.id);
    prefixes.push(otherPrefix);
    await storage.write(
      `${otherPrefix}sources/fixture/raw`,
      Buffer.from("other user fixture"),
      "text/plain",
    );

    const { notebook } = await createNotebook(db.pool, owner, { title: "PRIVATE_FIXTURE_TITLE" });
    const prefix = notebookObjectPrefix(notebook.id);
    prefixes.push(prefix);
    const name = `${prefix}sources/fixture/raw`;
    const first = await storage.write(name, Buffer.from("private fixture v1"), "text/plain");
    await storage.write(name, Buffer.from("private fixture v2"), "text/plain");
    await bucket
      .file(name, { generation: Number(first.generation) })
      .setMetadata({ temporaryHold: true });

    const expires = Date.now() + 6_000;
    await reserveSources(
      db.pool,
      owner,
      notebook.id,
      [
        {
          attempt_id: crypto.randomUUID(),
          title: "late.txt",
          media_type: "text/plain",
          declared_bytes: 1,
        },
      ],
      { uploadTtlSeconds: 5 },
    );
    const late = `${prefix}sources/late/raw`;
    const cap = await storage.createUploadUrl(late, {
      contentType: "text/plain",
      maxBytes: 1,
      expiresAt: new Date(Date.now() + 4_000),
    });

    const { deletion_id } = await deleteNotebook(db.pool, owner, notebook.id);
    expect(await processNotebookCleanup({ pool: db.pool, storage }, deletion_id)).toMatchObject({
      status: "retry",
      errorCode: "RetainedObject",
    });

    await bucket
      .file(name, { generation: Number(first.generation) })
      .setMetadata({ temporaryHold: false });
    expect(await processNotebookCleanup({ pool: db.pool, storage }, deletion_id)).toMatchObject({
      status: "deferred",
    });

    // A pending signed PUT may land before expiry; sweep only after it can no longer write.
    const post = await fetch(cap.url, {
      method: "POST",
      headers: { ...cap.headers, "x-goog-resumable": "start" },
      signal: AbortSignal.timeout(30_000),
    });
    expect(post.ok, "A PUT capability cannot create an unbounded resumable POST session").toBe(
      false,
    );

    const put = await fetch(cap.url, {
      method: "PUT",
      headers: cap.headers,
      body: "x",
      signal: AbortSignal.timeout(30_000),
    });
    expect(put.ok).toBe(true);

    // Wait for actual signed-capability expiration; never advance only the cleanup clock.
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, expires - Date.now())));
    const expired = await fetch(cap.url, {
      method: "PUT",
      headers: cap.headers,
      body: "x",
      signal: AbortSignal.timeout(30_000),
    });
    expect(expired.ok).toBe(false);

    expect(await processNotebookCleanup({ pool: db.pool, storage }, deletion_id)).toMatchObject({
      status: "purged",
    });
    expect(await storage.listVersions(prefix)).toEqual([]);

    const status = await getCleanupStatus(db.pool, owner, deletion_id);
    expect(status.status).toBe("Purged");
    expect(JSON.stringify(status)).not.toMatch(/PRIVATE_FIXTURE_TITLE|sources\/|private fixture/);
    expect(
      (await storage.listVersions(otherPrefix)).length,
      "second user's objects are untouched",
    ).toBe(1);
    await expect(
      getCleanupStatus(db.pool, await createTestUser(db.pool), deletion_id),
    ).rejects.toThrow();
  }, 60_000);
});
