import { expect, it } from "vitest";
import { approvedLiveFixture } from "../src/live-fixtures.ts";
/** [001-workspace-foundation] T058/T060 — FR-WM-04, NFR-SEC-02: no accidental cloud mutation. */
it("requires exact approval and rejects production/cloud execution and nonlocal cleanup databases", () => {
  expect(() => approvedLiveFixture({}, "identity")).toThrow(/UNAVAILABLE/);
  const env = { WORKSPACE_IT_PROJECT: "disposable-test", WORKSPACE_IT_IDENTITY_UID: "fixture-user", WORKSPACE_IT_APPROVED_FIXTURE: "disposable-test/identity/fixture-user" };
  expect(approvedLiveFixture(env, "identity")).toEqual({ project: "disposable-test", target: "fixture-user" });
  for (const extra of [{ NODE_ENV: "production" }, { K_SERVICE: "deployed-api" }, { WORKSPACE_IT_PROJECT: "production-project" }, { WORKSPACE_IT_APPROVED_FIXTURE: "different" }]) {
    expect(() => approvedLiveFixture({ ...env, ...extra }, "identity")).toThrow(/UNAVAILABLE/);
  }
  const storage = { WORKSPACE_IT_PROJECT: "disposable-test", WORKSPACE_IT_BUCKET: "fixture-bucket", WORKSPACE_IT_APPROVED_FIXTURE: "disposable-test/storage/fixture-bucket", TEST_DATABASE_URL: "postgres://localhost/local" };
  expect(approvedLiveFixture(storage, "storage").target).toBe("fixture-bucket");
  expect(() => approvedLiveFixture({ ...storage, STORAGE_BUCKET: "fixture-bucket" }, "storage")).toThrow(/workspace buckets/);
  expect(() => approvedLiveFixture({ ...storage, TEST_DATABASE_URL: "malformed" }, "storage")).toThrow(/UNAVAILABLE/);
  expect(() => approvedLiveFixture({ ...storage, TEST_DATABASE_URL: "postgres://cloud-database/db" }, "storage")).toThrow(/local PostgreSQL/);
});
