import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GoogleAuth } from "google-auth-library";
import { ADVERSARIAL_CODE } from "@everlast/testkit/code-execution-fixtures";
import { AgentPlatformSandboxRuntime, REQUIRED_LIBRARIES, runAttempt } from "../src/chat/execution/runtime.ts";

/**
 * [010-code-execution-sandbox] T025 — ordinary managed-service integration tests against the REAL Agent Platform
 * Code Execution sandbox (FR-GC-08, NFR-SEC-01/02; spec FR-002, FR-003, FR-006, SC-002, SC-004; D19/D20).
 * Synthetic fixtures only. Opt-in: CODE_EXECUTION_IT=1 plus an owner-approved CODE_EXECUTION_REASONING_ENGINE in
 * europe-west4 and ADC for an identity allowed to use it. Without that the suite is skipped and reported as
 * UNAVAILABLE — never as a pass. No packet capture (D20): network isolation is checked by failing calls.
 */

const engine = process.env.CODE_EXECUTION_REASONING_ENGINE ?? "";
const enabled = process.env.CODE_EXECUTION_IT === "1" && /\/locations\/europe-west4\/reasoningEngines\/\d+$/.test(engine);
if (!enabled) console.warn("UNAVAILABLE: managed sandbox integration (set CODE_EXECUTION_IT=1 and CODE_EXECUTION_REASONING_ENGINE)");

function live() {
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  return new AgentPlatformSandboxRuntime({
    reasoningEngine: engine,
    location: "europe-west4",
    accessToken: async () => (await (await auth.getClient()).getAccessToken()).token ?? "",
  });
}

const attempt = (code: string, files: { name: string; content: Buffer; mimeType: string }[] = []) =>
  runAttempt({ runtime: live(), attemptId: randomUUID(), code, files });

describe.skipIf(!enabled)("T025 managed sandbox isolation and limits (live, opt-in)", () => {
  it("LIVE-01: required libraries are preinstalled and emit() returns exact values", async () => {
    const imports = REQUIRED_LIBRARIES.map((l) => `import ${l}`).join("\n");
    const outcome = await attempt(`${imports}\nimport statistics\nemit('sd', statistics.pstdev(range(1, 13)), unit='ms')`);
    expect(outcome.kind).toBe("completed");
    if (outcome.kind === "completed") expect(Number(outcome.results[0]!.value)).toBeCloseTo(Math.sqrt(143 / 12), 12);
  }, 60_000);

  it.each([
    ["http", ADVERSARIAL_CODE.http],
    ["dns", ADVERSARIAL_CODE.dns],
    ["metadata", ADVERSARIAL_CODE.metadata],
    ["private address", ADVERSARIAL_CODE.privateAddress],
    ["pip", ADVERSARIAL_CODE.pip],
  ])("LIVE-02 (%s): outbound network from executed code fails — zero successful connections", async (_name, code) => {
    const outcome = await attempt(code);
    expect(outcome.kind).toBe("failed");
  }, 60_000);

  it("LIVE-03: no credentials or service-account tokens are visible inside the sandbox", async () => {
    const outcome = await attempt("import os, json\nemit('n', sum(1 for k in os.environ if any(s in k.upper() for s in ('TOKEN','SECRET','CREDENTIAL','KEY'))))");
    expect(outcome.kind).toBe("completed");
    if (outcome.kind === "completed") expect(outcome.results[0]!.value).toBe("0");
  }, 60_000);

  it("LIVE-04: input files are copies — a modification is not visible to the next fresh sandbox", async () => {
    const files = [{ name: "data.json", content: Buffer.from('{"values":[{"value":1}]}'), mimeType: "application/json" }];
    await attempt("open('data.json','w').write('{\"values\":[]}')\nopen('leak.txt','w').write('x')\nemit('ok', 1)", files);
    const second = await attempt("import json, os\nemit('n', len(json.load(open('data.json'))['values']))\nemit('leak', int(os.path.exists('leak.txt')))", files);
    expect(second.kind).toBe("completed");
    if (second.kind === "completed") expect(second.results.map((r) => r.value)).toEqual(["1", "0"]);
  }, 90_000);

  it("LIVE-05: the 15.0 s application deadline stops an infinite loop and deletes the sandbox", async () => {
    const started = Date.now();
    const outcome = await attempt(ADVERSARIAL_CODE.infiniteLoop);
    expect(outcome).toMatchObject({ kind: "failed", failureCode: "ExecutionTimeout", exitCode: null, destroyed: true });
    expect(Date.now() - started).toBeLessThan(15_000 + 20_000);
  }, 60_000);

  it("LIVE-06: a memory blow-up is reported as MemoryLimitExceeded (managed 1.5 GB)", async () => {
    const outcome = await attempt(ADVERSARIAL_CODE.memory);
    expect(outcome).toMatchObject({ kind: "failed", failureCode: "MemoryLimitExceeded" });
  }, 60_000);

  it("LIVE-07: >100 MB of output files is refused", async () => {
    const outcome = await attempt(ADVERSARIAL_CODE.hugeOutput);
    expect(outcome.kind).toBe("failed");
  }, 90_000);
});
