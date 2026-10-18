import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATION_0001_PATH = resolve(__dirname, "../migrations/0001_workspace.sql");
const MIGRATION_0003_PATH = resolve(__dirname, "../migrations/0003_chat.sql");

function normalizePostgresSqlForSqlite(sql: string): string {
  return sql
    .replace(/::jsonb/gi, "")
    .replace(/\bTIMESTAMPTZ\b/gi, "TEXT")
    .replace(/\bNOW\(\)/gi, "CURRENT_TIMESTAMP")
    .replace(/\bUUID\b/gi, "TEXT")
    .replace(/\bJSONB\b/gi, "TEXT")
    .replace(/\bBIGINT\b/gi, "INTEGER");
}

describe("C-01, C-02, FR-WM-04: Package 1.3 Persistence Schema (0003_chat.sql)", () => {
  let db: DatabaseSync;

  const validUserId1 = "a0000000-0000-4000-8000-000000000001";
  const validUserId2 = "b0000000-0000-4000-8000-000000000002";
  const validNotebookId1 = "a1111111-1111-4111-8111-111111111111";
  const validNotebookId2 = "b2222222-2222-4222-8222-222222222222";
  const validThreadId1 = "t1111111-1111-4111-8111-111111111111";
  const validThreadId2 = "t2222222-2222-4222-8222-222222222222";
  const validMessageId1 = "m1111111-1111-4111-8111-111111111111";
  const validMessageId2 = "m2222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");

    // Initialize foundational tables from 0001_workspace.sql if present
    if (existsSync(MIGRATION_0001_PATH)) {
      const sql0001 = readFileSync(MIGRATION_0001_PATH, "utf8");
      db.exec(normalizePostgresSqlForSqlite(sql0001));
    }
  });

  describe("1. Migration File Structure & DDL Contracts", () => {
    it("DB-P13-01: 0003_chat.sql migration file must exist and be non-empty", () => {
      expect(existsSync(MIGRATION_0003_PATH)).toBe(true);
      const sql = readFileSync(MIGRATION_0003_PATH, "utf8");
      expect(sql.trim().length).toBeGreaterThan(0);
    });

    it("DB-P13-02: defines chat_threads table with correct columns and constraints", () => {
      const sql = readFileSync(MIGRATION_0003_PATH, "utf8");
      expect(sql).toMatch(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?chat_threads/i);
      expect(sql).toMatch(/id\s+UUID\s+PRIMARY\s+KEY/i);
      expect(sql).toMatch(/notebook_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+notebooks\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i);
      expect(sql).toMatch(/user_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+users\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i);
      expect(sql).toMatch(/generation_epoch\s+INT\s+NOT\s+NULL\s+DEFAULT\s+0/i);
      expect(sql).toMatch(/UNIQUE\s*\(\s*notebook_id\s*,\s*user_id\s*\)/i);
    });

    it("DB-P13-03: defines chat_messages table with correct columns, FKs, and cascade deletion", () => {
      const sql = readFileSync(MIGRATION_0003_PATH, "utf8");
      expect(sql).toMatch(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?chat_messages/i);
      expect(sql).toMatch(/id\s+UUID\s+PRIMARY\s+KEY/i);
      expect(sql).toMatch(/thread_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+chat_threads\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i);
      expect(sql).toMatch(/notebook_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+notebooks\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i);
      expect(sql).toMatch(/user_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+users\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i);
      expect(sql).toMatch(/role\s+VARCHAR\(20\)\s+NOT\s+NULL/i);
      expect(sql).toMatch(/content\s+TEXT\s+NOT\s+NULL/i);
      expect(sql).toMatch(/active_source_revisions_snapshot\s+JSONB\s+NOT\s+NULL/i);
      expect(sql).toMatch(/citations\s+JSONB\s+NOT\s+NULL\s+DEFAULT\s+'\[\]'::jsonb/i);
    });

    it("DB-P13-04: defines composite indexes for fast notebook/user scoping and thread ordering", () => {
      const sql = readFileSync(MIGRATION_0003_PATH, "utf8");
      expect(sql).toMatch(/CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?\w+\s+ON\s+chat_threads\s*\(\s*notebook_id\s*,\s*user_id\s*\)/i);
      expect(sql).toMatch(/CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?\w+\s+ON\s+chat_messages\s*\(\s*thread_id\s*,\s*created_at\s*\)/i);
    });
  });

  describe("2. Relational Schema Invariants & Parent Cascade Semantics", () => {
    function applyMigrationsAndSeedParents() {
      const sql0003 = readFileSync(MIGRATION_0003_PATH, "utf8");
      db.exec(normalizePostgresSqlForSqlite(sql0003));

      // Seed Users
      db.exec(`
        INSERT INTO users (id, subject, issuer, created_at, updated_at)
        VALUES
          ('${validUserId1}', 'usr_sub_1', 'https://accounts.google.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
          ('${validUserId2}', 'usr_sub_2', 'https://accounts.google.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      `);

      // Seed Notebooks
      db.exec(`
        INSERT INTO notebooks (id, owner_id, title, created_at, updated_at)
        VALUES
          ('${validNotebookId1}', '${validUserId1}', 'Notebook 1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
          ('${validNotebookId2}', '${validUserId2}', 'Notebook 2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      `);
    }

    it("DB-P13-05: enforces exactly one thread per (notebook_id, user_id)", () => {
      applyMigrationsAndSeedParents();

      // Insert first thread for (notebook1, user1)
      db.exec(`
        INSERT INTO chat_threads (id, notebook_id, user_id, generation_epoch, created_at, updated_at)
        VALUES ('${validThreadId1}', '${validNotebookId1}', '${validUserId1}', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      `);

      // Attempt to insert second thread for same (notebook1, user1) must violate unique constraint
      expect(() => {
        db.exec(`
          INSERT INTO chat_threads (id, notebook_id, user_id, generation_epoch, created_at, updated_at)
          VALUES ('${validThreadId2}', '${validNotebookId1}', '${validUserId1}', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        `);
      }).toThrow(/UNIQUE constraint failed/i);
    });

    it("DB-P13-06: allows different users to have distinct threads in the same notebook", () => {
      applyMigrationsAndSeedParents();

      // User 1 thread
      db.exec(`
        INSERT INTO chat_threads (id, notebook_id, user_id, generation_epoch, created_at, updated_at)
        VALUES ('${validThreadId1}', '${validNotebookId1}', '${validUserId1}', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      `);

      // User 2 thread in same notebook 1
      db.exec(`
        INSERT INTO chat_threads (id, notebook_id, user_id, generation_epoch, created_at, updated_at)
        VALUES ('${validThreadId2}', '${validNotebookId1}', '${validUserId2}', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      `);

      const rows = db.prepare("SELECT COUNT(*) as count FROM chat_threads WHERE notebook_id = ?").get(validNotebookId1) as { count: number };
      expect(rows.count).toBe(2);
    });

    it("DB-P13-07: cascades thread and message deletion when parent notebook is deleted (FR-WM-04)", () => {
      applyMigrationsAndSeedParents();

      // Create thread and message
      db.exec(`
        INSERT INTO chat_threads (id, notebook_id, user_id, generation_epoch, created_at, updated_at)
        VALUES ('${validThreadId1}', '${validNotebookId1}', '${validUserId1}', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      `);

      db.exec(`
        INSERT INTO chat_messages (id, thread_id, notebook_id, user_id, role, content, active_source_revisions_snapshot, citations, created_at)
        VALUES (
          '${validMessageId1}',
          '${validThreadId1}',
          '${validNotebookId1}',
          '${validUserId1}',
          'user',
          'What is the research summary?',
          '[]',
          '[]',
          CURRENT_TIMESTAMP
        );
      `);

      // Verify records exist
      let threads = db.prepare("SELECT COUNT(*) as count FROM chat_threads WHERE notebook_id = ?").get(validNotebookId1) as { count: number };
      let messages = db.prepare("SELECT COUNT(*) as count FROM chat_messages WHERE notebook_id = ?").get(validNotebookId1) as { count: number };
      expect(threads.count).toBe(1);
      expect(messages.count).toBe(1);

      // Delete parent notebook
      db.exec(`DELETE FROM notebooks WHERE id = '${validNotebookId1}';`);

      // Assert complete cascade: 0 threads and 0 messages remain
      threads = db.prepare("SELECT COUNT(*) as count FROM chat_threads WHERE notebook_id = ?").get(validNotebookId1) as { count: number };
      messages = db.prepare("SELECT COUNT(*) as count FROM chat_messages WHERE notebook_id = ?").get(validNotebookId1) as { count: number };
      expect(threads.count).toBe(0);
      expect(messages.count).toBe(0);
    });

    it("DB-P13-08: supports clearing chat messages while advancing generation_epoch", () => {
      applyMigrationsAndSeedParents();

      // Create thread
      db.exec(`
        INSERT INTO chat_threads (id, notebook_id, user_id, generation_epoch, created_at, updated_at)
        VALUES ('${validThreadId1}', '${validNotebookId1}', '${validUserId1}', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      `);

      // Insert 2 messages
      db.exec(`
        INSERT INTO chat_messages (id, thread_id, notebook_id, user_id, role, content, active_source_revisions_snapshot, citations, created_at)
        VALUES
          ('${validMessageId1}', '${validThreadId1}', '${validNotebookId1}', '${validUserId1}', 'user', 'Q1', '[]', '[]', CURRENT_TIMESTAMP),
          ('${validMessageId2}', '${validThreadId1}', '${validNotebookId1}', '${validUserId1}', 'assistant', 'A1', '[]', '[]', CURRENT_TIMESTAMP);
      `);

      let msgCount = db.prepare("SELECT COUNT(*) as count FROM chat_messages WHERE thread_id = ?").get(validThreadId1) as { count: number };
      expect(msgCount.count).toBe(2);

      // Perform Clear Chat operation: delete messages and increment epoch
      db.exec(`
        DELETE FROM chat_messages WHERE thread_id = '${validThreadId1}';
        UPDATE chat_threads SET generation_epoch = generation_epoch + 1, updated_at = CURRENT_TIMESTAMP WHERE id = '${validThreadId1}';
      `);

      // Verify messages cleared and epoch incremented
      msgCount = db.prepare("SELECT COUNT(*) as count FROM chat_messages WHERE thread_id = ?").get(validThreadId1) as { count: number };
      expect(msgCount.count).toBe(0);

      const thread = db.prepare("SELECT generation_epoch FROM chat_threads WHERE id = ?").get(validThreadId1) as { generation_epoch: number };
      expect(thread.generation_epoch).toBe(1);
    });

    it("DB-P13-09: rolls back transaction on error without partial commit", () => {
      applyMigrationsAndSeedParents();

      db.exec(`
        INSERT INTO chat_threads (id, notebook_id, user_id, generation_epoch, created_at, updated_at)
        VALUES ('${validThreadId1}', '${validNotebookId1}', '${validUserId1}', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      `);

      expect(() => {
        db.exec("BEGIN TRANSACTION;");
        db.exec(`
          INSERT INTO chat_messages (id, thread_id, notebook_id, user_id, role, content, active_source_revisions_snapshot, citations, created_at)
          VALUES ('${validMessageId1}', '${validThreadId1}', '${validNotebookId1}', '${validUserId1}', 'user', 'Valid Msg', '[]', '[]', CURRENT_TIMESTAMP);
        `);
        // Fails with non-existent foreign key thread_id
        db.exec(`
          INSERT INTO chat_messages (id, thread_id, notebook_id, user_id, role, content, active_source_revisions_snapshot, citations, created_at)
          VALUES ('${validMessageId2}', 'non-existent-thread-id', '${validNotebookId1}', '${validUserId1}', 'assistant', 'Fail Msg', '[]', '[]', CURRENT_TIMESTAMP);
        `);
        db.exec("COMMIT;");
      }).toThrow();

      db.exec("ROLLBACK;");

      const msgCount = db.prepare("SELECT COUNT(*) as count FROM chat_messages WHERE thread_id = ?").get(validThreadId1) as { count: number };
      expect(msgCount.count).toBe(0);
    });
  });
});
