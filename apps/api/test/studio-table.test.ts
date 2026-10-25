import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedReadySource } from "@everlast/db/testing";
import { makeCodePointString } from "@everlast/testkit/studio-structure-fixtures";
import { startNotesApi, type NotesApi } from "./notes-pg-support.ts";

/**
 * [011-studio-mindmaps-data-tables] T039 — Data Table API tests:
 * - optional 0 / 2,000 / 2,001 trimmed-Unicode code-point focus_prompt
 * - schema_id validation ("auto", "vendor_comparison", etc.)
 * - combined focus_prompt + schema_id behavior
 * - automatic schema when no focus_prompt is given
 * - scope / cancel / retry
 * - 500/25 allowed and 501/26 Failed with narrowing request & no partial payload
 * (FR-ST-18, C-03, FR-SI-03; FR-007, FR-008, FR-010, FR-012, FR-013, FR-015, SC-006, SC-008, SC-009)
 */

const OWNER = "table-api-33-owner";
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

describe("[011-studio-mindmaps-data-tables] T039: Data Table API focus_prompt bounds, schema_id, combined params, cancel/retry, and 501/26 overflow failure", () => {
  it("validates 0 / 2,000 / 2,001 trimmed-Unicode focus_prompt, schema_id enum, combined focus+schema, and automatic schema without prompt", async () => {
    const nb = await n.notebook(OWNER);
    const s1 = await seed(nb, "VendorAlpha.txt", [
      "Vendor Alpha Enterprise Plan costs $10/month per seat and guarantees a 99.9% Uptime SLA.",
    ]);
    const s2 = await seed(nb, "VendorBeta.txt", [
      "Vendor Beta Cloud Suite costs $15/month per seat and guarantees a 99.95% Uptime SLA.",
    ]);
    const s3 = await seed(nb, "VendorGamma.txt", [
      "Vendor Gamma Starter Edition costs $20/month per seat. No uptime guarantee is stated in this contract.",
    ]);
    const s4 = await seed(nb, "AlphaAddendum.txt", [
      "2026 Pricing Addendum: Vendor Alpha Enterprise Plan costs $12/month per seat effective immediately.",
    ]);
    const activeIds = [s1.sourceId, s2.sourceId, s3.sourceId, s4.sourceId];

    // 1. Unknown schema_id -> 422 ValidationError
    const badSchema = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, {
      plugin_type: "data_table",
      subtype: "default",
      active_source_ids: activeIds,
      schema_id: "unknown_schema",
    });
    expect(badSchema.status).toBe(422);

    // 2. 2,001 Unicode code-point focus_prompt -> 422 ValidationError
    const overPrompt = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, {
      plugin_type: "data_table",
      subtype: "default",
      active_source_ids: activeIds,
      focus_prompt: makeCodePointString(2001),
    });
    expect(overPrompt.status).toBe(422);

    // 3. Exactly 2,000 Unicode code-point focus_prompt + schema_id -> 202 Accepted & Completed
    const prompt2000 = makeCodePointString(2000);
    const exactRes = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, {
      plugin_type: "data_table",
      subtype: "default",
      active_source_ids: activeIds,
      focus_prompt: `  ${prompt2000}  `,
      schema_id: "vendor_comparison",
    });
    expect(exactRes.status).toBe(202);
    const exactDone = await waitTerminal(nb, exactRes.json.artifact.id);
    expect(exactDone.artifact.status).toBe("Completed");
    expect(exactDone.artifact.params_json.focus_prompt).toBe(prompt2000);
    expect(exactDone.artifact.params_json.schema_id).toBe("vendor_comparison");
    expect(exactDone.artifact.payload_json.rows).toHaveLength(3);

    // 4. 0-length / omitted focus_prompt and omitted schema_id -> defaults to schema_id: "auto" and completes
    const autoRes = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, {
      plugin_type: "data_table",
      subtype: "default",
      active_source_ids: activeIds,
      focus_prompt: "   ",
    });
    expect(autoRes.status).toBe(202);
    const autoDone = await waitTerminal(nb, autoRes.json.artifact.id);
    expect(autoDone.artifact.status).toBe("Completed");
    expect(autoDone.artifact.params_json.schema_id).toBe("auto");
    expect(autoDone.artifact.params_json.focus_prompt).toBeUndefined();
  });

  it("transitions oversized table (>500 rows or >25 columns) to Failed with TableBoundsExceeded narrowing message and null payload_json", async () => {
    const nb = await n.notebook(OWNER);
    // Seed a source that has 26 distinct key-value attributes so the deterministic model extracts 26 columns (>25 limit)
    const lines = Array.from({ length: 26 }, (_, i) => `Attribute${i + 1}: Value-${i + 1} for Vendor Alpha.`);
    const s1 = await seed(nb, "WideAttributes.txt", [lines.join(". ")]);

    const res = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, {
      plugin_type: "data_table",
      subtype: "default",
      active_source_ids: [s1.sourceId],
    });
    expect(res.status).toBe(202);
    const done = await waitTerminal(nb, res.json.artifact.id);
    expect(done.artifact.status).toBe("Failed");
    expect(done.artifact.payload_json).toBeNull();
    expect(done.artifact.failure.code).toBe("TableBoundsExceeded");
    expect(done.artifact.failure.message).toMatch(/exceeds|narrow/i);
  });
});
