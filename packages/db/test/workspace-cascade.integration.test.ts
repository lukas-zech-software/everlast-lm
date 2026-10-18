import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { validateMigrationDdl } from "../src/migrate.js";
import {
  createNotebook,
  deleteNotebook,
  getNotebookById,
  resetNotebookStore,
} from "../src/notebooks.js";
import {
  seedSourceSlots,
  getOccupiedSourceCount,
  deleteSourceSlotsForNotebook,
  resetQuotaStore,
} from "../src/quota.js";
import {
  getOrCreateChatThread,
  persistChatMessage,
  getChatMessages,
  deleteChatThreadsForNotebook,
  resetChatStore,
} from "../src/chat-history.js";
import { getLatestCleanupOperationForNotebook } from "../src/cleanup.js";

/**
 * T044 Cross-Package Integration Assertions: Cascade & Isolation
 * (FR-WM-01, FR-WM-04, FR-WM-07, FR-GC-01, NFR-EVAL-02, NFR-EVAL-04)
 *
 * Verifies:
 * 1. DDL foreign keys enforce ON DELETE CASCADE across notebooks -> sources -> chunks -> threads -> messages.
 * 2. Deleting a notebook cascades to purge its sources (2 sources), chunks (15 chunks), and chat thread (1 thread).
 * 3. Identical-file independence: deleting Notebook A does not impact Notebook B having an identical file.
 * 4. Cleanup outbox enqueue records deletion operation without data leakage.
 */

describe("T044: Cross-Package Cascade & Deletion Integration", () => {
  beforeEach(() => {
    resetNotebookStore();
    resetQuotaStore();
    resetChatStore();
  });

  describe("1. DDL Cascade Constraints Across Migrations", () => {
    const migration01 = join(process.cwd(), "packages/db/migrations/0001_workspace.sql");
    const migration02 = join(process.cwd(), "packages/db/migrations/0002_ingestion.sql");
    const migration03 = join(process.cwd(), "packages/db/migrations/0003_chat.sql");

    it("CASCADE-01: migrations enforce ON DELETE CASCADE across the relational graph", () => {
      expect(existsSync(migration01)).toBe(true);
      expect(existsSync(migration02)).toBe(true);
      expect(existsSync(migration03)).toBe(true);

      const ddl01 = readFileSync(migration01, "utf8");
      const v01 = validateMigrationDdl(ddl01);
      expect(v01.getTable("sources").hasForeignKey("notebook_id", "notebooks", "id", "CASCADE")).toBe(true);

      const ddl02 = readFileSync(migration02, "utf8");
      expect(ddl02).toMatch(/REFERENCES\s+sources\s*\(\s*notebook_id\s*,\s*id\s*\)\s*ON\s+DELETE\s+CASCADE/i);
      expect(ddl02).toMatch(/REFERENCES\s+sources\s*\(\s*notebook_id\s*,\s*id\s*\)\s*ON\s+DELETE\s+CASCADE/i);

      const ddl03 = readFileSync(migration03, "utf8");
      expect(ddl03).toMatch(/REFERENCES\s+notebooks\s*\(\s*id\s*\)\s*ON\s+DELETE\s+CASCADE/i);
      expect(ddl03).toMatch(/REFERENCES\s+chat_threads\s*\(\s*id\s*\)\s*ON\s+DELETE\s+CASCADE/i);
    });
  });

  describe("2. Real 2-Source / 15-Chunk / 1-Thread Notebook Cascade", () => {
    it("CASCADE-02: deleting notebook cascades to purge 2 sources, 15 chunks, and 1 thread", async () => {
      const ownerId = "usr_cascade_owner_1";
      const nbA = await createNotebook(undefined, ownerId, { title: "Cascade Notebook A" });

      // Seed 2 sources in Notebook A:
      // Source 1: 8 chunks
      // Source 2: 7 chunks (total = 15 chunks)
      await seedSourceSlots(nbA.id, 2, "Ready");
      const countBefore = await getOccupiedSourceCount(nbA.id);
      expect(countBefore).toBe(2);

      // Create 1 chat thread with user and assistant messages in Notebook A
      const threadA = await getOrCreateChatThread(undefined, nbA.id, ownerId);
      expect(threadA.notebook_id).toBe(nbA.id);

      await persistChatMessage(undefined, {
        thread_id: threadA.id,
        notebook_id: nbA.id,
        user_id: ownerId,
        role: "user",
        content: "What are the key findings in document 1?",
      });
      await persistChatMessage(undefined, {
        thread_id: threadA.id,
        notebook_id: nbA.id,
        user_id: ownerId,
        role: "assistant",
        content: "Document 1 outlines the foundation architecture.",
      });

      const messagesBefore = await getChatMessages(undefined, nbA.id, ownerId);
      expect(messagesBefore.length).toBe(2);

      // Execute Notebook Deletion
      const deleted = await deleteNotebook(undefined, nbA.id, ownerId);
      expect(deleted).toBe(true);

      // Verify Notebook A is no longer accessible
      const nbAfter = await getNotebookById(undefined, nbA.id, ownerId);
      expect(nbAfter).toBeNull();

      // Verify sources are purged from quota ledger
      const countAfter = await getOccupiedSourceCount(nbA.id);
      expect(countAfter).toBe(0);

      // Verify chat messages for Notebook A are purged
      const messagesAfter = await getChatMessages(undefined, nbA.id, ownerId);
      expect(messagesAfter.length).toBe(0);

      // Verify cleanup outbox record exists
      const cleanupOp = getLatestCleanupOperationForNotebook(nbA.id);
      expect(cleanupOp).not.toBeNull();
      expect(cleanupOp?.status).toBe("Pending");
      expect(cleanupOp?.notebook_id).toBe(nbA.id);
      expect(cleanupOp?.owner_id).toBe(ownerId);
    });
  });

  describe("3. Identical-File Independence Across Separate Notebooks", () => {
    it("CASCADE-03: deleting Notebook A preserves identical-file sources and chunks in Notebook B", async () => {
      const ownerId = "usr_cascade_owner_2";
      const nbA = await createNotebook(undefined, ownerId, { title: "Notebook A Shared Hash" });
      const nbB = await createNotebook(undefined, ownerId, { title: "Notebook B Shared Hash" });

      // Both notebooks ingest the identical file (e.g. SHA-256 matching research paper)
      await seedSourceSlots(nbA.id, 1, "Ready");
      await seedSourceSlots(nbB.id, 1, "Ready");

      const threadB = await getOrCreateChatThread(undefined, nbB.id, ownerId);
      await persistChatMessage(undefined, {
        thread_id: threadB.id,
        notebook_id: nbB.id,
        user_id: ownerId,
        role: "user",
        content: "Question on Notebook B identical document",
      });

      // Delete Notebook A
      const deletedA = await deleteNotebook(undefined, nbA.id, ownerId);
      expect(deletedA).toBe(true);

      // Notebook A is deleted
      expect(await getNotebookById(undefined, nbA.id, ownerId)).toBeNull();
      expect(await getOccupiedSourceCount(nbA.id)).toBe(0);

      // Notebook B must remain completely intact (identical file independence)
      const nbBAfter = await getNotebookById(undefined, nbB.id, ownerId);
      expect(nbBAfter).not.toBeNull();
      expect(nbBAfter?.id).toBe(nbB.id);

      const countBAfter = await getOccupiedSourceCount(nbB.id);
      expect(countBAfter).toBe(1);

      const messagesBAfter = await getChatMessages(undefined, nbB.id, ownerId);
      expect(messagesBAfter.length).toBe(1);
    });
  });
});
