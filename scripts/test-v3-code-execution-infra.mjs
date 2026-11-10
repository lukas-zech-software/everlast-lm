#!/usr/bin/env node
/** [010-code-execution-sandbox] T053: FR-GC-08, NFR-SEC-01/02, D18–D20, CC-02/08.
 * Inspect actual nested dev plans with mocked providers. No cloud calls, backend or apply.
 * Initialize dev with `tofu -chdir=infra/environments/dev init -backend=false -input=false -lockfile=readonly`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync("tofu", ["-chdir=infra/environments/dev", "test", "-filter=tests/code_execution_wiring.tftest.hcl", "-json", "-verbose"], {
  cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 60_000,
});
if (result.error) throw result.error;
const events = result.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
for (const event of events.filter((item) => item.type === "diagnostic")) console.error(event.diagnostic.summary, event.diagnostic.detail);
assert.equal(result.status, 0, `Mocked OpenTofu parent-runtime assertions failed: ${result.stderr}`);
assert.equal(events.find((item) => item.type === "test_summary")?.test_summary.passed, 7, "All seven parent-runtime policy runs must pass");
const plans = new Map(events.filter((item) => item.type === "test_plan").map((item) => [item["@testrun"], item.test_plan]));
function resources(module) {
  return [...(module.resources ?? []), ...(module.child_modules ?? []).flatMap(resources)];
}
function fixture(name) {
  const plan = plans.get(name);
  assert.ok(plan && !plan.errored, `${name} must emit a complete plan`);
  const all = resources(plan.planned_values.root_module);
  const byType = (type) => all.filter((resource) => resource.type === type);
  const api = byType("google_cloud_run_v2_service").find((item) => item.address.endsWith(".api"));
  assert.ok(api, "Dev entry point must plan the actual API service");
  return { plan, all, byType, api, env: Object.fromEntries(api.values.template[0].containers[0].env.filter((item) => item.value != null).map((item) => [item.name, item.value])) };
}
const disabled = fixture("disabled_defaults");
assert.equal(disabled.byType("google_vertex_ai_reasoning_engine").length, 0, "Defaults must not create a parent runtime");
assert.equal(disabled.byType("google_project_service").length, 0, "Defaults must not enable APIs");
for (const key of ["CODE_EXECUTION_ENABLED", "CODE_EXECUTION_REASONING_ENGINE", "CODE_EXECUTION_LOCATION"]) assert.ok(!(key in disabled.env), `Disabled API must not receive ${key}`);
const existing = fixture("existing_runtime");
assert.equal(existing.byType("google_vertex_ai_reasoning_engine").length, 0, "Existing-runtime mode must not create a second parent");
assert.equal(existing.env.CODE_EXECUTION_REASONING_ENGINE, "projects/everlast-test/locations/europe-west4/reasoningEngines/1234567890");
assert.equal(existing.env.CODE_EXECUTION_ENABLED, "true");
assert.equal(existing.env.CODE_EXECUTION_LOCATION, "europe-west4");
const managed = fixture("managed_bare_parent");
assert.equal(managed.byType("google_project_service").length, 0, "Selecting a parent must not implicitly enable APIs");
const parents = managed.byType("google_vertex_ai_reasoning_engine");
assert.equal(parents.length, 1, "Managed mode must plan exactly one typed parent runtime");
const parent = parents[0];
assert.equal(parent.values.project, "everlast-test");
assert.equal(parent.values.region, "europe-west4");
assert.equal(parent.values.display_name, "everlast-dev-code-execution");
for (const block of ["spec", "context_spec", "encryption_spec"]) assert.equal((parent.values[block] ?? []).length, 0, `Bare parent must not configure ${block}`);
assert.equal(managed.env.CODE_EXECUTION_ENABLED, "true");
assert.equal(managed.env.CODE_EXECUTION_LOCATION, "europe-west4");
const enabledRoles = (fixture) => fixture.byType("google_project_iam_member").map((item) => `${item.address}:${item.values.role}`).sort();
assert.deepEqual(enabledRoles(managed), enabledRoles(disabled), "Parent creation must not add IAM roles");
assert.equal(managed.byType("google_secret_manager_secret_version").length, 0, "No secret bytes belong in the parent plan");
// A computed name can remain unknown during a real plan; its API binding must preserve that dependency.
const apiChange = managed.plan.resource_changes.find((change) => change.address === managed.api.address);
const parentChange = managed.plan.resource_changes.find((change) => change.address === parent.address);
const apiEnv = apiChange.change.after.template[0].containers[0].env;
const engineIndex = apiEnv.findIndex((item) => item.name === "CODE_EXECUTION_REASONING_ENGINE");
assert.ok(engineIndex >= 0, "Managed API needs a runtime-name binding");
if (parent.values.name != null) assert.equal(managed.env.CODE_EXECUTION_REASONING_ENGINE, parent.values.name, "API receives the actual provider-computed name");
else {
  assert.equal(parentChange.change.after_unknown.name, true, "Parent resource name must be provider-computed");
  assert.equal(apiChange.change.after_unknown.template[0].containers[0].env[engineIndex].value, true, "Unknown provider name must remain unknown in the API binding");
}
console.log("PASS: mocked dev plans verify default-off bare EU parent creation, existing-runtime compatibility, API binding and invalid-mode rejection (FR-GC-08).");
