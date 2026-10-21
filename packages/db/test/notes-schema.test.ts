import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(resolve(dir, "../migrations", f), "utf8");

function toSqlite(sql: string): string {
  return sql
    .replace(/::jsonb/gi, "")
    .replace(/\bTIMESTAMPTZ\b/gi, "TEXT")
    .replace(/\bNOW\(\)/gi, "CURRENT_TIMESTAMP")
    .replace(/\bUUID\b/gi, "TEXT")
    .replace(/\bJSONB\b/gi, "TEXT")
    .replace(/\bBIGINT\b/gi, "INTEGER");
}

describe("FR-NM-01, FR-NM-02, FR-GC-09: draft v3 notes tables (D16)", () => {
  let db: DatabaseSync;
  const u = "u1";
  const n1 = "n1";

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    // Minimal users/notebooks base: the v1 PostgreSQL schema uses functions SQLite lacks.
    db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, subject TEXT NOT NULL)");
    db.exec("CREATE TABLE notebooks (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL)");
    db.exec(toSqlite(read("v3-draft/notes.sql")));
    db.exec(`INSERT INTO users (id, subject) VALUES ('${u}', 's')`);
    db.exec(`INSERT INTO notebooks (id, owner_id, title) VALUES ('${n1}', '${u}', 'NB')`);
  });

  const insert = (id: string, col = "", val = "") =>
    db.exec(
      `INSERT INTO notes (id, notebook_id, owner_id, title, display_order${col ? ", " + col : ""})
       VALUES ('${id}', '${n1}', '${u}', 'T', 1${val ? ", " + val : ""})`
    );

  it("applies defaults for a manual note", () => {
    insert("a");
    const row = db.prepare("SELECT origin_type, revision, content_md FROM notes WHERE id='a'").get() as Record<string, unknown>;
    expect(row).toMatchObject({ origin_type: "manual", revision: 1, content_md: "" });
  });

  it("rejects unknown origin types and duplicate saved responses", () => {
    expect(() => insert("b", "origin_type", "'bogus'")).toThrow();
    insert("c", "source_message_id", "'m1'");
    expect(() => insert("d", "source_message_id", "'m1'")).toThrow();
  });

  it("cascades with the notebook", () => {
    insert("e");
    db.exec(`DELETE FROM notebooks WHERE id='${n1}'`);
    expect(db.prepare("SELECT COUNT(*) AS c FROM notes").get()).toMatchObject({ c: 0 });
  });
});
