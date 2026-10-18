import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationPath = path.resolve(__dirname, "../migrations/0002_ingestion.sql");

describe("Package 1.2 Persistence & Schema Invariants (C-01, C-02, FR-WM-04)", () => {
  const getMigrationSql = (): string => {
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }
    return fs.readFileSync(migrationPath, "utf-8");
  };

  describe("1. Migration File Existence & Ordering", () => {
    it("DB-12-01: 0002_ingestion.sql migration exists", () => {
      expect(fs.existsSync(migrationPath)).toBe(true);
    });
  });

  describe("2. source_revisions Table & Constraints (FR-SI-01, FR-WM-04)", () => {
    it("DB-12-02: defines source_revisions table with required schema columns", () => {
      const sql = getMigrationSql();
      expect(sql).toMatch(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?source_revisions\s*\(/i);
      expect(sql).toMatch(/notebook_id\s+UUID\s+NOT\s+NULL/i);
      expect(sql).toMatch(/source_id\s+UUID\s+NOT\s+NULL/i);
      expect(sql).toMatch(/revision\s+(INT|INTEGER)\s+NOT\s+NULL/i);
      expect(sql).toMatch(/byte_size\s+(BIGINT|INT|INTEGER)\s+NOT\s+NULL/i);
      expect(sql).toMatch(/word_count\s+(INT|INTEGER)\s+NOT\s+NULL/i);
      expect(sql).toMatch(/created_at\s+TIMESTAMPTZ\s+NOT\s+NULL/i);
    });

    it("DB-12-03: enforces composite primary key on source_revisions", () => {
      const sql = getMigrationSql();
      expect(sql).toMatch(
        /PRIMARY\s+KEY\s*\(\s*notebook_id\s*,\s*source_id\s*,\s*revision\s*\)|PRIMARY\s+KEY\s*\(\s*source_id\s*,\s*revision\s*\)/i
      );
    });

    it("DB-12-04: enforces composite foreign key referencing sources with ON DELETE CASCADE", () => {
      const sql = getMigrationSql();
      // Must enforce composite FK (notebook_id, source_id) referencing sources(notebook_id, id) ON DELETE CASCADE
      // to ensure cross-notebook isolation and cascading deletion
      expect(sql).toMatch(
        /FOREIGN\s+KEY\s*\(\s*notebook_id\s*,\s*source_id\s*\)\s*REFERENCES\s+sources\s*\(\s*notebook_id\s*,\s*id\s*\)\s*ON\s+DELETE\s+CASCADE/i
      );
    });

    it("DB-12-05: enforces nonnegative byte_size, nonnegative word_count, and positive revision", () => {
      const sql = getMigrationSql();
      expect(sql).toMatch(/CHECK\s*\(\s*revision\s*>\s*0\s*\)/i);
      expect(sql).toMatch(/CHECK\s*\(\s*byte_size\s*>=\s*0\s*\)/i);
      expect(sql).toMatch(/CHECK\s*\(\s*word_count\s*>=\s*0\s*\)/i);
    });
  });

  describe("3. document_chunks Table & Constraints (C-01, FR-WM-04)", () => {
    it("DB-12-06: defines document_chunks table with required C-01 columns and private keys", () => {
      const sql = getMigrationSql();
      expect(sql).toMatch(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?document_chunks\s*\(/i);
      expect(sql).toMatch(/chunk_id\s+UUID\s+PRIMARY\s+KEY/i);
      expect(sql).toMatch(/notebook_id\s+UUID\s+NOT\s+NULL/i);
      expect(sql).toMatch(/source_id\s+UUID\s+NOT\s+NULL/i);
      expect(sql).toMatch(/revision\s+(INT|INTEGER)\s+NOT\s+NULL/i);
      expect(sql).toMatch(/sequence\s+(INT|INTEGER)\s+NOT\s+NULL/i);
      expect(sql).toMatch(/token_count\s+(INT|INTEGER)\s+NOT\s+NULL/i);
      expect(sql).toMatch(/text\s+TEXT\s+NOT\s+NULL/i);
      expect(sql).toMatch(/locator\s+JSONB\s+NOT\s+NULL/i);
    });

    it("DB-12-07: enforces foreign key from document_chunks to source_revisions with ON DELETE CASCADE", () => {
      const sql = getMigrationSql();
      expect(sql).toMatch(
        /FOREIGN\s+KEY\s*\(\s*notebook_id\s*,\s*source_id\s*,\s*revision\s*\)\s*REFERENCES\s+source_revisions\s*\(\s*notebook_id\s*,\s*source_id\s*,\s*revision\s*\)\s*ON\s+DELETE\s+CASCADE/i
      );
    });

    it("DB-12-08: enforces non-negative token_count and non-negative sequence", () => {
      const sql = getMigrationSql();
      expect(sql).toMatch(/CHECK\s*\(\s*token_count\s*>=\s*0\s*\)/i);
      expect(sql).toMatch(/CHECK\s*\(\s*sequence\s*>=\s*0\s*\)/i);
    });
  });

  describe("4. Indexes for Fast Scoped Context & Inspector Access (C-02, FR-SI-04)", () => {
    it("DB-12-09: defines composite index on (notebook_id, source_id, revision) for scoped retrieval", () => {
      const sql = getMigrationSql();
      expect(sql).toMatch(
        /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_chunks_scope\s+ON\s+document_chunks\s*\(\s*notebook_id\s*,\s*source_id\s*,\s*revision\s*\)/i
      );
    });

    it("DB-12-10: defines composite index on (notebook_id, chunk_id) for isolated chunk inspector lookup", () => {
      const sql = getMigrationSql();
      expect(sql).toMatch(
        /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_chunks_inspector\s+ON\s+document_chunks\s*\(\s*notebook_id\s*,\s*chunk_id\s*\)/i
      );
    });
  });

  describe("5. Replay and Cancellation Fences (FR-SI-01, FR-WM-04)", () => {
    it("DB-12-11: defines ingestion_attempts fence preventing duplicate processing of the same attempt", () => {
      const sql = getMigrationSql();
      expect(sql).toMatch(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?ingestion_attempts\s*\(/i);
      expect(sql).toMatch(/attempt_id\s+UUID\s+PRIMARY\s+KEY/i);
      expect(sql).toMatch(/source_id\s+UUID\s+NOT\s+NULL/i);
      expect(sql).toMatch(/notebook_id\s+UUID\s+NOT\s+NULL/i);
      expect(sql).toMatch(/status\s+VARCHAR/i);
    });
  });
});
