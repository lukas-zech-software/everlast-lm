import { describe, it, expect, beforeEach } from "vitest";
import {
  processNotebookCleanup,
  executeCleanupTask,
  type CleanupJobPayload,
} from "../src/notebook-cleanup.js";
import { InMemoryStorageEmulator } from "./storage-fixtures.js";

describe("FR-WM-01 / FR-WM-04: Idempotent Notebook Cleanup Worker", () => {
  let emulator: InMemoryStorageEmulator;
  const bucket = "everlast-test-content-bucket";
  const notebookId = "a1111111-1111-4111-8111-111111111111";
  const ownerId = "usr_subject_alpha_123";

  beforeEach(() => {
    emulator = new InMemoryStorageEmulator();
  });

  it("CLN-01: purges all live and noncurrent object generations for the deleted notebook", async () => {
    // Add multiple generations of raw and derived objects
    const prefix = `${ownerId}/${notebookId}`;
    emulator.addObject(bucket, `${prefix}/sources/src1/raw.pdf`, 1024);
    emulator.addObject(bucket, `${prefix}/sources/src1/raw.pdf`, 1024); // gen 2
    emulator.addObject(bucket, `${prefix}/sources/src2/doc.txt`, 512);

    const initialGens = emulator.getGenerations(bucket, prefix);
    expect(initialGens.length).toBe(3);

    const payload: CleanupJobPayload = {
      operationId: "op-1",
      notebookId,
      ownerId,
      bucket,
    };

    const result = await executeCleanupTask(payload, emulator as any);
    expect(result.status).toBe("Purged");
    expect(result.objectsDeleted).toBe(3);

    // Verify all generations are deleted
    const remainingGens = emulator.getGenerations(bucket, prefix);
    expect(remainingGens.length).toBe(0);
  });

  it("CLN-02: execution is idempotent; replay / retry drain completes safely without error", async () => {
    const prefix = `${ownerId}/${notebookId}`;
    emulator.addObject(bucket, `${prefix}/sources/src1/file.pdf`, 2048);

    const payload: CleanupJobPayload = {
      operationId: "op-2",
      notebookId,
      ownerId,
      bucket,
    };

    // First execution
    const res1 = await executeCleanupTask(payload, emulator as any);
    expect(res1.status).toBe("Purged");

    // Replay / duplicate execution
    const res2 = await executeCleanupTask(payload, emulator as any);
    expect(res2.status).toBe("Purged");
    expect(res2.objectsDeleted).toBe(0);
  });

  it("CLN-03: cancels active resumable upload sessions for the deleted notebook", async () => {
    const prefix = `${ownerId}/${notebookId}`;
    emulator.createResumableSession(bucket, `${prefix}/sources/uploading-file.pdf`, "session-123");
    expect(emulator.getActiveSessionsCount(bucket, prefix)).toBe(1);

    const payload: CleanupJobPayload = {
      operationId: "op-3",
      notebookId,
      ownerId,
      bucket,
    };

    await executeCleanupTask(payload, emulator as any);
    expect(emulator.getActiveSessionsCount(bucket, prefix)).toBe(0);
  });

  it("CLN-04: storage failures keep status non-terminal and never mark Purged prematurely", async () => {
    const failingEmulator = {
      purgeAllGenerations: () => {
        throw new Error("GCS connection timeout");
      },
      cancelResumableSession: () => false,
      getActiveSessionsCount: () => 0,
    };

    const payload: CleanupJobPayload = {
      operationId: "op-4",
      notebookId,
      ownerId,
      bucket,
    };

    const result = await executeCleanupTask(payload, failingEmulator as any);
    expect(result.status).toBe("Failed");
    expect(result.status).not.toBe("Purged");
    expect(result.lastError).toMatch(/GCS connection timeout/i);
  });

  it("CLN-05: cleanup result and status logs contain no raw document source content", async () => {
    const prefix = `${ownerId}/${notebookId}`;
    emulator.addObject(bucket, `${prefix}/secret.txt`, 100);

    const payload: CleanupJobPayload = {
      operationId: "op-5",
      notebookId,
      ownerId,
      bucket,
    };

    const result = await executeCleanupTask(payload, emulator as any);
    const jsonStr = JSON.stringify(result);
    expect(jsonStr).not.toContain("secret.txt");
    expect(jsonStr).not.toContain("raw content");
  });
});
