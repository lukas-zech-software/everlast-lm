import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

/**
 * Ordered SQL migration runner (FR-WM-01, FR-WM-04, FR-WM-07). Each file applies once, in its own
 * transaction, under a cluster-wide advisory lock so concurrent instances cannot race.
 */

const MIGRATION_LOCK_KEY = 4_217_001; // arbitrary constant advisory-lock key

export function getMigrationsDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
}

export function getAvailableMigrations(): string[] {
  return readdirSync(getMigrationsDirectory())
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort()
    .map((file) => join(getMigrationsDirectory(), file));
}

export async function runMigrations(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    for (const file of getAvailableMigrations()) {
      const version = file.split("/").pop()!;
      const done = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version]);
      if ((done.rowCount ?? 0) > 0) continue;
      await client.query("BEGIN");
      try {
        await client.query(readFileSync(file, "utf8"));
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
        await client.query("COMMIT");
        applied.push(version);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${version} failed: ${(err as Error).message}`);
      }
    }
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
