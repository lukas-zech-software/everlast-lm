import http from "node:http";
import { fileURLToPath } from "node:url";
import { GoogleAuth } from "google-auth-library";
import { createPool, runMigrations } from "@everlast/db";
import { createApp, type AppDeps } from "./app.ts";
import { loadApiConfig, loadCodeExecutionConfig, loadBenchmarkConfig } from "./config.ts";
import { PrivateBenchmarkRecorder } from "./observability/benchmark.ts";
import { AgentPlatformSandboxRuntime, type SandboxRuntime } from "./chat/execution/runtime.ts";
import { startCodeExecutionReconciler } from "./chat/execution/reconcile.ts";
import { createIdentityPlatformVerifier, LocalIdentityIssuer } from "./auth/identity.ts";
import { createObjectStorage, createVertexClient, HashingTestEmbedder, VertexEmbedder, vertexConfigFromEnv } from "@everlast/cloud";
import { ChatService } from "./chat/service.ts";
import { createGroundedModelFromEnv } from "./chat/model.ts";
import { createV2Runtime } from "./v2/runtime.ts";
import { GoogleDelegationBroker } from "./routes/connections.ts";
import { VertexTopicEmojiSelector } from "@everlast/worker/ingestion/topic-emoji";
import { createVertexStructuredGenerationFromEnv } from "@everlast/worker/package-v2-2-gemini";
import { createVertexReportModelFromEnv, type VertexReportModel } from "@everlast/worker/studio/reports/vertex-model";
import type { StructuredGenerationClient } from "@everlast/worker/package-v2-2";

/**
 * API entrypoint (FR-WM-01, NFR-SEC-01). Runs directly on Node 24 (type stripping, no build step).
 */

/**
 * Worker wake-up for the durable job outbox (FR-WM-01, FR-SI-01). On Cloud Run the API enqueues a Cloud Tasks
 * HTTP task with an OIDC token for the worker (architecture: Cloud Tasks → internal worker); locally it calls
 * the worker directly. Notifications are coalesced; losing one is safe because the outbox is durable and the
 * worker drains it on start-up and on every later wake-up.
 */
export function createJobNotifier(env: NodeJS.ProcessEnv = process.env): () => void {
  const workerUrl = env.WORKER_URL ?? env.WORKER_INTERNAL_URL;
  if (!workerUrl) return () => undefined;
  const queue = env.CLOUD_TASKS_INGESTION_QUEUE;
  const invoker = env.CLOUD_TASKS_INVOKER_SA_EMAIL;
  const project = env.GCP_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT;
  const location = env.CLOUD_TASKS_LOCATION ?? env.GCP_REGION ?? "europe-west4";
  const target = new URL("/tasks/drain", workerUrl).toString();
  const auth = env.K_SERVICE ? new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }) : null;

  const send = async () => {
    if (auth && queue && invoker && project) {
      const client = await auth.getClient();
      await client.request({
        url: `https://cloudtasks.googleapis.com/v2/projects/${project}/locations/${location}/queues/${queue}/tasks`,
        method: "POST",
        data: { task: { httpRequest: { httpMethod: "POST", url: target, oidcToken: { serviceAccountEmail: invoker, audience: workerUrl } } } },
      });
    } else if (auth) {
      const client = await auth.getIdTokenClient(workerUrl);
      await client.request({ url: target, method: "POST" });
    } else {
      await fetch(target, { method: "POST", headers: { "x-everlast-dev-worker": "1" } });
    }
  };

  let scheduled: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (scheduled) return;
    scheduled = setTimeout(() => {
      scheduled = null;
      send().catch((err) => console.warn(JSON.stringify({ severity: "WARNING", message: `worker notify failed: ${(err as Error).message}` })));
    }, 50);
  };
}

/**
 * Structured model for Source Guides, overviews and follow-ups (FR-SI-02, FR-GC-04/05): Vertex AI Flash-Lite in
 * the configured EU region with keyless ADC (D3, NFR-SEC-01), under the same condition as the grounded chat model.
 */
export function createV2Generation(env: NodeJS.ProcessEnv, modelConfigured: boolean): StructuredGenerationClient | undefined {
  return modelConfigured ? createVertexStructuredGenerationFromEnv(env) : undefined;
}

/**
 * Studio report model (FR-ST-10/11): Vertex AI Flash in the configured EU region with keyless ADC (model routing,
 * D3, NFR-SEC-01), under the same condition as the grounded chat model; otherwise the deterministic extractor.
 */
export function createV2ReportModel(env: NodeJS.ProcessEnv, modelConfigured: boolean): VertexReportModel | undefined {
  return modelConfigured ? createVertexReportModelFromEnv(env) : undefined;
}

/**
 * FR-GC-08 managed sandbox (specs/010, D18/D19/D20): only with CODE_EXECUTION_ENABLED=true and an owner-created
 * parent runtime in europe-west4. The API's own keyless identity (ADC) calls the provider; nothing is injected
 * into the sandbox. Absent → computations answer 503 and nothing is pretended.
 */
export function createSandboxRuntime(env: NodeJS.ProcessEnv): SandboxRuntime | undefined {
  const config = loadCodeExecutionConfig(env);
  if (!config) return undefined;
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  return new AgentPlatformSandboxRuntime({
    reasoningEngine: config.reasoningEngine,
    location: config.location,
    accessToken: async () => {
      const token = (await (await auth.getClient()).getAccessToken()).token;
      if (!token) throw new Error("No access token for the API service identity");
      return token;
    },
  });
}

