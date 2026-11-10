import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { CodeExecutionPrivateEvidenceFileSchema, CodeExecutionTraceSchema, type CodeExecutionPrivateEvidenceFile } from "@everlast/contracts";
import type { CollectionManifest, CollectionSubmission, ExecutionReceipt } from "./code-execution-collector.ts";

/** [010-code-execution-sandbox] T063 — FR-GC-08, NFR-SEC-02: ordinary API only. */
export function createCodeExecutionHttpTransport(options: {
  baseUrl: string; credentials: ReadonlyMap<string, string>; fetch?: typeof fetch;
  timeoutMs?: number; maxBytes?: number; clock?: () => number;
}) {
  const url = new URL(options.baseUrl);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("Benchmark requires HTTPS or local HTTP without URL credentials");
  const timeoutMs = options.timeoutMs ?? 90_000, maxBytes = options.maxBytes ?? 2_000_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2_000_000) throw new Error("Invalid transport bounds");
  const clock = options.clock ?? (() => performance.now());
  return async (input: CollectionSubmission, outer: AbortSignal): Promise<ExecutionReceipt> => {
    const token = options.credentials.get(input.actor.notebook_id);
    if (!token || /[\r\n]/.test(token)) throw new Error("Missing private actor credential");
    const signal = AbortSignal.any([outer, AbortSignal.timeout(timeoutMs)]), submitted = clock();
    const empty = (terminal: ExecutionReceipt["terminal"]): ExecutionReceipt => ({ terminal, client_running_ms: null, client_final_ms: null, running_execution_id: null, trace: null, cited_chunk_ids: [] });
    const response = await (options.fetch ?? fetch)(new URL("/api/notebooks/" + encodeURIComponent(input.actor.notebook_id) + "/chat/turns", url), {
      method: "POST", redirect: "error", signal,
      headers: { authorization: "Bearer " + token, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ message: input.question, active_source_ids: input.actor.source_snapshot.map(s => s.source_id), request_id: input.request_id }),
    });
    if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) { await response.body?.cancel(); return empty("error"); }
    const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0, buffer = "", running: number | null = null, execution: string | null = null;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) throw new Error("SSE response exceeds declared byte bound");
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const lines = buffer.slice(0, boundary).split("\n"); buffer = buffer.slice(boundary + 2);
          const event = lines.find(line => line.startsWith("event:"))?.slice(6).trim();
          if (!["status", "final", "error"].includes(event ?? "")) continue;
          const payload: unknown = JSON.parse(lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n"));
          if (!payload || typeof payload !== "object") throw new Error("Malformed SSE event");
          const p = payload as Record<string, unknown>, elapsed = clock() - submitted;
          if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error("Invalid monotonic receipt clock");
          if (event === "status") {
            if (p.phase === "running_code") {
              if (typeof p.execution_id !== "string" || (p.attempt !== 1 && p.attempt !== 2) || (execution !== null && execution !== p.execution_id) || (running === null && p.attempt !== 1)) throw new Error("Invalid execution status identity");
              if (running === null) { running = elapsed; execution = p.execution_id; }
            }
            continue;
          }
          if (event === "error") return { ...empty("error"), client_running_ms: running, client_final_ms: elapsed, running_execution_id: execution };
          if (p.replayed === true) return empty("replayed");
          if (p.replayed !== false || !Array.isArray(p.messages)) throw new Error("Malformed final response");
          const messages = p.messages.filter((m: unknown) => m && typeof m === "object" && (m as Record<string, unknown>).role === "assistant");
          if (messages.length !== 1) return empty("missing");
          const message = messages[0] as Record<string, unknown>;
          if (message.unavailable_reason || !Array.isArray(message.citations)) return empty("missing");
          const trace = CodeExecutionTraceSchema.safeParse(message.code_execution_trace);
          if (!trace.success) return empty("missing");
          const scope = new Set(input.actor.source_snapshot.map(s => s.source_id));
          const cites = message.citations as { chunk_id?: unknown; source_id?: unknown; status?: unknown }[];
          if (cites.some(c => typeof c.chunk_id !== "string" || typeof c.source_id !== "string" || !scope.has(c.source_id) || c.status !== "available")) return empty("missing");
          return { terminal: "final", client_running_ms: running, client_final_ms: elapsed, running_execution_id: execution, trace: trace.data, cited_chunk_ids: [...new Set(cites.map(c => c.chunk_id as string))] };
        }
      }
      decoder.decode(); return empty("missing");
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  };
}

/** Private producer file: bounded, owner-private regular file; never read via a public API. */
export function createCodeExecutionPrivateFileReader(path: string, manifest: CollectionManifest, fixtureSha256: string, options: { timeoutMs?: number; maxBytes?: number } = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000, maxBytes = options.maxBytes ?? 8_000_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8_000_000) throw new Error("Invalid private evidence bounds");
  async function read(): Promise<CodeExecutionPrivateEvidenceFile> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > maxBytes) throw new Error("Private evidence requires a bounded owner-private regular file");
      const buffer = Buffer.alloc(Math.min(maxBytes + 1, stat.size + 1));
      let offset = 0;
      while (offset < buffer.length) { const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, null); if (!bytesRead) break; offset += bytesRead; }
      if (offset > maxBytes) throw new Error("Private evidence exceeds byte bound");
      const parsed = CodeExecutionPrivateEvidenceFileSchema.parse(JSON.parse(buffer.subarray(0, offset).toString("utf8")));
      if (parsed.serving_revision !== manifest.serving_revision || parsed.candidate_commit !== manifest.candidate_commit || parsed.fixture_sha256 !== fixtureSha256 || parsed.classification_basis !== manifest.classification_basis || parsed.qualification_sha256 !== manifest.qualification_sha256 || parsed.runtime_config_sha256 !== manifest.runtime_config_sha256 || parsed.clock_calibration_sha256 !== manifest.clock_calibration_sha256 || manifest.actors.some(a => !parsed.approved_notebook_ids.includes(a.notebook_id))) throw new Error("Private producer provenance does not match the frozen manifest");
      const ids = parsed.measurements.map(m => m.request_id);
      if (new Set(ids).size !== ids.length) throw new Error("Duplicate private request evidence");
      return parsed;
    } finally { await file.close(); }
  }
  return {
    preflight: read,
    async measurement(request: string, signal: AbortSignal): Promise<unknown> {
      const end = performance.now() + timeoutMs;
      while (!signal.aborted && performance.now() <= end) {
        const file = await read(), record = file.measurements.find(m => m.request_id === request);
        if (record) return record;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 25);
          const abort = () => { clearTimeout(timer); reject(new Error("Private evidence cancelled")); };
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
      }
      throw new Error("Private request evidence unavailable");
    },
  };
}
