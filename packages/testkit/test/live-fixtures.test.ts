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

/** [001-workspace-foundation] T061 — FR-WM-01/04, NFR-SEC-01/02: frozen two-user live plan. */
import { frozenLiveFixturePlan, RESUMABLE_SCENARIOS } from "../src/live-fixtures.ts";
const planEnv = {
  WORKSPACE_IT_PROJECT: "disposable-test", WORKSPACE_IT_BUCKET: "fixture-bucket",
  WORKSPACE_IT_IDENTITY_UID: "uid-a", WORKSPACE_IT_IDENTITY_UID_B: "uid-b",
  WORKSPACE_IT_EMAIL: "a@fixture.invalid", WORKSPACE_IT_EMAIL_B: "b@fixture.invalid",
  WORKSPACE_IT_APPROVED_FIXTURE: "disposable-test/identity/uid-a",
  WORKSPACE_IT_APPROVED_FIXTURE_B: "disposable-test/identity/uid-b",
  WORKSPACE_IT_APPROVED_STORAGE: "disposable-test/storage/fixture-bucket",
  WORKSPACE_IT_SIGNUP_ROLLBACK: "disabledUserSignup=true",
  TEST_DATABASE_URL: "postgres://localhost/local",
};
it("freezes two isolated users, exact objects and generations, signup probe, revocation, retry and rollback", () => {
  const plan = frozenLiveFixturePlan(planEnv);
  expect(plan.users.map(u => u.uid)).toEqual(["uid-a", "uid-b"]);
  expect(plan.users[0]!.notebookPrefixLabel).not.toBe(plan.users[1]!.notebookPrefixLabel);
  expect(plan.objects.map(o => [o.owner, o.name, o.generations, o.hold])).toEqual([
    ["a", "sources/fixture/raw", ["v1", "v2"], "v1"],
    ["a", "sources/late/raw", ["late-put"], null],
    ["b", "sources/fixture/raw", ["v1", "v2"], null],
  ]);
  expect(plan.signup).toEqual({ probe: "existing-email", expectedError: "ADMIN_ONLY_OPERATION", requiredPolicy: "disabledUserSignup=true", rollback: "disabledUserSignup=true" });
  expect(plan.revocation).toEqual({ revokedUser: "a", survivingUser: "b" });
  expect(plan.cleanupRetry).toEqual(["retry:RetainedObject", "deferred", "purged"]);
  expect(Object.isFrozen(plan) && Object.isFrozen(plan.users)).toBe(true);
});
it("rejects shared, missing or unapproved second user and missing rollback input", () => {
  for (const patch of [
    { WORKSPACE_IT_IDENTITY_UID_B: "uid-a" }, { WORKSPACE_IT_EMAIL_B: "a@fixture.invalid" },
    { WORKSPACE_IT_APPROVED_FIXTURE_B: "other" }, { WORKSPACE_IT_SIGNUP_ROLLBACK: "" },
    { WORKSPACE_IT_IDENTITY_UID_B: "" }, { WORKSPACE_IT_APPROVED_STORAGE: "x" },
  ]) expect(() => frozenLiveFixturePlan({ ...planEnv, ...patch })).toThrow(/UNAVAILABLE/);
});
it("records resumable scenarios individually: only signed-PUT behavior is verifiable", () => {
  const verifiable = RESUMABLE_SCENARIOS.filter(s => s.verifiable).map(s => s.id);
  expect(verifiable).toEqual(["signed-put-expiry-late-sweep", "post-resumable-denied-on-put-capability"]);
  const unavailable = RESUMABLE_SCENARIOS.filter(s => !s.verifiable);
  expect(unavailable.length).toBeGreaterThanOrEqual(2);
  for (const s of unavailable) expect(s.reason).toMatch(/UNAVAILABLE/);
});
