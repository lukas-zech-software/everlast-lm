import type { CodeExecutionFailureCode } from "@everlast/contracts";

/**
 * Managed sandbox adapter + per-attempt lifecycle (FR-GC-08, NFR-SEC-01/02; specs/010 T012/T028; D18, D19, D20).
 *
 * Generated Python is hostile input. It never runs in the API process: every attempt gets a FRESH Agent Platform
 * Code Execution sandbox (no network, managed default 2 vCPU / 1.5 GB, provider file system), receives only
 * byte copies of scoped input files, and is deleted afterwards. The API calls the provider with its own keyless
 * identity; no credential, URL or environment value is placed in the sandbox payload. The provider documents no
 * execution timeout, so the application enforces 15.0 s per attempt by aborting, deleting the sandbox and
 * discarding any later result. An outcome that is unknown after submission is never replayed.
 */

export const SANDBOX_PROFILE = Object.freeze({ vcpu: 2, memory_gb: 1.5, machine_config: "default" as const });
export const EXECUTION_DEADLINE_MS = 15_000;
/** Provider limit: ≤ 100 MB of files per request or response (D20). Decimal MB, enforced conservatively. */
export const MAX_FILE_IO_BYTES = 100_000_000;
/** Short explicit TTL: cleanup defense only, never the timeout mechanism (D20). */
export const SANDBOX_TTL_SECONDS = 120;
export const REQUIRED_LIBRARIES = Object.freeze(["math", "statistics", "numpy", "pandas", "matplotlib", "scipy"]);
export const RESULT_FILE = "everlast_result.json";
/** The only output files the application accepts back; everything else returned by the sandbox is ignored. */
export const OUTPUT_FILE_RE = /^chart_[1-5]\.(png|svg)$/;
const MAX_TEXT = 200_000;

export class SandboxError extends Error {
  readonly failureCode: CodeExecutionFailureCode;
  constructor(failureCode: CodeExecutionFailureCode, message: string) {
    super(message);
    this.name = "SandboxError";
    this.failureCode = failureCode;
  }
}

export interface SandboxHandle {
  name: string;
}

export interface SandboxFile {
  name: string;
  content: Buffer;
  mimeType: string;
}

export interface RawExecution {
  stdout: string;
  stderr: string;
  files: SandboxFile[];
}

export interface SandboxRuntime {
  readonly id: string;
  create(attemptId: string, signal?: AbortSignal): Promise<SandboxHandle>;
  execute(handle: SandboxHandle, input: { code: string; files: SandboxFile[] }, signal: AbortSignal): Promise<RawExecution>;
  destroy(handle: SandboxHandle): Promise<void>;
}

/** Values emitted by `emit()` inside the harness, before application-side validation. */
export interface HarnessResult {
  label: string;
  value: string;
  unit: string | null;
  sources: string[];
}

/**
 * The Python wrapper around generated code. It exposes `emit(label, value, unit=None, sources=None)` recording the
 * exact `repr()` of finite numbers, runs the code with a non-interactive matplotlib backend and writes a result
 * file. It is not a security boundary (the code shares its interpreter); isolation is the managed sandbox's.
 */
export function buildHarness(userCode: string): string {
  return [
    "import json as _everlast_json, math as _everlast_math, os as _everlast_os, traceback as _everlast_tb",
    "_everlast_os.environ['MPLBACKEND'] = 'Agg'",
    "_EVERLAST = {'status': 'ok', 'results': []}",
    "def emit(label, value, unit=None, sources=None):",
    "    if isinstance(value, bool):",
    "        raise TypeError('emit() needs a real number, not a bool')",
    "    if isinstance(value, int) or (hasattr(value, '__index__') and not hasattr(value, 'is_integer')):",
    "        text = str(int(value))",
    "    elif isinstance(value, float) or hasattr(value, '__float__'):",
    "        number = float(value)",
    "        if not _everlast_math.isfinite(number):",
    "            raise ValueError('emit() value must be finite')",
    "        text = repr(number)",
    "    else:",
    "        raise TypeError('emit() needs a real number')",
    "    _EVERLAST['results'].append({'label': str(label)[:200], 'value': text, 'unit': None if unit is None else str(unit)[:40], 'sources': [str(s) for s in (sources or [])][:200]})",
    `_EVERLAST_CODE = ${JSON.stringify(userCode)}`,
    "try:",
    "    exec(compile(_EVERLAST_CODE, 'analysis.py', 'exec'), {'__name__': '__main__', 'emit': emit})",
    "except MemoryError:",
    "    _EVERLAST = {'status': 'memory', 'exception_type': 'MemoryError', 'results': []}",
    "    _everlast_tb.print_exc()",
    "except BaseException as _everlast_error:",
    "    _EVERLAST = {'status': 'exception', 'exception_type': type(_everlast_error).__name__, 'results': []}",
    "    _everlast_tb.print_exc()",
    `with open(${JSON.stringify(RESULT_FILE)}, 'w') as _everlast_file:`,
    "    _everlast_json.dump(_EVERLAST, _everlast_file)",
    "",
  ].join("\n");
}

