import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createNotebook,
  PostgresStudioArtifactRepository,
  sweepInterruptedStudioArtifacts,
} from "../src/index.ts";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "../src/testing.ts";

/**
 * [015-studio-visuals-presentations] T004 — PostgreSQL migration 0014 integration tests
 * (FR-ST-16, FR-ST-17, C-03, NFR-SEC-02).
 */

let db: TestDatabase;
let artifacts: PostgresStudioArtifactRepository;

beforeAll(async () => {
  db = await createTestDatabase();
  artifacts = new PostgresStudioArtifactRepository(db.pool);
});

afterAll(async () => {
  await db?.drop();
});

describe("[015-studio-visuals-presentations] T004: Migration 0014 durable slide_deck & infographic constraints", () => {
  it("admits slide_deck and infographic with outbox jobs, lease fencing, and excludes them from legacy report startup sweep", async () => {
    const owner = await createTestUser(db.pool);
    const nb = (await createNotebook(db.pool, owner, { title: "v4.2 Visuals NB" })).notebook.id;
    const seeded = await seedReadySource(db.pool, owner, nb, {
      title: "Runbook.txt",
      mediaType: "text/plain",
      pages: ["Incident response follows 4 stages: Detection, Triage, Containment, and Recovery."],
      embed: async (texts) => texts.map(() => new Array(768).fill(0.01)),
    });
    const snapshot = [{ source_id: seeded.sourceId, revision: 1 }];

    const deck = await artifacts.createQueued({
      notebook_id: nb,
      owner_id: owner,
      plugin_type: "slide_deck",
      subtype: "default",
      title: "Slide Deck",
      params_json: { slide_count: 8 },
      snapshot,
      enqueueOutbox: true,
    });
    const info = await artifacts.createQueued({
      notebook_id: nb,
      owner_id: owner,
      plugin_type: "infographic",
      subtype: "default",
      title: "Infographic",
      params_json: { style: "process_flow" },
      snapshot,
      enqueueOutbox: true,
    });
    expect(deck.plugin_type).toBe("slide_deck");
    expect(info.plugin_type).toBe("infographic");

    // Rejects non-default subtype for slide_deck / infographic
    await expect(
      db.pool.query(
        `INSERT INTO studio_artifacts (id, notebook_id, owner_id, plugin_type, subtype, status, title, params_json, source_revisions_snapshot)
         VALUES (gen_random_uuid(), $1, $2, 'slide_deck', 'briefing_doc', 'Queued', 'Bad', '{}'::jsonb, $3::jsonb)`,
        [nb, owner, JSON.stringify(snapshot)]
      )
    ).rejects.toThrow();

    // Excluded from legacy report restart sweep
    await db.pool.query(
      "UPDATE studio_artifacts SET updated_at = now() - interval '2 minutes' WHERE id = ANY($1::uuid[])",
      [[deck.id, info.id]]
    );
    await sweepInterruptedStudioArtifacts(db.pool);

    expect((await artifacts.getById(deck.id))?.status).toBe("Queued");
    expect((await artifacts.getById(info.id))?.status).toBe("Queued");

    // Claim lease and verify retry flow
    const claim = await artifacts.claimExecution(deck.id, 60);
    expect(claim?.leaseToken).toBeTruthy();
    const failed = await artifacts.failWithFence(
      deck.id,
      { code: "GenerationError", message: "Simulated failure" },
      claim!.leaseToken
    );
    expect(failed?.status).toBe("Failed");

    const retried = await artifacts.createRetry({
      previous_id: deck.id,
      owner_id: owner,
      snapshot,
      enqueueOutbox: true,
    });
    expect(retried.attempt).toBe(2);
    expect(retried.retry_of).toBe(deck.id);
    expect(retried.status).toBe("Queued");
  });
});
