import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InvalidScopeError } from "@everlast/contracts";
import { HashingTestEmbedder } from "@everlast/cloud";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "@everlast/db/testing";
import { createNotebook, retrieveScopedChunks, captureScopeSnapshot } from "@everlast/db";

/**
 * T027/T030 — deterministic NFR-EVAL-04 isolation evals from packages/evals/fixtures/workspace-isolation.json,
 * executed against the real C-02 scope guard and hybrid retrieval (FR-WM-04).
 */

interface Fixture {
  users: { id: string; subject: string }[];
  notebooks: { id: string; owner_id: string; title: string }[];
  sources: { id: string; notebook_id: string; title: string }[];
  chunks: { source_id: string; text: string }[];
  isolation_test_cases: { case_id: string; request: { notebook_id: string; active_source_ids: string[]; query?: string }; forbidden_token?: string; expected_error?: string }[];
}

const fixture = JSON.parse(readFileSync(new URL("../fixtures/workspace-isolation.json", import.meta.url), "utf8")) as Fixture;
const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
let db: TestDatabase;
const ids = new Map<string, string>();
const owners = new Map<string, string>();

beforeAll(async () => {
  db = await createTestDatabase();
  for (const user of fixture.users) owners.set(user.id, await createTestUser(db.pool, user.subject));
  for (const nb of fixture.notebooks) ids.set(nb.id, (await createNotebook(db.pool, owners.get(nb.owner_id)!, { title: nb.title })).notebook.id);
  for (const source of fixture.sources) {
    const nb = fixture.notebooks.find((n) => n.id === source.notebook_id)!;
    const text = fixture.chunks.filter((c) => c.source_id === source.id).map((c) => c.text).join("\n\n") || source.title;
    const seeded = await seedReadySource(db.pool, owners.get(nb.owner_id)!, ids.get(nb.id)!, { title: source.title, pages: [text], embed: (t) => embedder.embed(t) });
    ids.set(source.id, seeded.sourceId);
  }
});

afterAll(async () => {
  await db?.drop();
});

describe("NFR-EVAL-04 workspace isolation fixtures", () => {
  for (const tc of fixture.isolation_test_cases) {
    it(`${tc.case_id}`, async () => {
      const nb = fixture.notebooks.find((n) => n.id === tc.request.notebook_id)!;
      const owner = owners.get(nb.owner_id)!;
      const request = () => captureScopeSnapshot(db.pool, owner, ids.get(nb.id)!, tc.request.active_source_ids.map((s) => ids.get(s)!));
      if (tc.expected_error) {
        await expect(request()).rejects.toBeInstanceOf(InvalidScopeError);
        return;
      }
      const snapshot = await request();
      const query = tc.request.query ?? "";
      const chunks = await retrieveScopedChunks(db.pool, snapshot, { queryText: query, queryEmbedding: (await embedder.embed([query]))[0]! });
      const allowed = new Set(snapshot.sources.map((p) => p.source_id));
      expect(chunks.every((c) => allowed.has(c.source_id))).toBe(true);
      if (tc.forbidden_token) expect(JSON.stringify(chunks)).not.toContain(tc.forbidden_token);
    });
  }

  it("ISO-CANARY: the OMEGA-991 canary is retrievable in its own notebook (control) but never in another", async () => {
    const alphaNb = fixture.notebooks[0]!;
    const alphaSources = fixture.sources.filter((s) => s.notebook_id === alphaNb.id).map((s) => ids.get(s.id)!);
    const snapshot = await captureScopeSnapshot(db.pool, owners.get(alphaNb.owner_id)!, ids.get(alphaNb.id)!, alphaSources);
    const chunks = await retrieveScopedChunks(db.pool, snapshot, { queryText: "OMEGA-991", queryEmbedding: (await embedder.embed(["OMEGA-991"]))[0]! });
    expect(JSON.stringify(chunks)).toContain("OMEGA-991");
  });
});
