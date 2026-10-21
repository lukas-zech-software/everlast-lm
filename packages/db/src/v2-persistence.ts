import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool } from "pg";

/**
 * Store selection for the release v2 stores (DEV-04 closed by specs/013, D16). The API runs every request and
 * every v2 background task inside `runWithV2Persistence(pool, …)`, so all v2 store functions read and write that
 * app's PostgreSQL database. `configureV2Persistence` sets a process default (store-level tests). With neither,
 * the stores use their in-memory path: the TEST-ONLY double for suites that run without a database.
 */

const scope = new AsyncLocalStorage<Pool>();
let defaultPool: Pool | null = null;

export function configureV2Persistence(next: Pool | null): void {
  defaultPool = next;
}

/** Runs `fn` (and every async continuation it starts) with v2 stores bound to `pool`. */
export function runWithV2Persistence<T>(pool: Pool, fn: () => T): T {
  return scope.run(pool, fn);
}

export function v2Pool(): Pool | null {
  return scope.getStore() ?? defaultPool;
}
