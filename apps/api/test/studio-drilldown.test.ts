import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedReadySource } from "@everlast/db/testing";
import { startNotesApi, type NotesApi } from "./notes-pg-support.ts";

/**
 * [011-studio-mindmaps-data-tables] T026 — Guarded mindmap node drilldown integration tests
 * (FR-ST-09, FR-GC-01/02/06, C-02, NFR-EVAL-04; FR-005, FR-006, FR-010, FR-011, FR-014, SC-007, SC-008).
 */

const OWNER = "drilldown-33-owner";
const OTHER = "drilldown-33-other";
let n: NotesApi;

beforeAll(async () => {
  n = await startNotesApi();
});

afterAll(async () => {
  await n?.close();
});

const studio = (nb: string) => `/api/notebooks/${nb}/studio`;

async function seed(nb: string, title: string, pages: string[]) {
  const owner = await n.userId(OWNER);
  return seedReadySource(n.api.db.pool, owner, nb, {
    title,
    mediaType: "text/plain",
    pages,
    embed: (t) => n.embedder.embed(t, "RETRIEVAL_DOCUMENT"),
  });
}

async function waitTerminal(nb: string, id: string): Promise<any> {
  for (let i = 0; i < 400; i++) {
    const r = await n.call(OWNER, "GET", `${studio(nb)}/artifacts/${id}`);
    if (["Completed", "Failed", "Cancelled"].includes(r.json.artifact.status)) return r.json;
    await new Promise((res) => setTimeout(res, 15));
  }
  throw new Error("Studio job never finished");
}

describe("[011-studio-mindmaps-data-tables] T026: Server-side mindmap node drilldown guard and chat integration", () => {
  it("verifies node+parent factual evidence against current active_source_ids before constructing prompt, blocks missing scope (409 SupportingSourcesRequired) with zero prompt injection, and persists eligible cited chat turns", async () => {
    const nb = await n.notebook(OWNER);
    const srcA = await seed(nb, "Compute.txt", [
      "Cloud Run services run in europe-west4 with stateless containers and automatic scaling.",
    ]);
    const srcB = await seed(nb, "Storage.txt", [
      "Cloud SQL PostgreSQL 16 stores relational metadata and pgvector embeddings.",
    ]);

    const created = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, {
      plugin_type: "mindmap",
      subtype: "default",
      active_source_ids: [srcA.sourceId, srcB.sourceId],
    });
    expect(created.status).toBe(202);
    const completed = await waitTerminal(nb, created.json.artifact.id);
    expect(completed.artifact.status).toBe("Completed");
    const artifactId = completed.artifact.id;
    const rootNode = completed.artifact.payload_json.root_node;
    const childNode = rootNode.children[0]!;

    // 1. Empty active_source_ids -> 400 EmptyScopeError
    const emptyScope = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${artifactId}/drilldown`, {
      node_id: childNode.id,
      active_source_ids: [],
    });
    expect(emptyScope.status).toBe(400);
    expect(emptyScope.json.error.code).toBe("EmptyScopeError");

    // 2. Forged/unknown node_id -> 404/422
    const badNode = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${artifactId}/drilldown`, {
      node_id: "nonexistent_node_999",
      active_source_ids: [srcA.sourceId, srcB.sourceId],
    });
    expect([404, 422]).toContain(badNode.status);

    // 3. Find a node citing srcB, and attempt drilldown with ONLY srcA selected -> 409 SupportingSourcesRequired
    const findNodeForSource = (node: any, targetSource: string): any => {
      const cites = [...(node.label_citations ?? []), ...(node.summary_citations ?? [])];
      if (cites.some((c: any) => c.source_id === targetSource)) return node;
      for (const ch of node.children ?? []) {
        const found = findNodeForSource(ch, targetSource);
        if (found) return found;
      }
      return null;
    };
    const nodeB = findNodeForSource(rootNode, srcB.sourceId);
    expect(nodeB).not.toBeNull();

    const missingScope = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${artifactId}/drilldown`, {
      node_id: nodeB.id,
      active_source_ids: [srcA.sourceId], // srcB is deselected!
    });
    expect(missingScope.status).toBe(409);
    expect(missingScope.json.error.code).toBe("SupportingSourcesRequired");

    // Verify no chat turn was persisted from the blocked drilldown!
    const historyAfterBlocked = await n.call(OWNER, "GET", `/api/notebooks/${nb}/chat`);
    expect(historyAfterBlocked.json.messages ?? []).toHaveLength(0);

    // 4. Eligible drilldown with both sources selected -> 200 with contextual prompt (including parent context for non-root node) and persisted chat messages
    const eligible = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${artifactId}/drilldown`, {
      node_id: childNode.id,
      active_source_ids: [srcA.sourceId, srcB.sourceId],
    });
    expect(eligible.status).toBe(200);
    expect(eligible.json.node_id).toBe(childNode.id);
    expect(eligible.json.node_label).toBe(childNode.label);
    expect(eligible.json.parent_label).toBe(rootNode.label);
    expect(eligible.json.prompt).toContain(childNode.label);
    expect(eligible.json.prompt).toContain(rootNode.label);
    expect(Array.isArray(eligible.json.messages)).toBe(true);
    expect(eligible.json.messages.length).toBeGreaterThanOrEqual(2);

    // 5. Root node drilldown omits parent label
    const rootDrill = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${artifactId}/drilldown`, {
      node_id: rootNode.id,
      active_source_ids: [srcA.sourceId, srcB.sourceId],
    });
    expect(rootDrill.status).toBe(200);
    expect(rootDrill.json.parent_label).toBeNull();

    // 6. Non-owner is rejected
    const foreign = await n.call(OTHER, "POST", `${studio(nb)}/artifacts/${artifactId}/drilldown`, {
      node_id: rootNode.id,
      active_source_ids: [srcA.sourceId, srcB.sourceId],
    });
    expect([403, 404]).toContain(foreign.status);
  });
});
