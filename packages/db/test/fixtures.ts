import pg from "pg";
const { Pool } = pg;
import type { Pool as PoolType, PoolClient } from "pg";

/**
 * Isolated Database Test Fixtures and Helpers (FR-WM-01, FR-WM-04, FR-WM-07).
 * Connects to isolated test database with distinct test database prefixes and zero credentials.
 */

export interface TestDbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
}

export function getTestDbConfig(): TestDbConfig {
  return {
    host: process.env.PGHOST || "127.0.0.1",
    port: parseInt(process.env.PGPORT || "5432", 10),
    database: process.env.TEST_DB_NAME || `everlast_test_${process.pid}`,
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "",
  };
}

export function createTestPool(configOverrides?: Partial<TestDbConfig>): PoolType {
  const config = { ...getTestDbConfig(), ...configOverrides };
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: 10,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 3000,
  });
}

export async function resetTestDb(pool: PoolType): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    // Clean up in reverse dependency order
    await client.query("DROP TABLE IF EXISTS cleanup_outbox CASCADE;");
    await client.query("DROP TABLE IF EXISTS sources CASCADE;");
    await client.query("DROP TABLE IF EXISTS notebooks CASCADE;");
    await client.query("DROP TABLE IF EXISTS users CASCADE;");
    await client.query("DROP TABLE IF EXISTS schema_migrations CASCADE;");
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface SeededWorkspaceState {
  ownerAlphaId: string;
  ownerBetaId: string;
  notebookAlphaId: string;
  notebookBetaId: string;
}

export async function seedIsolationFixtures(pool: PoolType): Promise<SeededWorkspaceState> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    const ownerAlphaId = "a0000000-0000-4000-8000-000000000001";
    const ownerBetaId = "b0000000-0000-4000-8000-000000000002";
    const notebookAlphaId = "a1111111-1111-4111-8111-111111111111";
    const notebookBetaId = "b2222222-2222-4222-8222-222222222222";

    // Insert Users
    await client.query(
      `INSERT INTO users (id, subject, email, created_at)
       VALUES ($1, $2, $3, NOW()), ($4, $5, $6, NOW())
       ON CONFLICT (id) DO NOTHING;`,
      [
        ownerAlphaId, "usr_subject_alpha_isolated", "alpha@example.internal",
        ownerBetaId, "usr_subject_beta_isolated", "beta@example.internal",
      ]
    );

    // Insert Notebooks
    await client.query(
      `INSERT INTO notebooks (id, owner_id, title, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()), ($4, $5, $6, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING;`,
      [
        notebookAlphaId, ownerAlphaId, "Project Alpha Secret Research",
        notebookBetaId, ownerBetaId, "Project Beta Public Operations",
      ]
    );

    await client.query("COMMIT");

    return {
      ownerAlphaId,
      ownerBetaId,
      notebookAlphaId,
      notebookBetaId,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
