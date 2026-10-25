import { randomUUID } from "node:crypto";
import type { UnifiedDocumentChunk } from "@everlast/contracts";
import { TINY_PNG_BASE64 } from "@everlast/testkit/code-execution-fixtures";
import type { RawExecution, SandboxFile, SandboxHandle, SandboxRuntime } from "../src/chat/execution/runtime.ts";
import type { GroundedDraft } from "../src/chat/draft.ts";

/**
 * TEST DOUBLE (specs/010): a scripted stand-in for the managed Agent Platform sandbox. It never runs Python. It
 * "interprets" fixture programs by a `# FIXTURE:<op>` marker using the scoped data.json it was given, so the
 * application pipeline (manifest → execution → validation → publication) is exercised deterministically. Real
 * isolation/limits are the provider's (D20) and are covered by the gated runtime integration suite.
 */

export interface SandboxCall {
  handle: string;
  code: string;
  files: SandboxFile[];
}

type Script = (call: SandboxCall, attempt: number) => Promise<RawExecution> | RawExecution;

export const resultFile = (result: unknown): SandboxFile => ({ name: "everlast_result.json", content: Buffer.from(JSON.stringify(result)), mimeType: "application/json" });
export const pngFile = (name = "chart_1.png"): SandboxFile => ({ name, content: Buffer.from(TINY_PNG_BASE64, "base64"), mimeType: "image/png" });

function values(call: SandboxCall): { value: number; unit: string | null; chunk_id: string; label: string }[] {
  const data = call.files.find((f) => f.name === "data.json");
  return data ? (JSON.parse(data.content.toString()) as { values: { value: number; unit: string | null; chunk_id: string; label: string }[] }).values : [];
}

/** Deterministic interpretation of the fixture programs used by the suites. */
export function interpretFixture(call: SandboxCall): RawExecution {
  const op = /# FIXTURE:(\w+)/.exec(call.code)?.[1] ?? "none";
  const v = values(call);
  const nums = v.map((x) => x.value);
  const sources = [...new Set(v.map((x) => x.chunk_id))];
  const mean = nums.reduce((a, b) => a + b, 0) / Math.max(1, nums.length);
  const ss = nums.reduce((a, b) => a + (b - mean) ** 2, 0);
  switch (op) {
    case "pstdev":
      return { stdout: "computed population sd\n", stderr: "", files: [resultFile({ status: "ok", results: [{ label: "Population standard deviation", value: String(Math.sqrt(ss / nums.length)), unit: "ms", sources }] }), pngFile()] };
    case "stdev":
      return { stdout: "computed sample sd\n", stderr: "", files: [resultFile({ status: "ok", results: [{ label: "Sample standard deviation", value: String(Math.sqrt(ss / (nums.length - 1))), unit: "ms", sources }] }), pngFile()] };
    case "cagr": {
      // Explicit normalization (FR-008): billions → millions.
      const millions = v.map((x) => (x.unit === "USD billion" ? x.value * 1000 : x.value));
      const cagr = Math.pow(millions[1]! / millions[0]!, 1 / 4) - 1;
      return { stdout: "", stderr: "", files: [resultFile({ status: "ok", results: [{ label: "R&D spend CAGR 2021–2025", value: String(cagr), unit: null, sources }] })] };
    }
    case "raise":
      return { stdout: "", stderr: "Traceback (most recent call last):\nZeroDivisionError: division by zero\n", files: [resultFile({ status: "exception", exception_type: "ZeroDivisionError", results: [] })] };
    case "network":
      return { stdout: "", stderr: "urllib.error.URLError: <urlopen error [Errno -3] Temporary failure in name resolution>\n", files: [resultFile({ status: "exception", exception_type: "URLError", results: [] })] };
    case "memory":
      return { stdout: "", stderr: "MemoryError\n", files: [resultFile({ status: "memory", exception_type: "MemoryError", results: [] })] };
    case "forge":
      return { stdout: "", stderr: "", files: [resultFile({ status: "ok", results: [{ label: "x", value: "1", unit: null, sources: ["0190f0b5-7d1c-7a4e-9b2a-3c4d5e6f7a8b"] }] })] };
    case "nan":
      return { stdout: "", stderr: "", files: [resultFile({ status: "ok", results: [{ label: "x", value: "NaN", unit: null, sources }] })] };
    default:
      return { stdout: "", stderr: "", files: [resultFile({ status: "ok", results: [] })] };
  }
}

export class ScriptedSandbox implements SandboxRuntime {
  readonly id = "scripted-sandbox-test-double";
  created: string[] = [];
  destroyed: string[] = [];
  calls: SandboxCall[] = [];
  script: Script = (call) => interpretFixture(call);
  /** When set, `execute` waits for this promise (cancellation / deadline tests). */
  gate: Promise<void> | null = null;
  failCreate = false;

  async create(): Promise<SandboxHandle> {
    if (this.failCreate) {
      const { SandboxError } = await import("../src/chat/execution/runtime.ts");
      throw new SandboxError("ProviderUnavailable", "test double: create unavailable");
    }
    const name = `projects/test/locations/europe-west4/reasoningEngines/1/sandboxEnvironments/${randomUUID()}`;
    this.created.push(name);
    return { name };
  }

  async execute(handle: SandboxHandle, input: { code: string; files: SandboxFile[] }, signal: AbortSignal): Promise<RawExecution> {
    const call = { handle: handle.name, code: input.code, files: input.files.map((f) => ({ ...f, content: Buffer.from(f.content) })) };
    this.calls.push(call);
    if (this.gate) {
      await Promise.race([this.gate, new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))]);
    }
    return this.script(call, this.calls.length);
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    this.destroyed.push(handle.name);
  }

  reset(): void {
    this.created = [];
    this.destroyed = [];
    this.calls = [];
    this.script = (call) => interpretFixture(call);
    this.gate = null;
    this.failCreate = false;
  }
}

/** Compute draft over the 12 latency chunks/rows: values are copied verbatim with their chunk IDs. */
export function latencyComputeDraft(chunks: UnifiedDocumentChunk[], op: "pstdev" | "stdev" | "raise" | "network" | "memory" | "forge" | "nan" = "pstdev", preamble = true): GroundedDraft {
  const rows: { label: string; value: string; chunk_id: string }[] = [];
  for (const c of chunks) {
    for (const m of c.text.matchAll(/(\w{3}) 2025: (\d+) ms/g)) rows.push({ label: `${m[1]} 2025`, value: m[2]!, chunk_id: c.chunk_id });
  }
  const first = chunks.find((c) => /2025: \d+ ms/.test(c.text));
  return {
    status: "compute",
    sentences: preamble && first ? [{ text: "The latency table lists monthly server latency in ms for 2025.", citations: [first.chunk_id], kind: "claim" }] : [],
    computation: {
      intent: op === "stdev" ? "sample standard deviation" : "population standard deviation",
      dataset: rows.map((r) => ({ ...r, unit: "ms" })),
      code: `# FIXTURE:${op}\nimport json, statistics\nimport matplotlib.pyplot as plt\nrows = json.load(open('data.json'))['values']\nvals = [r['value'] for r in rows]\nemit('Population standard deviation', statistics.pstdev(vals), unit='ms', sources=[r['chunk_id'] for r in rows])\nplt.plot(vals); plt.savefig('chart_1.png')\n`,
    },
  } as GroundedDraft;
}
