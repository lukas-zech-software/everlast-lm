import pg from "pg";
import { GoogleAuth } from "google-auth-library";
import type { Pool, PoolClient, PoolConfig, QueryResultRow } from "pg";
import { AppError } from "@everlast/contracts";

/**
 * Cloud SQL PostgreSQL access, transactions and lock hierarchy (FR-WM-01, FR-WM-04, FR-WM-07, D4).
 * Universal lock order: users (owner) -> notebooks -> sources, always via row locks inside one transaction.
 */

export const LOCK_ORDER_HIERARCHY = ["users", "notebooks", "sources"] as const;

export type LockableEntity = (typeof LOCK_ORDER_HIERARCHY)[number];

/** Anything that can run a parameterized query: a Pool or a transaction-bound PoolClient. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<pg.QueryResult<R>>;
}

// BIGINT columns (byte sizes) fit in a JS number for the 200,000,000-byte ceiling.
pg.types.setTypeParser(20, (value: string) => Number(value));

/**
 * Pool configuration. On Cloud Run (CLOUD_SQL_CONNECTION_NAME) the service connects through the Cloud SQL
 * unix socket with IAM database authentication: the password is a short-lived OAuth access token of the
 * service account (keyless, Constitution VI). Locally DATABASE_URL or PG* variables are used.
 */
export function databaseConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  if (env.CLOUD_SQL_CONNECTION_NAME) {
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/sqlservice.login"] });
    return {
      host: `/cloudsql/${env.CLOUD_SQL_CONNECTION_NAME}`,
      user: env.POSTGRES_USER,
      database: env.POSTGRES_DB ?? "everlast",
      password: async () => (await auth.getAccessToken()) ?? "",
      max: Number(env.PGPOOL_MAX ?? 10),
      idleTimeoutMillis: 10_000,
      // Cold start: socket setup + IAM token login can exceed 10 s (dev deployment 2026-10-20).
      connectionTimeoutMillis: 30_000,
    };
  }
  const url = env.DATABASE_URL;
  const base: PoolConfig = url
    ? { connectionString: url }
    : {
        host: env.PGHOST ?? "127.0.0.1",
        port: Number(env.PGPORT ?? 5432),
        database: env.PGDATABASE ?? "everlast",
        user: env.PGUSER ?? "everlast",
        ...(env.PGPASSWORD !== undefined ? { password: env.PGPASSWORD } : {}),
      };
  return {
    ...base,
    max: Number(env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  };
}

export function createPool(config: PoolConfig = databaseConfigFromEnv()): Pool {
  return new pg.Pool(config);
}

const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]); // serialization_failure, deadlock_detected

export class RetryableFailureError extends AppError {
  constructor(message = "Transient database conflict; retry the request") {
    super("RetryableFailure", 503, message);
    this.name = "RetryableFailureError";
  }
}

export interface TransactionOptions {
  retries?: number;
}

/**
 * Runs `fn` in one transaction. Transient conflicts are retried a bounded number of times and then surface
 * as a stable retryable error, never as a partial mutation.
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const retries = options.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      const sqlState = (err as { code?: string }).code;
      if (sqlState && RETRYABLE_SQLSTATES.has(sqlState)) {
        if (attempt < retries) continue;
        throw new RetryableFailureError();
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

export function toIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
