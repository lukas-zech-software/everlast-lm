import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GoogleAuth } from "google-auth-library";
import {
  ensureDevEnvironmentForTests,
  type DevEnvironmentLease,
} from "@everlast/testkit/live-fixtures";
import {
  AgentPlatformSandboxRuntime,
  REQUIRED_LIBRARIES,
  runAttempt,
} from "../src/chat/execution/runtime.ts";

/**
 * [010-code-execution-sandbox] T025 — simple dev-only functional smoke tests against the Agent Platform
 * Code Execution sandbox (FR-GC-08, D19/D20/D24).
 * Opt-in: CODE_EXECUTION_IT=1 plus CODE_EXECUTION_REASONING_ENGINE in europe-west4 and ADC.
 * Runs only on `dev`, prompts before starting `dev` if scaled down, and scales back down afterward.
 */

const engine = process.env.CODE_EXECUTION_REASONING_ENGINE ?? "";
const enabled =
  process.env.CODE_EXECUTION_IT === "1" &&
  /\/locations\/europe-west4\/reasoningEngines\/\d+$/.test(engine);
if (!enabled)
  console.warn(
    "UNAVAILABLE: dev managed sandbox smoke test (set CODE_EXECUTION_IT=1 and CODE_EXECUTION_REASONING_ENGINE)",
  );

function live() {
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  return new AgentPlatformSandboxRuntime({
    reasoningEngine: engine,
    location: "europe-west4",
    accessToken: async () => (await (await auth.getClient()).getAccessToken()).token ?? "",
  });
}

const attempt = (
  code: string,
  files: Array<{ name: string; content: Buffer; mimeType: string }> = [],
) => runAttempt({ runtime: live(), attemptId: randomUUID(), code, files });

describe.skipIf(!enabled)("T025 managed sandbox smoke tests on dev (live, opt-in)", () => {
  let devLease: DevEnvironmentLease | undefined;

  beforeAll(async () => {
    devLease = await ensureDevEnvironmentForTests({ env: process.env });
  });

  afterAll(async () => {
    await devLease?.restore();
  });

  it("LIVE-01: required libraries are preinstalled and emit() returns exact values", async () => {
    const imports = REQUIRED_LIBRARIES.map((l) => `import ${l}`).join("\n");
    const outcome = await attempt(
      `${imports}\nimport statistics\nemit('sd', statistics.pstdev(range(1, 13)), unit='ms')`,
    );
    expect(outcome.kind).toBe("completed");
    if (outcome.kind === "completed")
      expect(Number(outcome.results[0]!.value)).toBeCloseTo(Math.sqrt(143 / 12), 12);
  }, 60_000);

  it("LIVE-02: input files are isolated copies and results round-trip cleanly across runs", async () => {
    const files = [
      {
        name: "data.json",
        content: Buffer.from('{"values":[{"value":1}]}'),
        mimeType: "application/json",
      },
    ];
    await attempt(
      "open('data.json','w').write('{\"values\":[]}')\nopen('leak.txt','w').write('x')\nemit('ok', 1)",
      files,
    );
    const second = await attempt(
      "import json, os\nemit('n', len(json.load(open('data.json'))['values']))\nemit('leak', int(os.path.exists('leak.txt')))",
      files,
    );
    expect(second.kind).toBe("completed");
    if (second.kind === "completed") expect(second.results.map((r) => r.value)).toEqual(["1", "0"]);
  }, 90_000);
});
