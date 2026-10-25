import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createNotebook,
  PostgresStudioArtifactRepository,
  sweepInterruptedStudioArtifacts,
} from "../src/index.ts";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "../src/testing.ts";

/**
 * [011-studio-mindmaps-data-tables] T005 — PostgreSQL migration 0011 and durable lifecycle tests
 * (FR-ST-08/18, FR-ST-10/11, C-02/C-03, NFR-SEC-02; FR-010, FR-012, FR-014, FR-017, SC-008, SC-011).
 */

let db: TestDatabase;
let repo: PostgresStudioArtifactRepository;

beforeAll(async () => {
  db = await createTestDatabase();
  repo = new PostgresStudioArtifactRepository(db.pool);
});

afterAll(async () => {
  await db?.drop();
});

async function setupNotebookWithReadySource() {
  const owner = await createTestUser(db.pool);
  const nb = (await createNotebook(db.pool, owner, { title: "Studio 3.3 NB" })).notebook.id;
  const seeded = await seedReadySource(db.pool, owner, nb, {
    title: "Architecture Spec.pdf",
    mediaType: "application/pdf",
    pages: ["Cloud Run and Cloud SQL PostgreSQL 16 power the regional architecture."],
    embed: async (texts) => texts.map(() => new Array(768).fill(0.01)),
  });
  return {
    owner,
    nb,
    sourceId: seeded.sourceId,
    chunkId: seeded.chunkIds[0]!,
    snapshot: [{ source_id: seeded.sourceId, revision: 1 }],
  };
}

function sampleMindmapPayload(sourceId: string, chunkId: string) {
  const cite = {
    badge_number: 1,
    source_id: sourceId,
    chunk_id: chunkId,
    revision: 1,
    snippet: "Cloud Run and Cloud SQL PostgreSQL 16",
  };
  return {
    root_node: {
      id: "root",
      label: "Regional Architecture",
      summary: "Overview of Cloud Run and Cloud SQL.",
      label_citations: [cite],
      summary_citations: [cite],
      children: [
        {
          id: "compute",
          label: "Cloud Run Compute",
          summary: "Stateless containers.",
          label_citations: [cite],
          summary_citations: [cite],
          children: [],
        },
      ],
    },
    node_count: 2,
    max_depth: 2,
    initial_expanded_depth: 2 as const,
    insufficient_evidence_note: "Only 2 nodes supported by the single-sentence source.",
    citations: [cite],
  };
}