// ---- Agent Platform REST adapter (v1beta1 sandboxEnvironments) ---------------------------------------------

export interface AgentPlatformSandboxOptions {
  /** projects/<p>/locations/europe-west4/reasoningEngines/<id> (parent runtime without deployed agent code). */
  reasoningEngine: string;
  location: string;
  /** Keyless runtime identity (ADC) access token for the API's own service account. */
  accessToken: () => Promise<string>;
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  createTimeoutMs?: number;
  destroyTimeoutMs?: number;
  ttlSeconds?: number;
}

const b64 = (value: string | Buffer) => Buffer.from(value).toString("base64");

/** REST `bytes` attributes are base64; tolerate raw strings from older API surfaces. */
function decodeAttribute(value: unknown): string {
  if (typeof value !== "string") return "";
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value.replace(/\s/g, "") ? decoded.toString("utf8") : value;
}

function looksLikeMemory(text: string): boolean {
  return /memory|oom|MemoryError|Killed/i.test(text);
}

export class AgentPlatformSandboxRuntime implements SandboxRuntime {
  readonly id = "agent-platform-code-execution";
  private readonly options: Required<Omit<AgentPlatformSandboxOptions, "fetch">> & { fetch: typeof fetch };
  private readonly base: string;

  constructor(options: AgentPlatformSandboxOptions) {
    if (options.location !== "europe-west4") throw new Error("Code execution region must be europe-west4 (D3)");
    if (!options.reasoningEngine.includes(`/locations/${options.location}/reasoningEngines/`)) {
      throw new Error("The parent runtime must be in the configured region (D3)");
    }
    this.options = {
      pollIntervalMs: 250,
      createTimeoutMs: 20_000,
      destroyTimeoutMs: 5_000,
      ttlSeconds: SANDBOX_TTL_SECONDS,
      ...options,
      fetch: options.fetch ?? fetch,
    };
    this.base = `https://${options.location}-aiplatform.googleapis.com/v1beta1`;
  }

