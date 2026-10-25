import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedReadySource } from "@everlast/db/testing";
import { startNotesApi, type NotesApi } from "./notes-pg-support.ts";

/**
 * [011-studio-mindmaps-data-tables] T027 — Mindmap SVG/PNG scene export API and security tests
 * (FR-ST-09, C-03, NFR-SEC-02, NFR-EVAL-04; FR-004, FR-010, FR-011, FR-014, SC-004, SC-008).
 */

const OWNER = "map-export-33-owner";
const OTHER = "map-export-33-other";
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

describe("[011-studio-mindmaps-data-tables] T027: Mindmap export scene validation, allowlisted SVG primitives, and source invalidation", () => {
  it("validates ancestor-closed expanded_node_ids, emits self-contained escaped SVG without scripts/events/foreignObject/external URLs, and blocks export after source deletion", async () => {
    const nb = await n.notebook(OWNER);
    const src = await seed(nb, "Architecture.txt", [
      "Cloud Run services run in europe-west4. Cloud SQL PostgreSQL 16 stores relational data. Vertex AI Gemini 2.5 Flash powers Studio.",
    ]);

    const created = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, {
      plugin_type: "mindmap",
      subtype: "default",
      active_source_ids: [src.sourceId],
    });
    const completed = await waitTerminal(nb, created.json.artifact.id);
    expect(completed.artifact.status).toBe("Completed");
    const artifactId = completed.artifact.id;
    const root = completed.artifact.payload_json.root_node;
    const branch = root.children[0]!;
    const child = branch.children[0]!;

    // 1. Orphan node in expanded_node_ids (child without branch parent) -> 422 ValidationError
    const orphanExport = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${artifactId}/export`, {
      format: "svg",
      expanded_node_ids: [root.id, child.id],
    });
    expect(orphanExport.status).toBe(422);

    // 2. Valid SVG scene export
    const svgRes = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${artifactId}/export`, {
      format: "svg",
      expanded_node_ids: [root.id, branch.id, child.id],
    });
    expect(svgRes.status).toBe(200);
    expect(svgRes.json.format).toBe("svg");
    expect(svgRes.json.scale).toBe(1);
    expect(svgRes.json.svg).toContain("<svg");
    expect(svgRes.json.svg).toContain(root.label);
    expect(svgRes.json.svg).toContain(branch.label);
    expect(svgRes.json.svg).toContain(child.label);
    expect(svgRes.json.svg).not.toMatch(/<script|onload|onerror|foreignObject|href\s*=|url\(/i);

    // 3. Valid PNG scene export returns 2x scale metadata and full SVG scene for browser Canvas rasterization
    const pngRes = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${artifactId}/export`, {
      format: "png",
      expanded_node_ids: [root.id, branch.id, child.id],
    });
    expect(pngRes.status).toBe(200);
    expect(pngRes.json.format).toBe("png");
    expect(pngRes.json.scale).toBe(2);
    expect(pngRes.json.width).toBeGreaterThan(200);
    expect(pngRes.json.height).toBeGreaterThan(100);

    // 4. Non-owner cannot export
    expect([403, 404]).toContain(
      (
        await n.call(OTHER, "POST", `${studio(nb)}/artifacts/${artifactId}/export`, {
          format: "svg",
          expanded_node_ids: [root.id],
        })
      ).status
    );

    // 5. Deleting the source invalidates export immediately (409 SourceSnapshotInvalid)
    await n.api.db.pool.query("DELETE FROM sources WHERE id = $1", [src.sourceId]);
    const revokedExport = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${artifactId}/export`, {
      format: "svg",
      expanded_node_ids: [root.id],
    });
    expect(revokedExport.status).toBe(409);
  });
});
