import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const path = resolve(here, "../migrations/v3-draft/studio_artifacts.sql");

describe("C-03, FR-ST-10: draft v3 studio_artifacts table (D16)", () => {
  it("exists and defines the studio_artifacts table with required columns", () => {
    expect(existsSync(path)).toBe(true);
    const sql = readFileSync(path, "utf8");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS studio_artifacts/);
    for (const col of [
      "id",
      "notebook_id",
      "owner_id",
      "plugin_type",
      "subtype",
      "status",
      "title",
      "params_json",
      "payload_json",
      "active_source_ids_snapshot",
      "failure_json",
      "attempt",
      "retry_of",
      "created_at",
    ]) {
      expect(sql).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it("cascades on notebook delete and constrains status, subtype and payload", () => {
    const sql = readFileSync(path, "utf8");
    expect(sql).toMatch(/REFERENCES notebooks\s*\(id\)\s+ON DELETE CASCADE/i);
    expect(sql).toMatch(/'Queued'.*'Running'.*'Completed'.*'Failed'.*'Cancelled'/s);
    expect(sql).toMatch(/'briefing_doc'.*'study_guide'.*'faq'.*'timeline'.*'dynamic'.*'custom'/s);
    expect(sql).toMatch(/status = 'Completed'\) = \(payload_json IS NOT NULL\)/);
    expect(sql).toMatch(/jsonb_array_length\(active_source_ids_snapshot\) >= 1/);
  });
});
