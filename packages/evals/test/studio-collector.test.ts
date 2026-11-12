import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** [011-studio-mindmaps-data-tables] T059: ordinary HTTP collector, SC-002/FR-ST-08, no real model call. */
let server: Server;
let baseUrl: string;
let posts = 0;
let completed = false;
let rejectOne = false;
let payload: unknown;
const dir = mkdtempSync(join(tmpdir(), "studio-collector-test-"));
const nb = "01965b10-0000-7000-8000-000000000301";
const src = "01965b10-0000-7000-8000-000000000302";
const artifactId = "01965b10-0000-7000-8000-000000000303";
beforeAll(async () => {
  // Canonical schema-shaped transport double; no app implementation imports.
  const cite = { badge_number: 1, source_id: src, chunk_id: "01965b10-0000-7000-8000-000000000304", revision: 1, snippet: "Fixture evidence" };
  const node = (id: string, children: unknown[] = []) => ({ id, label: "Fixture", summary: "Fixture evidence", label_citations: [cite], summary_citations: [cite], children });
  payload = { root_node: node("root", [node("child")]), node_count: 2, max_depth: 2, initial_expanded_depth: 2, citations: [cite], insufficient_evidence_note: "Evidence-limited local fixture" };
  server = createServer(async (req, res) => {
    if (req.method === "POST") {
      posts++;
      if (rejectOne && posts === 1) { res.writeHead(503).end('{}'); return; }
      const acceptedId = `01965b10-0000-7000-8000-${String(posts).padStart(12, "0")}`;
      let body = ""; for await (const part of req) body += part;
      const parsed = JSON.parse(body);
      if (req.url !== `/api/notebooks/${nb}/studio/artifacts` || parsed.active_source_ids?.[0] !== src || req.headers.authorization !== "Bearer local-test-token") {
        res.writeHead(400).end('{}'); return;
      }
      // A failed application job is retained; it must never be silently resubmitted/replaced.
      res.writeHead(202, { "Content-Type": "application/json" }).end(JSON.stringify({ artifact: { id: acceptedId, status: "Queued" } }));
    } else {
      const artifactId = req.url!.split("/").at(-1)!;
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ artifact: completed ? { id: artifactId, status: "Completed", plugin_type: "mindmap", payload_json: payload } : { id: artifactId, status: "Failed", failure: { code: "GenerationError" } } }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(dir, { recursive: true, force: true }); });

function cli(args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise(resolve => {
    const p = spawn(process.execPath, ["scripts/eval-v3-studio.mjs", ...args], { env: { ...process.env, STUDIO_BENCHMARK_IT: "1", STUDIO_BENCHMARK_TOKEN: "local-test-token" } });
    let output = ""; p.stdout.on("data", x => output += x); p.stderr.on("data", x => output += x);
    p.on("close", code => resolve({ code, output }));
  });
}

describe("[011-studio-mindmaps-data-tables] T059: real collector mechanics (FR-ST-08, C-03, SC-002)", () => {
  it("submits the declared scope once per run, checkpoints actual failed jobs and returns FAIL rather than UNAVAILABLE or success", async () => {
    const plan = {
      declared_at: "2026-01-01T00:00:00Z", fixture_sha256: "a".repeat(64), deployment_revision: "test-double", environment: "local fixture", environment_kind: "local_fixture", region: "europe-west4", model: "deterministic-test-double",
      base_url: baseUrl, notebook_id: nb, active_source_ids: [src], poll_interval_ms: 1, timeout_ms: 1000,
      runs: Array.from({ length: 20 }, (_, i) => ({ sample_id: `sample-${i + 1}`, stratum: i < 5 ? "cold" : "warm" })),
    };
    const file = join(dir, "plan.json"); writeFileSync(file, JSON.stringify(plan));
    const result = await cli(["--collect", "--plan", file, "--out", dir]);
    expect(result.code, result.output).toBe(1);
    expect(posts).toBe(20);
    const report = JSON.parse(readFileSync(join(dir, "v3-studio-benchmark.json"), "utf8"));
    expect(report.status).toBe("FAIL");
    expect(report.latency_cohort.samples).toHaveLength(20);
    expect(report.latency_cohort.samples.every((s: { status: string }) => s.status === "Failed")).toBe(true);
    expect(report.release_eligible).toBe(false);
    expect(report.provenance.plan_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(join(dir, "v3-studio-observations.json"), "utf8")).not.toContain("local-test-token");
  });
  it("records a complete local API cohort as diagnostic evidence with consistent measured timestamps", async () => {
    completed = true; posts = 0;
    const plan = { declared_at: "2026-01-01T00:00:00Z", fixture_sha256: "a".repeat(64), deployment_revision: "test-double", environment: "local fixture", environment_kind: "local_fixture", region: "europe-west4", model: "deterministic-test-double", base_url: baseUrl, notebook_id: nb, active_source_ids: [src], poll_interval_ms: 1, timeout_ms: 1000, runs: Array.from({ length: 20 }, (_, i) => ({ sample_id: `completed-${i}`, stratum: "warm" })) };
    const file = join(dir, "completed-plan.json"); writeFileSync(file, JSON.stringify(plan));
    const result = await cli(["--collect", "--plan", file, "--out", dir]);
    expect(result.code, result.output).toBe(0);
    const report = JSON.parse(readFileSync(join(dir, "v3-studio-benchmark.json"), "utf8"));
    expect(report.status).toBe("DIAGNOSTIC_PASS");
    expect(report.release_eligible).toBe(false);
    expect(posts).toBe(20);
    expect(report.latency_cohort.samples.every((sample: { status: string; duration_ms: number; completed_at_ms: number; submitted_at_ms: number }) => sample.status === "Completed" && Math.abs(sample.completed_at_ms - sample.submitted_at_ms - sample.duration_ms) < 0.001)).toBe(true);
  });
  it("cannot pass with fewer accepted jobs than the declared cohort even when nearest-rank P95 alone would pass", async () => {
    completed = true; rejectOne = true; posts = 0;
    const plan = { declared_at: "2026-01-01T00:00:00Z", fixture_sha256: "a".repeat(64), deployment_revision: "test-double", environment: "local fixture", environment_kind: "local_fixture", region: "europe-west4", model: "deterministic-test-double", base_url: baseUrl, notebook_id: nb, active_source_ids: [src], poll_interval_ms: 1, timeout_ms: 1000, runs: Array.from({ length: 20 }, (_, i) => ({ sample_id: `rejected-${i}`, stratum: "warm" })) };
    const file = join(dir, "rejected-plan.json"); writeFileSync(file, JSON.stringify(plan));
    const result = await cli(["--collect", "--plan", file, "--out", dir]);
    expect(result.code, result.output).toBe(1);
    const report = JSON.parse(readFileSync(join(dir, "v3-studio-benchmark.json"), "utf8"));
    expect(report.accepted_count).toBe(19);
    expect(report.status).toBe("FAIL");
    expect(report.latency_cohort.samples).toHaveLength(20);
  });

});