describe("[011-studio-mindmaps-data-tables] T005: Migration 0011 additive schema, atomic outbox, leases, and publication fences", () => {
  it("admits mindmap/default and data_table/default, atomically enqueues an identifier-only studio outbox job, and keeps report rows compatible", async () => {
    const { owner, nb, snapshot } = await setupNotebookWithReadySource();

    const mindmap = await repo.createQueued({
      notebook_id: nb,
      owner_id: owner,
      plugin_type: "mindmap",
      subtype: "default",
      title: "Mindmap: Architecture Spec",
      params_json: {},
      snapshot,
      output_language: "en-US",
      enqueueOutbox: true,
    });
    expect(mindmap).toMatchObject({
      plugin_type: "mindmap",
      subtype: "default",
      status: "Queued",
      attempt: 1,
      retry_of: null,
      payload_json: null,
    });

    const outbox = await db.pool.query<{ kind: string; payload: Record<string, unknown> }>(
      "SELECT kind, payload FROM jobs WHERE kind = 'studio' AND payload ->> 'artifact_id' = $1",
      [mindmap.id]
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]!.payload).toEqual({
      artifact_id: mindmap.id,
      notebook_id: nb,
    });

    const table = await repo.createQueued({
      notebook_id: nb,
      owner_id: owner,
      plugin_type: "data_table",
      subtype: "default",
      title: "Data Table: Vendors",
      params_json: { schema_id: "vendor_comparison", focus_prompt: "Compare SLA" },
      snapshot,
      enqueueOutbox: true,
    });
    expect(table.plugin_type).toBe("data_table");
    expect(table.subtype).toBe("default");
  });

  it("excludes mindmap and data_table rows from the legacy report startup sweep while sweeping interrupted reports", async () => {
    const { owner, nb, snapshot } = await setupNotebookWithReadySource();

    const report = await repo.createQueued({
      notebook_id: nb,
      owner_id: owner,
      plugin_type: "report",
      subtype: "faq",
      title: "FAQ",
      params_json: {},
      snapshot,
    });
    const mindmap = await repo.createQueued({
      notebook_id: nb,
      owner_id: owner,
      plugin_type: "mindmap",
      subtype: "default",
      title: "Mindmap",
      params_json: {},
      snapshot,
    });

    await db.pool.query(
      "UPDATE studio_artifacts SET updated_at = now() - interval '2 minutes' WHERE id = ANY($1::uuid[])",
      [[report.id, mindmap.id]]
    );

    const sweptCount = await sweepInterruptedStudioArtifacts(db.pool);
    expect(sweptCount).toBeGreaterThanOrEqual(1);

    const afterReport = await repo.getById(report.id);
    const afterMindmap = await repo.getById(mindmap.id);
    expect(afterReport?.status).toBe("Failed");
    expect(afterReport?.failure?.code).toBe("GenerationError");
    expect(afterMindmap?.status).toBe("Queued");
    expect(afterMindmap?.attempt).toBe(1);
  });

  it("enforces durable lease claims, recovers expired leases on the same attempt, and blocks stale worker completion", async () => {
    const { owner, nb, sourceId, chunkId, snapshot } = await setupNotebookWithReadySource();
    const map = await repo.createQueued({
      notebook_id: nb,
      owner_id: owner,
      plugin_type: "mindmap",
      subtype: "default",
      title: "Leased Mindmap",
      params_json: {},
      snapshot,
    });

    const claim1 = await repo.claimExecution(map.id, 60);
    expect(claim1).not.toBeNull();
    expect(claim1!.artifact.status).toBe("Running");
    expect(claim1!.artifact.attempt).toBe(1);

    // Competing worker cannot claim while lease is active
    const competing = await repo.claimExecution(map.id, 60);
    expect(competing).toBeNull();

    // Expire the lease in DB to simulate worker crash
    await db.pool.query(
      "UPDATE studio_artifacts SET lease_expires_at = now() - interval '5 seconds' WHERE id = $1",
      [map.id]
    );

    const claim2 = await repo.claimExecution(map.id, 60);
    expect(claim2).not.toBeNull();
    expect(claim2!.artifact.attempt).toBe(1); // Same attempt recovered!
    expect(claim2!.leaseToken).not.toBe(claim1!.leaseToken);

    // Stale worker (claim1) cannot publish
    const payload = sampleMindmapPayload(sourceId, chunkId);
    await expect(
      repo.completeWithFence(map.id, payload, { leaseToken: claim1!.leaseToken })
    ).rejects.toThrow(/lease|stale|transition/i);

    // Active worker (claim2) publishes cleanly
    const completed = await repo.completeWithFence(map.id, payload, { leaseToken: claim2!.leaseToken });
    expect(completed.status).toBe("Completed");
    expect(completed.payload_json).toEqual(payload);
  });

  it("fences publication against source deletion or revision change inside the commit transaction", async () => {
    const { owner, nb, sourceId, chunkId, snapshot } = await setupNotebookWithReadySource();
    const map = await repo.createQueued({
      notebook_id: nb,
      owner_id: owner,
      plugin_type: "mindmap",
      subtype: "default",
      title: "Fenced Mindmap",
      params_json: {},
      snapshot,
    });
    const claim = await repo.claimExecution(map.id, 60);
    expect(claim).not.toBeNull();

    // Advance source revision before publication
    await db.pool.query("UPDATE sources SET active_revision = 2 WHERE id = $1", [sourceId]);

    const outcome = await repo.completeWithFence(map.id, sampleMindmapPayload(sourceId, chunkId), {
      leaseToken: claim!.leaseToken,
    });
    expect(outcome.status).toBe("Failed");
    expect(outcome.payload_json).toBeNull();
    expect(outcome.failure?.code).toBe("SourceChanged");
  });
});
