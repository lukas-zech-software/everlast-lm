import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  StudioPluginRegistry,
  STUDIO_MINDMAP_PLUGIN_TYPE,
  type SourceRevisionPair,
  type StudioGenerationContext,
  type StudioGenerationOutcome,
  type StudioGeneratorPlugin,
  type StudioJobPlan,
  type StudioJobRequest,
} from "@everlast/contracts";
import {
  createNotebook,
  PostgresStudioArtifactRepository,
  verifyScopeSnapshot,
} from "@everlast/db";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "@everlast/db/testing";
import { drainJobs } from "../src/jobs.ts";
import { StudioJobRunner } from "../src/studio/runner.ts";
import { createStudioOutboxHandler, DurableStudioDispatcher } from "../src/studio/handler.ts";

/**
 * [011-studio-mindmaps-data-tables] T006 — Worker runner & durable outbox lifecycle tests
 * (FR-ST-08/18, FR-ST-10/11, C-02/C-03, NFR-EVAL-04; FR-003, FR-010, FR-011, FR-012, FR-017, SC-008, SC-011).
 */

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.drop();
});

describe("[011-studio-mindmaps-data-tables] T006: StudioJobRunner per-kind validation, captured-owner C-02 reads, and outbox redelivery", () => {
  it("passes captured owner_id to C-02 reads, recovers lost notification via outbox drain, and does not rerun model after terminal citation refusal", async () => {
    const owner = await createTestUser(db.pool);
    const nb = (await createNotebook(db.pool, owner, { title: "Worker Lifecycle NB" })).notebook.id;
    const seeded = await seedReadySource(db.pool, owner, nb, {
      title: "Source1.txt",
      mediaType: "text/plain",
      pages: ["Deterministic evidence about distributed consensus and raft leases."],
      embed: async (texts) => texts.map(() => new Array(768).fill(0.01)),
    });
    const snapshot: SourceRevisionPair[] = [{ source_id: seeded.sourceId, revision: 1 }];
    const chunkId = seeded.chunkIds[0]!;

    const observedOwners: (string | undefined)[] = [];
    let modelCalls = 0;
    let shouldCiteInvalidChunk = false;

    const testPlugin: StudioGeneratorPlugin = {
      manifest: {
        plugin_type: STUDIO_MINDMAP_PLUGIN_TYPE,
        display_name: "Mindmap",
        subtypes: ["default"],
      },
      triggerJob(_req: StudioJobRequest): StudioJobPlan {
        return { title: "Mindmap", params_json: {} };
      },
      async generate(ctx: StudioGenerationContext): Promise<StudioGenerationOutcome> {
        modelCalls += 1;
        const cite = {
          badge_number: 1,
          source_id: seeded.sourceId,
          chunk_id: shouldCiteInvalidChunk ? "0190f330-9999-7000-8000-000000000999" : chunkId,
          revision: 1,
          snippet: "Deterministic evidence",
        };
        return {
          status: "completed",
          payload: {
            root_node: {
              id: "root",
              label: "Distributed Consensus",
              summary: "Overview of consensus.",
              label_citations: [cite],
              summary_citations: [cite],
              children: [
                {
                  id: "raft",
                  label: "Raft Leases",
                  summary: "Lease mechanism.",
                  label_citations: [cite],
                  summary_citations: [cite],
                  children: [],
                },
              ],
            },
            node_count: 2,
            max_depth: 2,
            initial_expanded_depth: 2,
            insufficient_evidence_note: "Only 2 nodes supported by single-page source.",
            citations: [cite],
          },
        };
      },
    };

    const repo = new PostgresStudioArtifactRepository(db.pool);
    const registry = new StudioPluginRegistry();
    registry.register(testPlugin);

    const runner = new StudioJobRunner({
      repo,
      registry,
      scopedContext: {
        async getScopedContext(notebookId, activeSourceIds, ownerId) {
          observedOwners.push(ownerId);
          return [
            {
              chunk_id: chunkId,
              source_id: activeSourceIds[0]!,
              revision: 1,
              locator: { page_number: 1, start_offset: 0, end_offset: 66 },
              token_count: 16,
              text: "Deterministic evidence about distributed consensus and raft leases.",
            },
          ];
        },
      },
      access: {
        async verifySnapshot(ownerId, notebookId, snap) {
          await verifyScopeSnapshot(db.pool, { notebook_id: notebookId, owner_id: ownerId, sources: snap });
        },
      },
    });

    const dispatcher = new DurableStudioDispatcher(db.pool, runner, { notifyImmediate: false });
    const created = await repo.createQueued({
      notebook_id: nb,
      owner_id: owner,
      plugin_type: "mindmap",
      subtype: "default",
      title: "Consensus Map",
      params_json: {},
      snapshot,
      enqueueOutbox: true,
    });
    await dispatcher.enqueue(created.id, owner);

    // Notification was suppressed (`notifyImmediate: false`); drainJobs recovers from PostgreSQL outbox
    const handler = createStudioOutboxHandler(runner);
    await drainJobs(db.pool, { studio: handler });

    const done = await repo.getById(created.id);
    expect(done?.status).toBe("Completed");
    expect(observedOwners).toContain(owner);
    expect(modelCalls).toBe(1);

    // Now test terminal citation failure: redelivering or draining again must NOT rerun the model
    shouldCiteInvalidChunk = true;
    const bad = await repo.createQueued({
      notebook_id: nb,
      owner_id: owner,
      plugin_type: "mindmap",
      subtype: "default",
      title: "Invalid Citation Map",
      params_json: {},
      snapshot,
      enqueueOutbox: true,
    });
    await drainJobs(db.pool, { studio: handler });
    const failed = await repo.getById(bad.id);
    expect(failed?.status).toBe("Failed");
    expect(failed?.failure?.code).toBe("CitationValidationFailed");
    expect(failed?.payload_json).toBeNull();
    expect(modelCalls).toBe(2);

    // Running runner.run or drainJobs again does not invoke model again
    await runner.run(bad.id);
    await drainJobs(db.pool, { studio: handler });
    expect(modelCalls).toBe(2);
  });
});
