import type { PoolClient, Pool } from "pg";

/**
 * Transaction helper and lock hierarchy manager (FR-WM-01, FR-WM-04, FR-WM-07).
 * Universal lock hierarchy: users (owner) -> notebooks -> sources.
 */

export const LOCK_ORDER_HIERARCHY = ["users", "notebooks", "sources"] as const;

export type LockableEntity = (typeof LOCK_ORDER_HIERARCHY)[number];

export function acquireOrderedLocks(requestedTables: string[]): string[] {
  let lastIndex = -1;
  for (const table of requestedTables) {
    const currentIndex = LOCK_ORDER_HIERARCHY.indexOf(table as LockableEntity);
    if (currentIndex === -1) {
      continue;
    }
    if (currentIndex < lastIndex) {
      throw new Error(
        `Lock order violation: must lock in order users -> notebooks -> sources, attempted: ${requestedTables.join(" -> ")}`
      );
    }
    lastIndex = currentIndex;
  }
  return requestedTables;
}

export interface TransactionScope {
  client: PoolClient;
}

export async function withTransaction<T>(
  pool: Pool,
  fn: (scope: TransactionScope) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn({ client });
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
