import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADVERSARIAL_CODE } from "@everlast/testkit/code-execution-fixtures";

/**
 * [010-code-execution-sandbox] T006 — managed sandbox adapter and per-attempt lifecycle contract
 * (FR-GC-08, NFR-SEC-01/02; spec FR-002, FR-003, FR-004, FR-006, SC-002, SC-004; D18/D19/D20).
 * The Agent Platform REST API is replaced by a recording fake `fetch`; nothing here reaches Google. The
 * application-side guarantees are asserted: request shape, no credentials in the payload, profile check,
 * deadline/destroy/late-result discard, size caps, unknown-outcome no-replay and idempotent deletion.
 */

let runtime: Record<string, any> = {};
const load = async () => {
  runtime = (await import("../src/chat/execution/runtime.ts").catch(() => ({}))) as Record<string, any>;
  return runtime;
};

const ENGINE = "projects/everlast-test/locations/europe-west4/reasoningEngines/123";
const SANDBOX = `${ENGINE}/sandboxEnvironments/456`;
const TOKEN = "ya29.test-access-token-never-in-payload";

type Call = { method: string; url: string; headers: Record<string, string>; body: any };

function b64(s: string | Buffer) {
  return Buffer.from(s).toString("base64");
}

/** Recording fake of the documented REST surface (v1beta1 sandboxEnvironments create/get/execute/delete). */
function fakeAgentPlatform(options: {
  machineConfig?: string;
  execute?: (body: any) => Promise<{ status: number; json: unknown }> | { status: number; json: unknown };
  createStatus?: number;
  deleteStatus?: number;
} = {}) {
  const calls: Call[] = [];
  const fetchImpl = async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init.method ?? "GET", url, headers, body });
    const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (url.endsWith("/sandboxEnvironments") && init.method === "POST") {
      if (options.createStatus) return json(options.createStatus, { error: { code: options.createStatus, message: "unavailable" } });
      return json(200, { name: `${ENGINE}/operations/op1`, done: false });
    }
    if (url.includes("/operations/op1")) {
      return json(200, {
        name: `${ENGINE}/operations/op1`,
        done: true,
        response: { name: SANDBOX, spec: { codeExecutionEnvironment: { codeLanguage: "LANGUAGE_PYTHON", ...(options.machineConfig ? { machineConfig: options.machineConfig } : {}) } }, state: "STATE_RUNNING" },
      });
    }
    if (url.endsWith(":execute")) {
      if (init.signal?.aborted) throw init.signal.reason;
      const answer = options.execute ? await new Promise<{ status: number; json: unknown }>((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
        Promise.resolve(options.execute!(body)).then(resolve, reject);
      }) : { status: 200, json: { outputs: [{ mimeType: "application/json", data: b64(JSON.stringify({ msg_out: "", msg_err: "" })) }] } };
      return json(answer.status, answer.json);
    }
    if (init.method === "DELETE") return json(options.deleteStatus ?? 200, options.deleteStatus === 404 ? { error: { code: 404 } } : { name: `${ENGINE}/operations/del`, done: true });
    return json(404, {});
  };
  return { calls, fetchImpl };
}

function client(fake: ReturnType<typeof fakeAgentPlatform>, extra: Record<string, unknown> = {}) {
  return new runtime.AgentPlatformSandboxRuntime({
    reasoningEngine: ENGINE,
    location: "europe-west4",
    accessToken: async () => TOKEN,
    fetch: fake.fetchImpl,
    pollIntervalMs: 1,
    ...extra,
  });
}

