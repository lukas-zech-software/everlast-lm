import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool } from "pg";

/**
 * Store selection for the release v2 stores (DEV-04 closed by specs/013, D16). The API runs every request and
 * every v2 background task inside `runWithV2Persistence(pool, …)`, so all v2 store functions read and write that
 * app's PostgreSQL database. `configureV2Persistence` sets a process default (store-level tests). With neither,
 * `v2Pool()` fails closed (grill F8a): the in-memory path is a TEST-ONLY double that DB-free test files and the
 * DB-free eval harness enable explicitly with `allowV2MemoryStores()`.
 */

const scope = new AsyncLocalStorage<Pool>();
let defaultPool: Pool | null = null;
let memoryAllowed = false;

export class V2PersistenceUnboundError extends Error {
  constructor() {
    super("v2 stores ran outside runWithV2Persistence and no pool is configured (D16)");
    this.name = "V2PersistenceUnboundError";
  }
}

export function configureV2Persistence(next: Pool | null): void {
  defaultPool = next;
}

/**
 * TEST-ONLY: lets v2 stores use their in-memory double when no pool is bound; DB-free tests and the DB-free eval
 * harness opt in explicitly. Production never calls this. Returns the previous setting so callers can restore it.
 */
export function allowV2MemoryStores(allowed = true): boolean {
  const previous = memoryAllowed;
  memoryAllowed = allowed;
  return previous;
}

/** Runs `fn` (and every async continuation it starts) with v2 stores bound to `pool`. */
export function runWithV2Persistence<T>(pool: Pool, fn: () => T): T {
  return scope.run(pool, fn);
}

export function v2Pool(): Pool | null {
  const pool = scope.getStore() ?? defaultPool;
  if (pool) return pool;
  if (memoryAllowed) return null;
  throw new V2PersistenceUnboundError();
}
