#!/usr/bin/env node
/** [009-multimodal-ingestion-sync] T062: FR-SI-01/05, NFR-SEC-01/02, CC-02/08.
 * Verify actual nested resource plans from the dev entry point using OpenTofu's mocked providers.
 * Run after `tofu -chdir=infra/environments/dev init -backend=false -input=false`.
 * Every test run uses command=plan: no state backend, credentials or resource apply is involved.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync("tofu", ["-chdir=infra/environments/dev", "test", "-filter=tests/ingestion_wiring.tftest.hcl", "-json", "-verbose"], {
  cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 60_000,
});
if (result.error) throw result.error;
const events = result.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
for (const event of events.filter((item) => item.type === "diagnostic")) console.error(event.diagnostic.summary, event.diagnostic.detail);
assert.equal(result.status, 0, `Mocked OpenTofu plan assertions failed: ${result.stderr}`);
assert.equal(events.find((item) => item.type === "test_summary")?.test_summary.passed, 7, "All seven declared policy runs must pass");
const plans = new Map(events.filter((item) => item.type === "test_plan").map((item) => [item["@testrun"], item.test_plan]));
assert.ok(plans.has("disabled_defaults") && plans.has("approved_ingestion_settings") && plans.has("managed_prompt_injection_template"), "All declared dev fixture plans must be emitted");
function resources(module) {
  return [...(module.resources ?? []), ...(module.child_modules ?? []).flatMap(resources)];
}
function fixture(name) {
  const plan = plans.get(name);
  assert.ok(plan && !plan.errored, `${name} must have a complete plan`);
  const all = resources(plan.planned_values.root_module);
  const byType = (type) => all.filter((resource) => resource.type === type);
  const service = (suffix) => {
    const resource = byType("google_cloud_run_v2_service").find((item) => item.address.endsWith(`.${suffix}`));
    assert.ok(resource, `Missing ${suffix} service`);
    return { resource, env: Object.fromEntries(resource.values.template[0].containers[0].env.filter((item) => item.value != null).map((item) => [item.name, item.value])) };
  };
  return { plan, all, byType, api: service("api"), worker: service("worker") };
}
const disabled = fixture("disabled_defaults");
assert.equal(disabled.byType("google_cloud_run_v2_job").length, 0, "Defaults must not deploy the render job");
assert.equal(disabled.byType("google_compute_network").length, 0, "Defaults must not deploy the render network");
assert.equal(disabled.byType("google_project_service").length, 0, "Defaults must not enable any APIs");
for (const key of ["SPEECH_LOCATION", "MODEL_ARMOR_LOCATION", "MODEL_ARMOR_TEMPLATE_ID", "DRIVE_WEBHOOK_ADDRESS", "RENDER_JOB_NAME", "RENDER_JOB_LOCATION"]) {
  assert.ok(!(key in disabled.worker.env), `Default worker must not wire ${key}`);
}
for (const key of ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_PICKER_API_KEY", "GOOGLE_PICKER_APP_ID"]) {
  assert.ok(!(key in disabled.api.env), `Default API must not wire ${key}`);
}
const enabled = fixture("approved_ingestion_settings");
const enabledApis = new Set(enabled.byType("google_project_service").map((item) => item.values.service));
for (const api of ["speech.googleapis.com", "drive.googleapis.com", "youtube.googleapis.com", "compute.googleapis.com", "modelarmor.googleapis.com"]) {
  assert.ok(enabledApis.has(api), `Approved ingestion must plan ${api}`);
}
for (const [key, value] of Object.entries({
  GOOGLE_OAUTH_CLIENT_ID: "fixture.apps.googleusercontent.com", GOOGLE_PICKER_API_KEY: "public-picker-fixture", GOOGLE_PICKER_APP_ID: "123456789012",
})) assert.equal(enabled.api.env[key], value, `API must receive the declared ${key}`);
for (const [key, value] of Object.entries({
  SPEECH_LOCATION: "europe-west4", MODEL_ARMOR_LOCATION: "europe-west4", MODEL_ARMOR_TEMPLATE_ID: "ingestion-screening",
  GOOGLE_OAUTH_CLIENT_ID: "fixture.apps.googleusercontent.com", DELEGATED_SECRET_PROJECT_ID: "everlast-test",
  DRIVE_WEBHOOK_ADDRESS: "https://app.example.test/webhooks/google-drive", RENDER_JOB_NAME: "everlast-dev-render", RENDER_JOB_LOCATION: "europe-west4",
})) assert.equal(enabled.worker.env[key], value, `Worker must receive the declared ${key}`);
const jobs = enabled.byType("google_cloud_run_v2_job");
assert.equal(jobs.length, 1, "Approved image must produce exactly one render job");
const job = jobs[0].values;
assert.equal(job.name, "everlast-dev-render");
assert.equal(job.location, "europe-west4");
assert.equal(job.template[0].template[0].containers[0].image, "europe-west4-docker.pkg.dev/everlast-test/runtime/render:fixture");
assert.equal(job.template[0].template[0].vpc_access[0].egress, "ALL_TRAFFIC", "Render egress must stay in the isolated network");
assert.equal(enabled.byType("google_compute_network").length, 1);
assert.equal(enabled.byType("google_compute_subnetwork").length, 1);
assert.equal(enabled.byType("google_compute_subnetwork")[0].values.private_ip_google_access, true);
assert.equal(enabled.byType("google_compute_router_nat").length, 0, "No internet NAT or fixed idle cost is allowed for render");
assert.ok(enabled.byType("google_project_iam_member").some((item) => item.address.includes("worker_roles") && item.values.role === "roles/speech.client"));
assert.ok(enabled.byType("google_project_iam_member").some((item) => item.address.includes("worker_roles") && item.values.role === "roles/modelarmor.user"));
assert.equal(enabled.byType("google_secret_manager_secret_version").length, 0, "No secret values belong in this plan");
// [009-multimodal-ingestion-sync] T065: managed screening is fail-closed, EU-only and optional.
assert.equal(disabled.byType("google_model_armor_template").length, 0, "Defaults must not provision a screening template");
assert.equal(enabled.byType("google_model_armor_template").length, 0, "An existing template ID must not also create a managed template");
const managed = fixture("managed_prompt_injection_template");
const templates = managed.byType("google_model_armor_template");
assert.equal(templates.length, 1, "Managed mode must plan exactly one screening template");
const template = templates[0].values;
assert.equal(template.project, "everlast-test");
assert.equal(template.location, "europe-west4");
assert.equal(template.template_id, "everlast-dev-ingestion");
assert.equal(managed.worker.env.MODEL_ARMOR_TEMPLATE_ID, template.template_id, "Worker receives local template_id, not the full resource path");
const filters = template.filter_config[0];
assert.equal(filters.pi_and_jailbreak_filter_settings[0].filter_enforcement, "ENABLED");
assert.equal(filters.pi_and_jailbreak_filter_settings[0].confidence_level, "LOW_AND_ABOVE", "Block detections at every supported confidence threshold");
for (const optional of ["rai_settings", "sdp_settings", "malicious_uri_filter_settings", "filter_rule_settings"]) {
  assert.equal((filters[optional] ?? []).length, 0, `Only required injection screening is configured, not ${optional}`);
}
const metadata = template.template_metadata[0];
assert.equal(metadata.enforcement_type, "INSPECT_AND_BLOCK");
assert.equal(metadata.ignore_partial_invocation_failures, false);
assert.equal(metadata.data_residency_compliant, true);
assert.equal(metadata.log_sanitize_operations, false, "Sanitize contents must not be logged");
assert.deepEqual(metadata.modalities, ["MODALITY_TEXT"]);
console.log("PASS: mocked dev plans verify default-off resources, API/runtime/render wiring and optional fail-closed EU prompt-injection screening (FR-SI-01/05).");