function resultOutput(result: unknown, stdout = "", stderr = "") {
  return {
    outputs: [
      { mimeType: "application/json", data: b64(JSON.stringify({ msg_out: stdout, msg_err: stderr })) },
      { mimeType: "application/json", data: b64(JSON.stringify(result)), metadata: { attributes: { file_name: b64("everlast_result.json") } } },
    ],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("T006 managed profile, region and request shape (FR-003, D18/D20, NFR-SEC-01)", () => {
  it("RT-01: documented limits are the application constants", async () => {
    await load();
    expect(runtime.SANDBOX_PROFILE).toEqual({ vcpu: 2, memory_gb: 1.5, machine_config: "default" });
    expect(runtime.EXECUTION_DEADLINE_MS).toBe(15_000);
    expect(runtime.MAX_FILE_IO_BYTES).toBe(100_000_000);
    expect(runtime.REQUIRED_LIBRARIES).toEqual(["math", "statistics", "numpy", "pandas", "matplotlib", "scipy"]);
  });

  it("RT-02: create uses the EU regional endpoint, Python, the default profile and a short explicit TTL; no credentials in payload", async () => {
    await load();
    const fake = fakeAgentPlatform();
    const sandbox = client(fake);
    const handle = await sandbox.create(randomUUID());
    expect(handle.name).toBe(SANDBOX);
    const create = fake.calls[0]!;
    expect(create.url).toBe(`https://europe-west4-aiplatform.googleapis.com/v1beta1/${ENGINE}/sandboxEnvironments`);
    expect(create.body.spec).toEqual({ codeExecutionEnvironment: { codeLanguage: "LANGUAGE_PYTHON" } });
    expect(create.body.ttl).toBe("120s");
    expect(create.headers.authorization).toBe(`Bearer ${TOKEN}`);
    for (const call of fake.calls) expect(JSON.stringify(call.body ?? {})).not.toContain(TOKEN);
  });

  it("RT-03: a non-EU location or a non-default machine profile is refused (D3, D18)", async () => {
    await load();
    expect(() => client(fakeAgentPlatform(), { location: "us-central1" })).toThrow(/region/i);
    const fake = fakeAgentPlatform({ machineConfig: "MACHINE_CONFIG_VCPU4_RAM4GIB" });
    await expect(client(fake).create(randomUUID())).rejects.toMatchObject({ failureCode: "SecurityViolation" });
    expect(fake.calls.some((c) => c.method === "DELETE")).toBe(true); // the unexpected sandbox is deleted at once
  });

  it("RT-04: provider unavailable on create maps to ProviderUnavailable (no execution)", async () => {
    await load();
    const fake = fakeAgentPlatform({ createStatus: 503 });
    await expect(client(fake).create(randomUUID())).rejects.toMatchObject({ failureCode: "ProviderUnavailable" });
    expect(fake.calls.some((c) => c.url.endsWith(":execute"))).toBe(false);
  });
});

describe("T006 execute payload and scoped input copies (FR-002, C-02)", () => {
  it("RT-05: code is wrapped in the harness; inputs are byte copies with internal names; no env/credentials/URLs", async () => {
    await load();
    const fake = fakeAgentPlatform({ execute: () => ({ status: 200, json: resultOutput({ status: "ok", results: [] }) }) });
    const sandbox = client(fake);
    const handle = await sandbox.create(randomUUID());
    await sandbox.execute(handle, { code: "emit('n', 1)", files: [{ name: "data.json", content: Buffer.from('{"values":[]}'), mimeType: "application/json" }] }, new AbortController().signal);
    const exec = fake.calls.find((c) => c.url.endsWith(":execute"))!;
    expect(exec.url).toBe(`https://europe-west4-aiplatform.googleapis.com/v1beta1/${SANDBOX}:execute`);
    const [codeChunk, fileChunk] = exec.body.inputs;
    expect(codeChunk.mimeType).toBe("application/json");
    const code = JSON.parse(Buffer.from(codeChunk.data, "base64").toString()).code as string;
    expect(code).toContain("emit('n', 1)");
    expect(code).toContain("everlast_result.json");
    expect(Buffer.from(fileChunk.metadata.attributes.file_name, "base64").toString()).toBe("data.json");
    const payload = JSON.stringify(exec.body);
    for (const forbidden of [TOKEN, "GOOGLE_APPLICATION_CREDENTIALS", "gs://", "https://storage.googleapis.com", "DATABASE_URL"]) expect(payload).not.toContain(forbidden);
  });

  it("RT-06: >100 MB of input files is refused before any sandbox exists (TemporaryStorageLimit)", async () => {
    await load();
    const fake = fakeAgentPlatform();
    const outcome = await runtime.runAttempt({
      runtime: client(fake),
      attemptId: randomUUID(),
      code: "pass",
      files: [{ name: "data.json", content: Buffer.alloc(100_000_001), mimeType: "application/json" }],
    });
    expect(outcome).toMatchObject({ kind: "failed", failureCode: "TemporaryStorageLimit", exitCode: null });
    expect(fake.calls).toHaveLength(0);
  });

  it("RT-07: >100 MB of output files is reported as TemporaryStorageLimit and nothing is kept", async () => {
    await load();
    const big = b64(Buffer.alloc(50_000_001));
    const fake = fakeAgentPlatform({
      execute: () => ({
        status: 200,
        json: { outputs: [{ mimeType: "image/png", data: big, metadata: { attributes: { file_name: b64("chart_1.png") } } }, { mimeType: "image/png", data: big, metadata: { attributes: { file_name: b64("chart_2.png") } } }] },
      }),
    });
    const outcome = await runtime.runAttempt({ runtime: client(fake), attemptId: randomUUID(), code: ADVERSARIAL_CODE.hugeOutput, files: [] });
    expect(outcome).toMatchObject({ kind: "failed", failureCode: "TemporaryStorageLimit" });
    expect(outcome.files ?? []).toEqual([]);
  });
});

describe("T006 per-attempt lifecycle (FR-003, FR-006, SC-004)", () => {
  it("RT-08: the 15.0 s application deadline deletes the sandbox, reports TimedOut with a null exit code and discards late results", async () => {
    await load();
    vi.useFakeTimers();
    let release!: (v: { status: number; json: unknown }) => void;
    const fake = fakeAgentPlatform({ execute: () => new Promise((resolve) => (release = resolve)) });
    const pending = runtime.runAttempt({ runtime: client(fake), attemptId: randomUUID(), code: ADVERSARIAL_CODE.infiniteLoop, files: [] });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fake.calls.some((c) => c.method === "DELETE")).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const outcome = await pending;
    release?.({ status: 200, json: resultOutput({ status: "ok", results: [{ label: "x", value: "42", unit: null, sources: [] }] }) });
    expect(outcome).toMatchObject({ kind: "failed", failureCode: "ExecutionTimeout", exitCode: null });
    expect(outcome.results ?? []).toEqual([]);
    expect(fake.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
  });

  it("RT-09: every attempt creates a fresh sandbox and deletes it afterwards, also on success", async () => {
    await load();
    const fake = fakeAgentPlatform({ execute: () => ({ status: 200, json: resultOutput({ status: "ok", results: [] }) }) });
    const sandbox = client(fake);
    await runtime.runAttempt({ runtime: sandbox, attemptId: randomUUID(), code: "pass", files: [] });
    await runtime.runAttempt({ runtime: sandbox, attemptId: randomUUID(), code: "pass", files: [] });
    expect(fake.calls.filter((c) => c.url.endsWith("/sandboxEnvironments") && c.method === "POST")).toHaveLength(2);
    expect(fake.calls.filter((c) => c.method === "DELETE")).toHaveLength(2);
  });

  it("RT-10: a transport failure after submission is ExecutionOutcomeUnknown and is never replayed", async () => {
    await load();
    const fake = fakeAgentPlatform({ execute: () => Promise.reject(new TypeError("fetch failed: socket hang up")) });
    const outcome = await runtime.runAttempt({ runtime: client(fake), attemptId: randomUUID(), code: "pass", files: [] });
    expect(outcome).toMatchObject({ kind: "failed", failureCode: "ExecutionOutcomeUnknown", exitCode: null });
    expect(fake.calls.filter((c) => c.url.endsWith(":execute"))).toHaveLength(1);
    expect(fake.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
  });

  it("RT-11: destroy is idempotent — an already-deleted sandbox (404) counts as destroyed", async () => {
    await load();
    const fake = fakeAgentPlatform({ deleteStatus: 404 });
    await expect(client(fake).destroy({ name: SANDBOX })).resolves.toBeUndefined();
  });

  it("RT-12: cancellation (clear chat / disconnect) aborts the attempt, deletes the sandbox and publishes nothing", async () => {
    await load();
    const fake = fakeAgentPlatform({ execute: () => new Promise(() => undefined) });
    const abort = new AbortController();
    const pending = runtime.runAttempt({ runtime: client(fake), attemptId: randomUUID(), code: "pass", files: [], signal: abort.signal });
    await new Promise((r) => setTimeout(r, 10));
    abort.abort(new Error("cleared"));
    const outcome = await pending;
    expect(outcome).toMatchObject({ kind: "failed", failureCode: "GenerationCancelled" });
    expect(fake.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
  });

  it("RT-13: lifecycle callbacks report the real handle (for the cleanup ledger) and the truthful running moment", async () => {
    await load();
    const fake = fakeAgentPlatform({ execute: () => ({ status: 200, json: resultOutput({ status: "ok", results: [] }) }) });
    const events: string[] = [];
    await runtime.runAttempt({
      runtime: client(fake),
      attemptId: randomUUID(),
      code: "pass",
      files: [],
      onCreated: async (h: { name: string }) => void events.push(`created:${h.name}`),
      onRunning: async () => void events.push("running"),
      onDestroyed: async () => void events.push("destroyed"),
    });
    expect(events).toEqual([`created:${SANDBOX}`, "running", "destroyed"]);
  });
});

describe("T006 outcome classification (FR-006, SC-002, SC-004)", () => {
  it("RT-14: a Python exception (e.g. a blocked network call) is PythonException with exit code 1 and stderr kept", async () => {
    await load();
    const stderr = "urllib.error.URLError: <urlopen error [Errno -3] Temporary failure in name resolution>";
    const fake = fakeAgentPlatform({ execute: () => ({ status: 200, json: resultOutput({ status: "exception", exception_type: "URLError", results: [] }, "", stderr) }) });
    const outcome = await runtime.runAttempt({ runtime: client(fake), attemptId: randomUUID(), code: ADVERSARIAL_CODE.http, files: [] });
    expect(outcome).toMatchObject({ kind: "failed", failureCode: "PythonException", exitCode: 1, stderr });
    expect(outcome.results ?? []).toEqual([]);
  });

  it("RT-15: a MemoryError reported by the sandbox is MemoryLimitExceeded (no retry class)", async () => {
    await load();
    const fake = fakeAgentPlatform({ execute: () => ({ status: 200, json: resultOutput({ status: "memory", exception_type: "MemoryError", results: [] }, "", "MemoryError") }) });
    const outcome = await runtime.runAttempt({ runtime: client(fake), attemptId: randomUUID(), code: ADVERSARIAL_CODE.memory, files: [] });
    expect(outcome).toMatchObject({ kind: "failed", failureCode: "MemoryLimitExceeded" });
    expect(runtime.isRetryableOutcome?.(outcome, 1)).toBe(false);
  });

  it("RT-16: a provider-killed run without a result file and a memory hint is MemoryLimitExceeded with a null exit code", async () => {
    await load();
    const fake = fakeAgentPlatform({ execute: () => ({ status: 400, json: { error: { code: 400, status: "RESOURCE_EXHAUSTED", message: "Sandbox ran out of memory" } } }) });
    const outcome = await runtime.runAttempt({ runtime: client(fake), attemptId: randomUUID(), code: ADVERSARIAL_CODE.memory, files: [] });
    expect(outcome).toMatchObject({ kind: "failed", failureCode: "MemoryLimitExceeded", exitCode: null });
  });

  it("RT-17: success yields exit code 0, stdout, harness results and only allow-listed output files", async () => {
    await load();
    const fake = fakeAgentPlatform({
      execute: () => ({
        status: 200,
        json: {
          outputs: [
            ...resultOutput({ status: "ok", results: [{ label: "sd", value: "3.452052529534663", unit: "ms", sources: [] }] }, "done\n").outputs,
            { mimeType: "image/png", data: b64("PNGDATA"), metadata: { attributes: { file_name: b64("chart_1.png") } } },
            { mimeType: "text/plain", data: b64("x"), metadata: { attributes: { file_name: b64("../../etc/passwd") } } },
            { mimeType: "text/plain", data: b64("x"), metadata: { attributes: { file_name: b64("data.json") } } },
          ],
        },
      }),
    });
    const outcome = await runtime.runAttempt({ runtime: client(fake), attemptId: randomUUID(), code: "emit('sd', 1)", files: [] });
    expect(outcome).toMatchObject({ kind: "completed", exitCode: 0, stdout: "done\n" });
    expect(outcome.results).toEqual([{ label: "sd", value: "3.452052529534663", unit: "ms", sources: [] }]);
    expect(outcome.files.map((f: { name: string }) => f.name)).toEqual(["chart_1.png"]);
  });
});

/**
 * Harness self-check with the local CPython (trusted fixture code only; NOT a sandbox and not the production
 * path). Verifies that the generated wrapper script records results/exceptions and refuses non-finite values.
 */
const python = (() => {
  try {
    execFileSync("python3", ["-c", "import math, statistics, json"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!python)("T006 harness script (local CPython self-check; UNAVAILABLE without python3)", () => {
  const run = (userCode: string, data = '{"values": [1, 2, 3]}') => {
    const dir = mkdtempSync(join(tmpdir(), "everlast-harness-"));
    writeFileSync(join(dir, "data.json"), data);
    writeFileSync(join(dir, "run.py"), runtime.buildHarness(userCode));
    try {
      execFileSync("python3", ["-I", "run.py"], { cwd: dir, stdio: "pipe", env: { PATH: process.env.PATH ?? "" }, timeout: 10_000 });
    } catch {
      // non-zero exits are part of the contract under test
    }
    return JSON.parse(readFileSync(join(dir, "everlast_result.json"), "utf8"));
  };

  it("RT-18: emit() records canonical repr() values; exceptions and NaN are reported, never published", async () => {
    await load();
    const sd = run("import statistics\nemit('sd', statistics.pstdev(range(1, 13)), unit='ms', sources=['c1'])");
    expect(sd).toMatchObject({ status: "ok", results: [{ label: "sd", unit: "ms", sources: ["c1"] }] });
    // The sandbox's own repr() is published verbatim; it may differ in the last digit from a JS-side formula
    // (CPython pstdev is correctly rounded: 3.4520525295346633), so the oracle compares numerically.
    expect(sd.results[0].value).toMatch(/^3\.45205252953466\d*$/);
    expect(Math.abs(Number(sd.results[0].value) - Math.sqrt(143 / 12))).toBeLessThan(1e-12);
    expect(run("1/0")).toMatchObject({ status: "exception", exception_type: "ZeroDivisionError", results: [] });
    expect(run("emit('x', float('nan'))")).toMatchObject({ status: "exception", exception_type: "ValueError", results: [] });
    expect(run("emit('x', True)")).toMatchObject({ status: "exception", results: [] });
    expect(run("import json\nemit('n', len(json.load(open('data.json'))['values']))").results[0].value).toBe("3");
  });
});
