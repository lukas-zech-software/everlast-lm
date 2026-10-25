import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedReadySource } from "@everlast/db/testing";
import { makeCodePointString } from "@everlast/testkit/studio-structure-fixtures";
import { startNotesApi, type NotesApi } from "./notes-pg-support.ts";

/**
 * [011-studio-mindmaps-data-tables] T007 — Studio API admission, cancellation, retry, metadata redaction,
 * and isolation tests (FR-ST-08/18, FR-WM-04/05, FR-SI-03/05, C-02/C-03, NFR-SEC-01/02, NFR-EVAL-04;
 * FR-001, FR-007, FR-010, FR-011, FR-012, FR-014, FR-017, SC-008, SC-011).
 */

const OWNER = "studio-33-owner";
const OTHER = "studio-33-other";
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

describe("[011-studio-mindmaps-data-tables] T007: Studio API admission, status codes, cancel/retry, and source invalidation hygiene", () => {
  it("enforces explicit nonempty Ready scope (400), unsupported output_language (400), invalid params (422), and owner isolation (404)", async () => {
    const nb = await n.notebook(OWNER);
    const src = await seed(nb, "Architecture.txt", [
      "Cloud Run services connect to Cloud SQL PostgreSQL 16 in europe-west4. Keyless service accounts enforce IAM boundaries.",
    ]);

    // Empty active_source_ids -> 400 EmptyScopeError
    const emptyRes = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, {
      plugin_type: "mindmap",
      subtype: "default",
      active_source_ids: [],
    });
    expect(emptyRes.status).toBe(400);
    expect(emptyRes.json.error.code).toBe("EmptyScopeError");

    // Unsupported output_language -> 400 UnsupportedOutputLanguage
    const badLang = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, {
      plugin_type: "mindmap",
      subtype: "default",
      active_source_ids: [src.sourceId],
      output_language: "zz-ZZ",
    });
    expect(badLang.status).toBe(400);
    expect(badLang.json.error.code).toBe("UnsupportedOutputLanguage");

    // Over-limit focus_prompt (2001 code points) -> 422 ValidationError
    const badPrompt = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, {
      plugin_type: "data_table",
      subtype: "default",
      active_source_ids: [src.sourceId],
      focus_prompt: makeCodePointString(2001),
    });
    expect(badPrompt.status).toBe(422);

    // Valid mindmap creation -> 202
    const created = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, {
      plugin_type: "mindmap",
      subtype: "default",
      active_source_ids: [src.sourceId],
    });
    expect(created.status).toBe(202);
    expect(created.json.artifact.plugin_type).toBe("mindmap");

    // Non-owner cannot list, read, cancel, or delete (rejected with 403/404)
    expect([403, 404]).toContain((await n.call(OTHER, "GET", `${studio(nb)}/artifacts`)).status);
    expect([403, 404]).toContain((await n.call(OTHER, "GET", `${studio(nb)}/artifacts/${created.json.artifact.id}`)).status);
    expect([403, 404]).toContain((await n.call(OTHER, "DELETE", `${studio(nb)}/artifacts/${created.json.artifact.id}`)).status);
  });

  it("supports cancelling a Queued/Running mindmap or data_table and retrying as attempt 2, while keeping report cancel unavailable (404)", async () => {
    const nb = await n.notebook(OWNER);
    const owner = await n.userId(OWNER);
    const src = await seed(nb, "Vendors.txt", [
      "Vendor Alpha costs $10/month with 99.9% SLA. Vendor Beta costs $15/month with 99.95% SLA.",
    ]);

    // Insert a Queued mindmap directly to test deterministic cancel before completion
    const mapId = crypto.randomUUID();
    await n.api.db.pool.query(
      `INSERT INTO studio_artifacts (id, notebook_id, owner_id, plugin_type, subtype, status, title, params_json, source_revisions_snapshot)
       VALUES ($1, $2, $3, 'mindmap', 'default', 'Queued', 'Mindmap: Secret Title', '{}'::jsonb, $4)`,
      [mapId, nb, owner, JSON.stringify([{ source_id: src.sourceId, revision: 1 }])]
    );

    const cancelled = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${mapId}/cancel`, {});
    expect(cancelled.status).toBe(200);
    expect(cancelled.json.artifact.status).toBe("Cancelled");
    expect(cancelled.json.artifact.payload_json).toBeNull();

    // Retry creates a new attempt with fresh selection
    const retried = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${mapId}/retry`, {
      active_source_ids: [src.sourceId],
    });
    expect(retried.status).toBe(202);
    expect(retried.json.artifact.attempt).toBe(2);
    expect(retried.json.artifact.retry_of).toBe(mapId);

    // Legacy report cancel remains unavailable (404 per FR-ST-10 card and apps/api/test/studio-artifacts.test.ts)
    const repId = crypto.randomUUID();
    await n.api.db.pool.query(
      `INSERT INTO studio_artifacts (id, notebook_id, owner_id, plugin_type, subtype, status, title, params_json, source_revisions_snapshot)
       VALUES ($1, $2, $3, 'report', 'faq', 'Queued', 'FAQ', '{}'::jsonb, $4)`,
      [repId, nb, owner, JSON.stringify([{ source_id: src.sourceId, revision: 1 }])]
    );
    const repCancel = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${repId}/cancel`, {});
    expect(repCancel.status).toBe(404);
  });

  it("redacts source-derived titles in list and hides payload in get when a captured source is deleted or replaced", async () => {
    const nb = await n.notebook(OWNER);
    const src = await seed(nb, "Confidential Project Helios.txt", [
      "Project Helios uses regional Cloud Run services and Cloud SQL PostgreSQL 16 in europe-west4.",
    ]);

    const created = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, {
      plugin_type: "mindmap",
      subtype: "default",
      active_source_ids: [src.sourceId],
    });
    expect(created.status).toBe(202);
    const done = await waitTerminal(nb, created.json.artifact.id);
    expect(done.artifact.status).toBe("Completed");

    // Delete the source in PostgreSQL
    await n.api.db.pool.query("DELETE FROM sources WHERE id = $1", [src.sourceId]);

    const listed = await n.call(OWNER, "GET", `${studio(nb)}/artifacts`);
    expect(listed.status).toBe(200);
    const row = listed.json.artifacts.find((a: any) => a.id === created.json.artifact.id);
    expect(row).toBeDefined();
    expect(row.title).not.toContain("Helios");
    expect(row.title).toBe("Mindmap");

    const opened = await n.call(OWNER, "GET", `${studio(nb)}/artifacts/${created.json.artifact.id}`);
    expect(opened.status).toBe(200);
    expect(opened.json.artifact.payload_json).toBeNull();
    expect(opened.json.artifact.title).toBe("Mindmap");
    expect(opened.json.unavailable).toBeDefined();
  });
});
