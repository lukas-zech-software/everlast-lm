import { StudioMindmapPayloadSchema } from "@everlast/contracts";
import type { MindmapLatencySample } from "./studio-structure-performance.ts";

/** [011-studio-mindmaps-data-tables] T060 — ordinary C-03 API measurement, FR-ST-08/09, SC-002/003. */
export interface StudioBenchmarkPlan {
  declared_at: string;
  fixture_sha256: string;
  deployment_revision: string;
  environment: string;
  environment_kind: "local_fixture" | "enterprise_live";
  region: "europe-west4";
  model: string;
  base_url: string;
  notebook_id: string;
  active_source_ids: string[];
  poll_interval_ms: number;
  timeout_ms: number;
  runs: Array<{ sample_id: string; stratum: "cold" | "warm" }>;
}

const UUID_PATTERN = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const TERMINAL_STUDIO_STATUSES = new Set(["Completed", "Failed", "Cancelled"]);
const IN_FLIGHT_STUDIO_STATUSES = new Set(["Queued", "Running"]);
const ALLOWED_ERROR_CODE =
  /^(HTTP_\d+|Timeout|InvalidAdmission|UnavailableArtifact|WrongArtifactKind|InvalidArtifactStatus)$/;

interface StudioApiResponse {
  artifact?: {
    id: string;
    status: MindmapLatencySample["status"];
    plugin_type?: string;
    payload_json?: unknown;
    failure?: { code: string };
  };
  unavailable?: unknown;
}

function validateBenchmarkOrigin(baseUrl: unknown, environmentKind: unknown): void {
  const url = new URL(typeof baseUrl === "string" ? baseUrl : "");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("base_url must be an origin without credentials, path or query");
  }
  const isLoopbackHttp =
    environmentKind === "local_fixture" &&
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLoopbackHttp) {
    throw new Error("Use HTTPS; local fixture HTTP is loopback-only");
  }
}

function validateBenchmarkScopeAndTimings(raw: Record<string, unknown>): void {
  const notebookId = raw.notebook_id;
  const activeSourceIds = raw.active_source_ids;
  if (
    typeof notebookId !== "string" ||
    !UUID_PATTERN.test(notebookId) ||
    !Array.isArray(activeSourceIds) ||
    activeSourceIds.length === 0 ||
    activeSourceIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id)) ||
    new Set(activeSourceIds).size !== activeSourceIds.length
  ) {
    throw new Error("Declare notebook and unique explicit source IDs");
  }
  const pollInterval = raw.poll_interval_ms;
  const timeoutMs = raw.timeout_ms;
  if (
    typeof pollInterval !== "number" ||
    !Number.isFinite(pollInterval) ||
    pollInterval <= 0 ||
    typeof timeoutMs !== "number" ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    throw new Error("Declare positive polling and timeout values");
  }
}

function validateBenchmarkRuns(runs: unknown): void {
  if (!Array.isArray(runs) || runs.length < 20) {
    throw new Error("Declare at least 20 uniquely identified cold/warm runs");
  }
  const seenIds = new Set<string>();
  for (const run of runs) {
    const entry =
      typeof run === "object" && run !== null ? (run as Record<string, unknown>) : undefined;
    const sampleId = entry?.sample_id;
    const stratum = entry?.stratum;
    if (
      typeof sampleId !== "string" ||
      !sampleId.trim() ||
      seenIds.has(sampleId) ||
      (stratum !== "cold" && stratum !== "warm")
    ) {
      throw new Error("Declare at least 20 uniquely identified cold/warm runs");
    }
    seenIds.add(sampleId);
  }
}

export function validateStudioBenchmarkPlan(value: unknown): StudioBenchmarkPlan {
  if (typeof value !== "object" || value === null) {
    throw new Error("Plan must be declared before collection");
  }
  const raw = value as Record<string, unknown>;
  const declaredAt = typeof raw.declared_at === "string" ? Date.parse(raw.declared_at) : NaN;
  if (!Number.isFinite(declaredAt) || declaredAt > Date.now()) {
    throw new Error("Plan must be declared before collection");
  }
  if (typeof raw.fixture_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.fixture_sha256)) {
    throw new Error("Declare the fixture SHA-256");
  }
  for (const key of ["deployment_revision", "environment", "model"] as const) {
    const field = raw[key];
    if (typeof field !== "string" || !field.trim()) {
      throw new Error(`Declare ${key}`);
    }
  }
  if (
    (raw.environment_kind !== "local_fixture" && raw.environment_kind !== "enterprise_live") ||
    raw.region !== "europe-west4"
  ) {
    throw new Error("Declare local_fixture or enterprise_live in europe-west4");
  }
  validateBenchmarkOrigin(raw.base_url, raw.environment_kind);
  validateBenchmarkScopeAndTimings(raw);
  validateBenchmarkRuns(raw.runs);
  return value as StudioBenchmarkPlan;
}

