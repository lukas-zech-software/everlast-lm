import type { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import {
  allowV2MemoryStores,
  configureV2Persistence,
  runWithV2Persistence,
  V2PersistenceUnboundError,
  v2Pool,
} from "../src/v2-persistence.ts";
import { getNotebookMetadata } from "../src/workspace-preferences.ts";

/** Grill F8a, D16: v2 stores never silently fall back to memory outside an explicit test opt-in. */
describe("D16 v2 persistence selection", () => {
  const pool = { query: () => Promise.reject(new Error("unused")) } as unknown as Pool;
  afterEach(() => {
    allowV2MemoryStores(false);
    configureV2Persistence(null);
  });

  it("V2P-01 v2Pool throws when nothing is bound and memory is not allowed", () => {
    allowV2MemoryStores(false);
    expect(() => v2Pool()).toThrow(V2PersistenceUnboundError);
  });

  it("V2P-02 a scoped pool wins", () => {
    allowV2MemoryStores(false);
    expect(runWithV2Persistence(pool, () => v2Pool())).toBe(pool);
  });

  it("V2P-03 the configured default pool is used outside a scope", () => {
    configureV2Persistence(pool);
    expect(v2Pool()).toBe(pool);
  });

  it("V2P-04 explicit memory opt-in returns null", () => {
    allowV2MemoryStores(true);
    expect(v2Pool()).toBeNull();
  });

  it("V2P-06 allowV2MemoryStores returns the previous setting", () => {
    expect(allowV2MemoryStores(true)).toBe(false);
    expect(allowV2MemoryStores(false)).toBe(true);
  });

  it("V2P-05 a store call fails closed", async () => {
    allowV2MemoryStores(false);
    await expect(getNotebookMetadata("n1")).rejects.toBeInstanceOf(V2PersistenceUnboundError);
  });
});
