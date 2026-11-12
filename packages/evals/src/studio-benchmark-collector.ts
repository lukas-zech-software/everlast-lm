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
  runs: { sample_id: string; stratum: "cold" | "warm" }[];
}

export function validateStudioBenchmarkPlan(value: unknown): StudioBenchmarkPlan {
  const p = value as StudioBenchmarkPlan;
  if (!p || typeof p !== "object" || !Number.isFinite(Date.parse(p.declared_at)) || Date.parse(p.declared_at) > Date.now()) throw new Error("Plan must be declared before collection");
  if (!/^[a-f0-9]{64}$/.test(p.fixture_sha256)) throw new Error("Declare the fixture SHA-256");
  for (const key of ["deployment_revision", "environment", "model"] as const) if (typeof p[key] !== "string" || !p[key].trim()) throw new Error(`Declare ${key}`);
  if (!["local_fixture", "enterprise_live"].includes(p.environment_kind) || p.region !== "europe-west4") throw new Error("Declare local_fixture or enterprise_live in europe-west4");
  const url = new URL(p.base_url);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("base_url must be an origin without credentials, path or query");
  if (url.protocol !== "https:" && !(p.environment_kind === "local_fixture" && url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) throw new Error("Use HTTPS; local fixture HTTP is loopback-only");
  const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
  if (!uuid.test(p.notebook_id) || !Array.isArray(p.active_source_ids) || p.active_source_ids.length === 0 || p.active_source_ids.some(id => !uuid.test(id)) || new Set(p.active_source_ids).size !== p.active_source_ids.length) throw new Error("Declare notebook and unique explicit source IDs");
  if (!Number.isFinite(p.poll_interval_ms) || p.poll_interval_ms <= 0 || !Number.isFinite(p.timeout_ms) || p.timeout_ms <= 0) throw new Error("Declare positive polling and timeout values");
  if (!Array.isArray(p.runs) || p.runs.length < 20 || new Set(p.runs.map(r => r.sample_id)).size !== p.runs.length || p.runs.some(r => !r.sample_id?.trim() || !["cold", "warm"].includes(r.stratum))) throw new Error("Declare at least 20 uniquely identified cold/warm runs");
  return p;
}

export async function collectStudioLatency(
  plan: StudioBenchmarkPlan,
  token: string,
  checkpoint: (samples: readonly MindmapLatencySample[]) => void,
  fetcher: typeof fetch = fetch
): Promise<MindmapLatencySample[]> {
  validateStudioBenchmarkPlan(plan);
  if (!token) throw new Error("STUDIO_BENCHMARK_TOKEN is required");
  const samples: MindmapLatencySample[] = [];
  const endpoint = `${new URL(plan.base_url).origin}/api/notebooks/${encodeURIComponent(plan.notebook_id)}/studio/artifacts`;
  for (const run of plan.runs) {
    const started = performance.now();
    const sample: MindmapLatencySample = { ...run, status: "Queued", submitted_at_ms: Date.now(), completed_at_ms: null, duration_ms: null, node_count: null };
    samples.push(sample);
    checkpoint(samples); // An interrupt leaves this declared attempt visible, never a replacement run.
    const call = async (url: string, body?: unknown) => {
      const remaining = plan.timeout_ms - (performance.now() - started);
      if (remaining <= 0) throw new Error("Timeout");
      const res = await fetcher(url, {
        method: body === undefined ? "GET" : "POST", redirect: "error",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(Math.max(1, Math.ceil(remaining))),
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      return await res.json() as { artifact?: { id: string; status: MindmapLatencySample["status"]; plugin_type?: string; payload_json?: unknown; failure?: { code: string } }; unavailable?: unknown };
    };
    try {
      const admitted = await call(endpoint, { plugin_type: "mindmap", subtype: "default", active_source_ids: plan.active_source_ids });
      if (!admitted.artifact?.id) throw new Error("InvalidAdmission");
      const artifactId = admitted.artifact.id;
      sample.artifact_id = artifactId;
      checkpoint(samples);
      for (;;) {
        const result = await call(`${endpoint}/${encodeURIComponent(artifactId)}`);
        const artifact = result.artifact;
        if (!artifact || artifact.id !== artifactId || result.unavailable) throw new Error("UnavailableArtifact");
        sample.status = artifact.status;
        if (["Completed", "Failed", "Cancelled"].includes(artifact.status)) {
          if (artifact.status === "Completed") {
            if (artifact.plugin_type !== "mindmap") throw new Error("WrongArtifactKind");
            const payload = StudioMindmapPayloadSchema.parse(artifact.payload_json);
            sample.duration_ms = performance.now() - started;
            sample.completed_at_ms = sample.submitted_at_ms + sample.duration_ms;
            sample.node_count = payload.node_count;
          } else sample.error_code = artifact.failure?.code ?? artifact.status;
          break;
        }
        if (!["Queued", "Running"].includes(artifact.status)) throw new Error("InvalidArtifactStatus");
        checkpoint(samples);
        await new Promise(resolve => setTimeout(resolve, Math.min(plan.poll_interval_ms, Math.max(1, plan.timeout_ms - (performance.now() - started)))));
      }
    } catch (error) {
      sample.status = "Failed";
      sample.completed_at_ms = null;
      sample.duration_ms = null;
      // Never persist provider bodies, tokens or arbitrary error messages.
      sample.error_code = error instanceof Error && /^(HTTP_\d+|Timeout|InvalidAdmission|UnavailableArtifact|WrongArtifactKind|InvalidArtifactStatus)$/.test(error.message) ? error.message : "CollectionError";
    }
    checkpoint(samples);
  }
  return samples;
}