async function callStudioApi(options: {
  url: string;
  token: string;
  started: number;
  timeoutMs: number;
  fetcher: typeof fetch;
  body?: unknown;
}): Promise<StudioApiResponse> {
  const remaining = options.timeoutMs - (performance.now() - options.started);
  if (remaining <= 0) {
    throw new Error("Timeout");
  }
  const res = await options.fetcher(options.url, {
    method: options.body === undefined ? "GET" : "POST",
    redirect: "error",
    headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json" },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(Math.max(1, Math.ceil(remaining))),
  });
  if (!res.ok) {
    throw new Error(`HTTP_${res.status}`);
  }
  return (await res.json()) as StudioApiResponse;
}

function applyTerminalArtifactStatus(
  sample: MindmapLatencySample,
  artifact: NonNullable<StudioApiResponse["artifact"]>,
  started: number,
): void {
  if (artifact.status !== "Completed") {
    sample.error_code = artifact.failure?.code ?? artifact.status;
    return;
  }
  if (artifact.plugin_type !== "mindmap") {
    throw new Error("WrongArtifactKind");
  }
  const payload = StudioMindmapPayloadSchema.parse(artifact.payload_json);
  sample.duration_ms = performance.now() - started;
  sample.completed_at_ms = sample.submitted_at_ms + sample.duration_ms;
  sample.node_count = payload.node_count;
}

async function pollStudioArtifactUntilTerminal(options: {
  plan: StudioBenchmarkPlan;
  endpoint: string;
  artifactId: string;
  token: string;
  started: number;
  sample: MindmapLatencySample;
  samples: readonly MindmapLatencySample[];
  checkpoint: (samples: readonly MindmapLatencySample[]) => void;
  fetcher: typeof fetch;
}): Promise<void> {
  const { plan, endpoint, artifactId, token, started, sample, samples, checkpoint, fetcher } =
    options;
  const pollUrl = `${endpoint}/${encodeURIComponent(artifactId)}`;
  for (;;) {
    const result = await callStudioApi({
      url: pollUrl,
      token,
      started,
      timeoutMs: plan.timeout_ms,
      fetcher,
    });
    const artifact = result.artifact;
    if (artifact?.id !== artifactId || result.unavailable) {
      throw new Error("UnavailableArtifact");
    }
    sample.status = artifact.status;
    if (TERMINAL_STUDIO_STATUSES.has(artifact.status)) {
      applyTerminalArtifactStatus(sample, artifact, started);
      return;
    }
    if (!IN_FLIGHT_STUDIO_STATUSES.has(artifact.status)) {
      throw new Error("InvalidArtifactStatus");
    }
    checkpoint(samples);
    const delayMs = Math.min(
      plan.poll_interval_ms,
      Math.max(1, plan.timeout_ms - (performance.now() - started)),
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export async function collectStudioLatency(
  plan: StudioBenchmarkPlan,
  token: string,
  checkpoint: (samples: readonly MindmapLatencySample[]) => void,
  fetcher: typeof fetch = fetch,
): Promise<MindmapLatencySample[]> {
  validateStudioBenchmarkPlan(plan);
  if (!token) {
    throw new Error("STUDIO_BENCHMARK_TOKEN is required");
  }
  const samples: MindmapLatencySample[] = [];
  const endpoint = `${new URL(plan.base_url).origin}/api/notebooks/${encodeURIComponent(plan.notebook_id)}/studio/artifacts`;
  for (const run of plan.runs) {
    const started = performance.now();
    const sample: MindmapLatencySample = {
      ...run,
      status: "Queued",
      submitted_at_ms: Date.now(),
      completed_at_ms: null,
      duration_ms: null,
      node_count: null,
    };
    samples.push(sample);
    checkpoint(samples); // An interrupt leaves this declared attempt visible, never a replacement run.
    try {
      const admitted = await callStudioApi({
        url: endpoint,
        token,
        started,
        timeoutMs: plan.timeout_ms,
        fetcher,
        body: {
          plugin_type: "mindmap",
          subtype: "default",
          active_source_ids: plan.active_source_ids,
        },
      });
      if (!admitted.artifact?.id) {
        throw new Error("InvalidAdmission");
      }
      const artifactId = admitted.artifact.id;
      sample.artifact_id = artifactId;
      checkpoint(samples);
      await pollStudioArtifactUntilTerminal({
        plan,
        endpoint,
        artifactId,
        token,
        started,
        sample,
        samples,
        checkpoint,
        fetcher,
      });
    } catch (error) {
      sample.status = "Failed";
      sample.completed_at_ms = null;
      sample.duration_ms = null;
      // Never persist provider bodies, tokens or arbitrary error messages.
      sample.error_code =
        error instanceof Error && ALLOWED_ERROR_CODE.test(error.message)
          ? error.message
          : "CollectionError";
    }
    checkpoint(samples);
  }
  return samples;
}
