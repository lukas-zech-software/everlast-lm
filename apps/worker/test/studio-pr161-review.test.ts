import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalObjectStorage } from "@everlast/cloud";
import {
  StudioPluginRegistry,
  STUDIO_MINDMAP_PLUGIN_TYPE,
  type StudioGenerationContext,
  type StudioGenerationOutcome,
  type StudioGeneratorPlugin,
} from "@everlast/contracts";
import { createNotebook, PostgresStudioArtifactRepository } from "@everlast/db";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "@everlast/db/testing";
import { createWorkerHandler } from "../src/server.ts";
import { StudioJobRunner } from "../src/studio/runner.ts";

/** [011-studio-mindmaps-data-tables] PR #161 review — durable Studio recovery and lease fencing (FR-017, SC-011). */
let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => db?.drop());

async function seed() {
  const owner = await createTestUser(db.pool);
  const nb = (await createNotebook(db.pool, owner, { title: "PR161" })).notebook.id;
  const src = await seedReadySource(db.pool, owner, nb, {
    title: "Consensus.txt",
    mediaType: "text/plain",
    pages: ["Raft uses leader leases. Paxos uses ballots. Both reach consensus among replicas."],
    embed: async (texts) => texts.map(() => new Array(768).fill(0.01)),
  });
  return { owner, nb, snapshot: [{ source_id: src.sourceId, revision: 1 }] };
}

describe("[011-studio-mindmaps-data-tables] review: the worker consumes the studio outbox by default (FR-017)", () => {
  it("a queued mindmap whose API process died is completed by the worker drain", async () => {
    const { owner, nb, snapshot } = await seed();
    const repo = new PostgresStudioArtifactRepository(db.pool);
    const row = await repo.createQueued({ notebook_id: nb, owner_id: owner, plugin_type: "mindmap", subtype: "default", title: "Map", params_json: {}, snapshot });
    const storage = new LocalObjectStorage({ root: await mkdtemp(join(tmpdir(), "pr161-")), publicBaseUrl: "http://127.0.0.1" });
    const worker = createWorkerHandler({ pool: db.pool, storage });
    await worker.drain();
    expect((await repo.getById(row.id))!.status).toBe("Completed");
    const jobs = await db.pool.query("SELECT status FROM jobs WHERE kind = 'studio' AND payload->>'artifact_id' = $1", [row.id]);
    expect(jobs.rows.map((r) => r.status)).toEqual(["Done"]);
  });
});

function slowPlugin(ms: number, fail: boolean): StudioGeneratorPlugin {
  return {
    manifest: { plugin_type: STUDIO_MINDMAP_PLUGIN_TYPE, display_name: "Mindmap", subtypes: ["default"] },
    triggerJob: () => ({ title: "Mindmap", params_json: {} }),
    async generate(_ctx: StudioGenerationContext): Promise<StudioGenerationOutcome> {
      await new Promise((r) => setTimeout(r, ms));
      if (fail) throw new Error("model exploded");
      return { status: "failed", failure: { code: "GenerationError", message: "x" } } as unknown as StudioGenerationOutcome;
    },
  };
}

function runnerWith(plugin: StudioGeneratorPlugin) {
  const repo = new PostgresStudioArtifactRepository(db.pool);
  const registry = new StudioPluginRegistry();
  registry.register(plugin);
  const runner = new StudioJobRunner({
    repo,
    registry,
    leaseDurationSeconds: 1,
    scopedContext: { getScopedContext: async () => [] },
    access: { verifySnapshot: async () => undefined },
  });
  return { repo, runner };
}

describe("[011-studio-mindmaps-data-tables] review: the execution lease is renewed and failures are fenced (FR-017)", () => {
  it("a run longer than the lease keeps it, so no second claim starts", async () => {
    const { owner, nb, snapshot } = await seed();
    const { repo, runner } = runnerWith(slowPlugin(2_500, true));
    const row = await repo.createQueued({ notebook_id: nb, owner_id: owner, plugin_type: "mindmap", subtype: "default", title: "Map", params_json: {}, snapshot, enqueueOutbox: false });
    const running = runner.run(row.id);
    await new Promise((r) => setTimeout(r, 1_600));
    expect(await repo.claimExecution(row.id, 1)).toBeNull();
    await running;
  });

  it("a stale run whose lease was taken over cannot fail the new owner's attempt", async () => {
    const { owner, nb, snapshot } = await seed();
    const { repo, runner } = runnerWith(slowPlugin(300, true));
    const row = await repo.createQueued({ notebook_id: nb, owner_id: owner, plugin_type: "mindmap", subtype: "default", title: "Map", params_json: {}, snapshot, enqueueOutbox: false });
    const running = runner.run(row.id);
    await new Promise((r) => setTimeout(r, 100));
    // Another worker reclaimed the attempt (lease rotated).
    await db.pool.query("UPDATE studio_artifacts SET lease_token = gen_random_uuid(), lease_expires_at = now() + interval '1 minute' WHERE id = $1", [row.id]);
    await running;
    expect((await repo.getById(row.id))!.status).toBe("Running");
  });
});