  private async call(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
    const token = await this.options.accessToken();
    signal?.throwIfAborted();
    return this.options.fetch(`${this.base}/${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  }

  async create(attemptId: string, signal?: AbortSignal): Promise<SandboxHandle> {
    let response: Response;
    try {
      response = await this.call(
        "POST",
        `${this.options.reasoningEngine}/sandboxEnvironments`,
        {
          displayName: `everlast-${attemptId}`,
          // machineConfig deliberately unset → provider default 2 vCPU / 1.5 GB (D18); verified below.
          spec: { codeExecutionEnvironment: { codeLanguage: "LANGUAGE_PYTHON" } },
          ttl: `${this.options.ttlSeconds}s`,
        },
        signal
      );
    } catch (err) {
      throw new SandboxError("ProviderUnavailable", `create failed: ${(err as Error).message}`);
    }
    if (!response.ok) throw new SandboxError("ProviderUnavailable", `create returned ${response.status}`);
    let operation = (await response.json()) as { name?: string; done?: boolean; error?: unknown; response?: Record<string, any> };
    const deadline = Date.now() + this.options.createTimeoutMs;
    while (!operation.done) {
      if (Date.now() > deadline) throw new SandboxError("ProviderUnavailable", "sandbox creation timed out");
      if (signal?.aborted) throw new SandboxError("GenerationCancelled", "cancelled during creation");
      await new Promise((r) => setTimeout(r, this.options.pollIntervalMs));
      const poll = await this.call("GET", operation.name ?? "", undefined, signal).catch((err) => {
        throw new SandboxError("ProviderUnavailable", `operation poll failed: ${(err as Error).message}`);
      });
      if (!poll.ok) throw new SandboxError("ProviderUnavailable", `operation poll returned ${poll.status}`);
      operation = (await poll.json()) as typeof operation;
    }
    if (operation.error || !operation.response?.name) throw new SandboxError("ProviderUnavailable", "sandbox creation failed");
    const handle = { name: String(operation.response.name) };
    const environment = operation.response.spec?.codeExecutionEnvironment ?? {};
    const machine = environment.machineConfig;
    const unexpectedProfile = machine !== undefined && machine !== null && machine !== "" && machine !== "MACHINE_CONFIG_UNSPECIFIED";
    if (unexpectedProfile || (environment.codeLanguage && environment.codeLanguage !== "LANGUAGE_PYTHON")) {
      await this.destroy(handle).catch(() => undefined);
      throw new SandboxError("SecurityViolation", "sandbox profile differs from the approved managed default");
    }
    return handle;
  }

  async execute(handle: SandboxHandle, input: { code: string; files: SandboxFile[] }, signal: AbortSignal): Promise<RawExecution> {
    const body = {
      inputs: [
        { mimeType: "application/json", data: b64(JSON.stringify({ code: buildHarness(input.code) })) },
        ...input.files.map((f) => ({ mimeType: f.mimeType, data: b64(f.content), metadata: { attributes: { file_name: b64(f.name) } } })),
      ],
    };
    let response: Response;
    try {
      response = await this.call("POST", `${handle.name}:execute`, body, signal);
    } catch (err) {
      if (signal.aborted) throw signal.reason ?? err;
      // Submitted (or possibly submitted): the outcome is unknown and must not be replayed.
      throw new SandboxError("ExecutionOutcomeUnknown", `execute transport failure: ${(err as Error).message}`);
    }
    const text = await readCapped(response, Math.ceil(MAX_FILE_IO_BYTES * 1.4) + 1_000_000);
    if (text === null) throw new SandboxError("TemporaryStorageLimit", "sandbox response exceeds the 100 MB file limit");
    if (!response.ok) {
      if (looksLikeMemory(text)) throw new SandboxError("MemoryLimitExceeded", "sandbox reported a memory error");
      if (response.status === 413 || /too large|exceed.*(size|limit)/i.test(text)) throw new SandboxError("TemporaryStorageLimit", "file limit exceeded");
      if (response.status >= 500) throw new SandboxError("ExecutionOutcomeUnknown", `execute returned ${response.status}`);
      throw new SandboxError("ProviderUnavailable", `execute returned ${response.status}`);
    }
    let parsed: { outputs?: { mimeType?: string; data?: string; metadata?: { attributes?: Record<string, unknown> } }[] };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new SandboxError("InvalidOutput", "sandbox response is not JSON");
    }
    let stdout = "";
    let stderr = "";
    const files: SandboxFile[] = [];
    let total = 0;
    for (const chunk of parsed.outputs ?? []) {
      const data = Buffer.from(chunk.data ?? "", "base64");
      const fileName = decodeAttribute(chunk.metadata?.attributes?.file_name);
      if (fileName) {
        total += data.length;
        files.push({ name: fileName, content: data, mimeType: chunk.mimeType ?? "application/octet-stream" });
        continue;
      }
      if (chunk.mimeType === "application/json") {
        try {
          const message = JSON.parse(data.toString("utf8")) as { msg_out?: unknown; msg_err?: unknown };
          if (typeof message.msg_out === "string") stdout += message.msg_out;
          if (typeof message.msg_err === "string") stderr += message.msg_err;
        } catch {
          // non-message JSON chunk without a file name is ignored
        }
      }
    }
    if (total > MAX_FILE_IO_BYTES) throw new SandboxError("TemporaryStorageLimit", "output files exceed 100 MB");
    return { stdout, stderr, files };
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new SandboxError("ProviderUnavailable", "sandbox deletion timed out");
        controller.abort(error);
        reject(error);
      }, this.options.destroyTimeoutMs);
    });
    const remove = async () => {
      const response = await this.call("DELETE", handle.name, undefined, controller.signal);
      if (response.status === 404) return;
      if (!response.ok) throw new SandboxError("ProviderUnavailable", `delete returned ${response.status}`);
      let operation = (await response.json()) as { name?: string; done?: boolean; error?: unknown };
      while (!operation.done) {
        if (!operation.name) throw new SandboxError("ProviderUnavailable", "delete returned no operation");
        await new Promise((resolve) => setTimeout(resolve, this.options.pollIntervalMs));
        controller.signal.throwIfAborted();
        const poll = await this.call("GET", operation.name, undefined, controller.signal);
        if (!poll.ok) throw new SandboxError("ProviderUnavailable", `delete poll returned ${poll.status}`);
        operation = (await poll.json()) as typeof operation;
      }
      if (operation.error) throw new SandboxError("ProviderUnavailable", "sandbox deletion failed");
    };
    try {
      // Also bounds credential acquisition and response-body reads, not only fetch headers.
      await Promise.race([remove(), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readCapped(response: Response, maxChars: number): Promise<string | null> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.length > maxChars) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
  }
  return text + decoder.decode();
}

// ---- Per-attempt lifecycle -----------------------------------------------------------------------------------

export interface AttemptInput {
  runtime: SandboxRuntime;
  attemptId: string;
  code: string;
  files: SandboxFile[];
  deadlineMs?: number;
  signal?: AbortSignal;
  /** Called with the real provider handle (cleanup ledger) before any code is submitted. */
  onCreated?: (handle: SandboxHandle) => Promise<void>;
  /** Called immediately before code submission: the truthful "Running code…" moment (FR-004). */
  onRunning?: () => Promise<void>;
  /** Called after deletion was confirmed (`destroyed`) or failed (`destroyFailed`). */
  onDestroyed?: (result: { destroyed: boolean }) => Promise<void>;
}

interface AttemptBase {
  stdout: string;
  stderr: string;
  startedAt: string;
  endedAt: string;
  /** Whether code was handed to the provider (false → no actual attempt for the trace). */
  submitted: boolean;
  destroyed: boolean;
}

export type AttemptOutcome =
  | (AttemptBase & { kind: "completed"; exitCode: 0; results: HarnessResult[]; files: SandboxFile[] })
  | (AttemptBase & { kind: "failed"; failureCode: CodeExecutionFailureCode; exitCode: number | null; results: []; files: [] });

export function isRetryableOutcome(outcome: AttemptOutcome, ordinal: number): boolean {
  return outcome.kind === "failed" && outcome.failureCode === "PythonException" && ordinal === 1;
}

const clip = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 20)}\n…[output truncated]` : text);

function classify(raw: RawExecution): { kind: "completed"; results: HarnessResult[]; files: SandboxFile[] } | { kind: "failed"; failureCode: CodeExecutionFailureCode; exitCode: number | null } {
  const resultFile = raw.files.find((f) => f.name === RESULT_FILE);
  let result: { status?: unknown; results?: unknown } | null = null;
  if (resultFile) {
    try {
      result = JSON.parse(resultFile.content.toString("utf8"));
    } catch {
      result = null;
    }
  }
  if (!result) {
    if (looksLikeMemory(raw.stderr)) return { kind: "failed", failureCode: "MemoryLimitExceeded", exitCode: null };
    return { kind: "failed", failureCode: "InvalidOutput", exitCode: null };
  }
  if (result.status === "memory") return { kind: "failed", failureCode: "MemoryLimitExceeded", exitCode: 1 };
  if (result.status === "exception") return { kind: "failed", failureCode: "PythonException", exitCode: 1 };
  if (result.status !== "ok" || !Array.isArray(result.results)) return { kind: "failed", failureCode: "InvalidOutput", exitCode: null };
  const results: HarnessResult[] = [];
  for (const r of result.results as Record<string, unknown>[]) {
    if (typeof r?.label !== "string" || typeof r.value !== "string") return { kind: "failed", failureCode: "InvalidOutput", exitCode: null };
    results.push({
      label: r.label,
      value: r.value,
      unit: typeof r.unit === "string" ? r.unit : null,
      sources: Array.isArray(r.sources) ? r.sources.filter((s): s is string => typeof s === "string") : [],
    });
  }
  return { kind: "completed", results, files: raw.files.filter((f) => OUTPUT_FILE_RE.test(f.name)) };
}

/**
 * One isolated attempt: create → (onCreated) → (onRunning) → execute under the deadline → destroy (always).
 * Never throws for sandbox outcomes; callback errors (e.g. a lost lease) abort the attempt and propagate after
 * the sandbox has been deleted.
 */
export async function runAttempt(input: AttemptInput): Promise<AttemptOutcome> {
  const startedAt = new Date().toISOString();
  const base = (extra: Partial<AttemptBase>): AttemptBase => ({ stdout: "", stderr: "", startedAt, endedAt: new Date().toISOString(), submitted: false, destroyed: true, ...extra });
  const failed = (failureCode: CodeExecutionFailureCode, extra: Partial<AttemptBase> & { exitCode?: number | null } = {}): AttemptOutcome => {
    const { exitCode = null, ...rest } = extra;
    return { kind: "failed", failureCode, exitCode, results: [], files: [], ...base(rest) };
  };

  const inputBytes = input.files.reduce((n, f) => n + f.content.length, 0);
  if (inputBytes > MAX_FILE_IO_BYTES) return failed("TemporaryStorageLimit");
  if (input.signal?.aborted) return failed("GenerationCancelled");

  let handle: SandboxHandle;
  try {
    handle = await input.runtime.create(input.attemptId, input.signal);
  } catch (err) {
    return failed(err instanceof SandboxError ? err.failureCode : "ProviderUnavailable");
  }

  const controller = new AbortController();
  let reason: "deadline" | "cancelled" | null = null;
  const onCancel = () => {
    reason ??= "cancelled";
    controller.abort(new SandboxError("GenerationCancelled", "cancelled"));
  };
  input.signal?.addEventListener("abort", onCancel, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let submitted = false;
  let callbackError: unknown = null;
  let outcome: AttemptOutcome;
  try {
    await input.onCreated?.(handle);
    await input.onRunning?.();
    if (input.signal?.aborted) throw new SandboxError("GenerationCancelled", "cancelled");
    submitted = true;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reason ??= "deadline";
        controller.abort(new SandboxError("ExecutionTimeout", "deadline"));
        reject(new SandboxError("ExecutionTimeout", "deadline"));
      }, input.deadlineMs ?? EXECUTION_DEADLINE_MS);
    });
    const cancelled = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }));
    const raw = await Promise.race([input.runtime.execute(handle, { code: input.code, files: input.files }, controller.signal), deadline, cancelled]);
    // Late results after the deadline/cancellation never reach this point: the race already rejected.
    const classified = classify(raw);
    const io = { stdout: clip(raw.stdout), stderr: clip(raw.stderr), submitted };
    outcome =
      classified.kind === "completed"
        ? { kind: "completed", exitCode: 0, results: classified.results, files: classified.files, ...base(io) }
        : failed(classified.failureCode, { ...io, exitCode: classified.exitCode });
  } catch (err) {
    if (reason === "deadline") outcome = failed("ExecutionTimeout", { submitted });
    else if (reason === "cancelled" || input.signal?.aborted) outcome = failed("GenerationCancelled", { submitted });
    else if (err instanceof SandboxError) outcome = failed(err.failureCode, { submitted });
    else {
      callbackError = err;
      outcome = failed(submitted ? "ExecutionOutcomeUnknown" : "GenerationCancelled", { submitted });
    }
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onCancel);
  }
  let destroyed = true;
  try {
    await input.runtime.destroy(handle);
  } catch {
    destroyed = false;
  }
  outcome = { ...outcome, destroyed, endedAt: new Date().toISOString() };
  await input.onDestroyed?.({ destroyed });
  if (callbackError) throw callbackError;
  return outcome;
}