export async function startApiServer(env: NodeJS.ProcessEnv = process.env, extra: Partial<AppDeps> = {}) {
  const config = loadApiConfig(env);
  const pool = createPool();
  if (env.MIGRATE_ON_START === "true") await runMigrations(pool);
  const localIssuer = config.authMode === "local" ? new LocalIdentityIssuer(env) : undefined;
  const verifier =
    localIssuer?.verifier ??
    createIdentityPlatformVerifier({
      projectId: config.projectId,
      tenantId: config.identityPlatform?.tenantId,
      checkRevocation: config.checkRevocation,
    });
  const vertexConfigured = Boolean(env.VERTEX_PROJECT ?? env.GCP_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT);
  const embedder =
    extra.embedder ??
    (env.EVERLAST_DEV_TEST_EMBEDDER === "1"
      ? new HashingTestEmbedder(env)
      : vertexConfigured
        ? new VertexEmbedder({ client: createVertexClient(vertexConfigFromEnv(env)), model: env.EMBEDDING_MODEL })
        : undefined);
  const modelConfigured = Boolean(embedder && vertexConfigured && env.EVERLAST_DEV_TEST_EMBEDDER !== "1");
  const model = modelConfigured ? createGroundedModelFromEnv(env) : undefined;
  const storage = extra.storage ?? createObjectStorage(env);
  const notifyJobs = extra.notifyJobs ?? createJobNotifier(env);
  // Release v2 features (D16): stores in PostgreSQL since specs/013; set V2_POC=off to serve v1 only.
  const v2 =
    extra.v2 ??
    (env.V2_POC === "off"
      ? undefined
      : createV2Runtime({
          pool,
          sourceLimit: config.sourceLimit,
          model,
          generation: createV2Generation(env, modelConfigured),
          reportModel: createV2ReportModel(env, modelConfigured),
          // FR-SI-02 / Gate v2.0 #1: Source Guides start from the Ready transition, not from a source listing.
          readyWatch: { intervalMs: Number(env.V2_READY_WATCH_MS ?? 1_000) },
          // FR-NM-03 (owner decision 2026-10-20): note-sources run the v1 ingestion with this storage and embedder.
          storage,
          embedder,
          notifyJobs,
          ...(modelConfigured ? { topicEmoji: new VertexTopicEmojiSelector() } : {}),
        }));
  const sandboxRuntime = createSandboxRuntime(env);
  const codeExecution = sandboxRuntime ? { runtime: sandboxRuntime, storage } : undefined;
  if (codeExecution) startCodeExecutionReconciler({ pool, ...codeExecution });
  const benchmarkConfig = loadBenchmarkConfig(env);
  const benchmark = extra.benchmark ?? (benchmarkConfig
    ? new PrivateBenchmarkRecorder({
        approved_notebook_ids: benchmarkConfig.approvedNotebookIds,
        revision: benchmarkConfig.revision,
        sink: () => {},
      })
    : undefined);
  if (benchmark) {
    benchmark.qualify({
      ready_at_ms: Date.now(),
      dependencies: {
        sql: true,
        model: Boolean(model),
        retrieval: Boolean(embedder),
        cache: true,
        migrations: true,
        recovery: true,
      },
    });
  }
  const chat =
    extra.chat ??
    (embedder && model
      ? new ChatService({
          pool,
          embedder,
          model,
          benchmark,
          codeExecution,
          ...(v2 ? { resolvePreferences: (ownerId: string, notebookId: string, locale?: string) => v2.chatPreferences(ownerId, notebookId, locale) } : {}),
        })
      : undefined);
  // Delegated Drive access (D11, specs/009): only with an owner-registered OAuth client; the secret is mounted.
  const delegationBroker =
    env.GOOGLE_OAUTH_CLIENT_ID && env.DELEGATED_OAUTH_CLIENT_SECRET && env.PUBLIC_BASE_URL && (env.GCP_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT)
      ? new GoogleDelegationBroker({
          clientId: env.GOOGLE_OAUTH_CLIENT_ID,
          clientSecret: async () => env.DELEGATED_OAUTH_CLIENT_SECRET!,
          redirectUri: new URL("/oauth/google/callback", env.PUBLIC_BASE_URL).toString(),
          projectId: (env.GCP_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT)!,
        })
      : undefined;
  const pickerConfig =
    env.GOOGLE_PICKER_API_KEY && env.GOOGLE_PICKER_APP_ID && env.GOOGLE_OAUTH_CLIENT_ID
      ? { developerKey: env.GOOGLE_PICKER_API_KEY, appId: env.GOOGLE_PICKER_APP_ID, clientId: env.GOOGLE_OAUTH_CLIENT_ID }
      : undefined;
  const deps: AppDeps = {
    pool,
    config,
    delegationBroker,
    pickerConfig,
    verifier,
    localIssuer,
    storage,
    embedder,
    chat,
    benchmark,
    v2,
    notifyJobs,
    ...extra,
  };
  const server = http.createServer(createApp(deps));
  await new Promise<void>((resolve) => server.listen(config.port, resolve));
  console.log(JSON.stringify({ severity: "INFO", message: `API listening on :${config.port} (auth=${config.authMode})` }));
  return { server, pool, deps };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startApiServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
