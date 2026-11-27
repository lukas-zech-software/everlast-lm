import {
  GcsPrivateBridgeObjects,
  type PrivateBridgeObjects,
} from "@everlast/cloud/private-benchmark";
import { readdirSync, readFileSync, lstatSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { createOperationalProbePorts } from "./services/source-context.ts";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { GoogleAuth } from "google-auth-library";
import { createPool, runMigrations, getAvailableMigrations, type Pool } from "@everlast/db";
import { createApp, type AppDeps } from "./app.ts";
import {
  loadApiConfig,
  loadCodeExecutionConfig,
  loadBenchmarkConfig,
  loadGuideAdmissionConfig,
} from "./config.ts";
import {
  PrivateBenchmarkRecorder,
  createPrivateBenchmarkSink,
  createOperationalCacheFromEnv,
  type OperationalCachePort,
  preparePrivateBridgeEnvironment,
} from "./observability/benchmark.ts";
import { AgentPlatformSandboxRuntime, type SandboxRuntime } from "./chat/execution/runtime.ts";
import { startCodeExecutionReconciler } from "./chat/execution/reconcile.ts";
import { createIdentityPlatformVerifier, LocalIdentityIssuer } from "./auth/identity.ts";
import {
  createEnterpriseStructuredGenerator,
  createVertexStructuredGenerationFromEnv,
  createObjectStorage,
  createVertexClient,
  HashingTestEmbedder,
  VertexEmbedder,
  vertexConfigFromEnv,
  type ObjectStorage,
} from "@everlast/cloud";
import { ChatService } from "./chat/service.ts";
import { createGroundedModelFromEnv, type GroundedModel } from "./chat/model.ts";
import { createV2Runtime } from "./v2/runtime.ts";
import { GoogleDelegationBroker } from "./routes/connections.ts";
import { VertexTopicEmojiClient, VertexTopicEmojiSelector } from "@everlast/cloud/topic-emoji";
// Preserve exact D21 legacy exception fingerprint (specs/004 T035)
// prettier-ignore
import { createVertexReportModelFromEnv, type VertexReportModel } from "@everlast/worker/studio/reports/vertex-model";
import type { StructuredGenerationClient } from "./source-guides/package-v2-2.ts";

/**
 * API entrypoint (FR-WM-01, NFR-SEC-01). Runs directly on Node 26 (type stripping, no build step).
 */

/**
 * Worker wake-up for the durable job outbox (FR-WM-01, FR-SI-01). On Cloud Run the API enqueues a Cloud Tasks
 * HTTP task with an OIDC token for the worker (architecture: Cloud Tasks → internal worker); locally it calls
 * the worker directly. Notifications are coalesced; losing one is safe because the outbox is durable and the
 * worker drains it on start-up and on every later wake-up.
 */
export function createJobNotifier(env: NodeJS.ProcessEnv = process.env): () => void {
  const workerUrl = env.WORKER_URL ?? env.WORKER_INTERNAL_URL;
  if (!workerUrl) {
    // Grill F22: on Cloud Run a missing worker URL would silently stop all ingestion.
    if (env.K_SERVICE)
      throw new Error("WORKER_URL or WORKER_INTERNAL_URL must be set on Cloud Run (F22)");
    return () => undefined;
  }
  const queue = env.CLOUD_TASKS_INGESTION_QUEUE;
  const invoker = env.CLOUD_TASKS_INVOKER_SA_EMAIL;
  const project = env.GCP_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT;
  const location = env.CLOUD_TASKS_LOCATION ?? env.GCP_REGION ?? "europe-west4";
  const target = new URL("/tasks/drain", workerUrl).toString();
  const auth = env.K_SERVICE
    ? new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] })
    : null;

  const send = async () => {
    if (auth && queue && invoker && project) {
      const client = await auth.getClient();
      await client.request({
        url: `https://cloudtasks.googleapis.com/v2/projects/${project}/locations/${location}/queues/${queue}/tasks`,
        method: "POST",
        data: {
          task: {
            httpRequest: {
              httpMethod: "POST",
              url: target,
              oidcToken: { serviceAccountEmail: invoker, audience: workerUrl },
            },
          },
        },
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
      send().catch((err: unknown) =>
        console.warn(
          JSON.stringify({
            severity: "WARNING",
            message: `worker notify failed: ${err instanceof Error ? err.message : String(err)}`,
          }),
        ),
      );
    }, 50);
  };
}

/**
 * Structured model for Source Guides, overviews and follow-ups (FR-SI-02, FR-GC-04/05): Vertex AI Flash-Lite in
 * the configured EU region with keyless ADC (D3, NFR-SEC-01), under the same condition as the grounded chat model.
 */
export function createV2Generation(
  env: NodeJS.ProcessEnv,
  modelConfigured: boolean,
): StructuredGenerationClient | undefined {
  return modelConfigured ? createVertexStructuredGenerationFromEnv(env) : undefined;
}

/**
 * Studio report model (FR-ST-10/11): Vertex AI Flash in the configured EU region with keyless ADC (model routing,
 * D3, NFR-SEC-01), under the same condition as the grounded chat model; otherwise the deterministic extractor.
 */
export function createV2ReportModel(
  env: NodeJS.ProcessEnv,
  modelConfigured: boolean,
): VertexReportModel | undefined {
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

/** NFR-PERF-01: binds signed approval to actual runtime source bytes; no Git/environment value is treated as code proof. */
export function measureOperationalSourceTree(root: string): string {
  const hash = createHash("sha256");
  let total = 0;
  const visit = (relative: string) => {
    const path = join(root, relative),
      stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error("Operational source symlinks are not qualified");
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(`${relative}/${name}`);
      return;
    }
    if (!stat.isFile() || stat.size > 10000000 || (total += stat.size) > 100000000)
      throw new Error("Operational source manifest bounds exceeded");
    hash.update(`${relative}\0`);
    hash.update(readFileSync(path));
    hash.update("\0");
  };
  for (const relative of [
    "apps/api/src",
    "apps/worker/src",
    "packages/contracts/src",
    "packages/db/src",
    "packages/cloud/src",
    "package.json",
    "pnpm-lock.yaml",
  ])
    visit(relative);
  return hash.digest("hex");
}
export interface StartedApiServer {
  server: http.Server;
  pool: Pool;
  deps: AppDeps;
}

function createServerEmbedder(
  env: NodeJS.ProcessEnv,
  vertexConfigured: boolean,
): AppDeps["embedder"] {
  if (env.EVERLAST_DEV_TEST_EMBEDDER === "1") {
    return new HashingTestEmbedder(env);
  }
  if (!vertexConfigured) {
    return undefined;
  }
  return new VertexEmbedder({
    client: createVertexClient(vertexConfigFromEnv(env)),
    model: env.EMBEDDING_MODEL,
  });
}

function createDelegationBrokerFromEnv(env: NodeJS.ProcessEnv): GoogleDelegationBroker | undefined {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.DELEGATED_OAUTH_CLIENT_SECRET;
  const publicBaseUrl = env.PUBLIC_BASE_URL;
  const projectId = env.GCP_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT;
  if (!clientId || !clientSecret || !publicBaseUrl || !projectId) {
    return undefined;
  }
  return new GoogleDelegationBroker({
    clientId,
    clientSecret: () => Promise.resolve(clientSecret),
    redirectUri: new URL("/oauth/google/callback", publicBaseUrl).toString(),
    projectId,
  });
}

function buildExecutionRuntimeConfig(
  env: NodeJS.ProcessEnv,
  sandboxRuntime: SandboxRuntime | undefined,
  hasClockBootstrap: boolean,
) {
  const codeExecutionConfig = loadCodeExecutionConfig(env);
  if (
    !sandboxRuntime ||
    !codeExecutionConfig ||
    (!env.BENCHMARK_EXECUTION_CONFIG_FILE && !hasClockBootstrap)
  ) {
    return undefined;
  }
  return {
    reasoning_engine: codeExecutionConfig.reasoningEngine,
    region: "europe-west4" as const,
    vcpu: 2 as const,
    memory_gb: 1.5 as const,
    network: "none" as const,
    file_io_mb: 100 as const,
    deadline_ms: 15000 as const,
  };
}

function assertOperationalDirectorySafe(
  operationalDirectory: string | undefined,
  env: NodeJS.ProcessEnv,
): void {
  if (!operationalDirectory) return;
  const directory = realpathSync(operationalDirectory);
  const publicRoot = realpathSync(resolve(env.WEB_DIST_DIR ?? "apps/web/dist"));
  if (directory === publicRoot || directory.startsWith(`${publicRoot}/`)) {
    throw new Error("Operational private directory cannot be publicly served");
  }
}

async function qualifyBenchmarkDependencies(
  benchmark: PrivateBenchmarkRecorder,
  pool: Pool,
  v2: AppDeps["v2"],
): Promise<void> {
  // NFR-PERF-01 / D17: constructing clients is not dependency qualification.
  // Defaults remain unqualified until trusted operator/in-process probes supply actual evidence.
  await benchmark.qualifyDependencies({
    sql: async () => {
      await pool.query("SELECT 1");
      return true;
    },
    migrations: async () => {
      const rows = await pool.query<{ version: string }>("SELECT version FROM schema_migrations");
      const applied = new Set(rows.rows.map((row) => row.version));
      return getAvailableMigrations().every((file) => {
        const name = file.split("/").pop();
        return name !== undefined && applied.has(name);
      });
    },
    recovery: async () => (v2 ? await v2.recoveryReady() : false),
    // Model, retrieval and provider cache need explicit approved qualification; no paid startup probe.
  });
}

function startOperationalCoordinatorForServer(params: {
  env: NodeJS.ProcessEnv;
  operationalDirectory: string | undefined;
  benchmark: PrivateBenchmarkRecorder | undefined;
  pool: Pool;
  model: GroundedModel | undefined;
  embedder: AppDeps["embedder"];
  operationalCache: OperationalCachePort | undefined;
  bridgeObjects: PrivateBridgeObjects | undefined;
  clock: ReturnType<typeof preparePrivateBridgeEnvironment>["clock"];
  executionRuntime: ReturnType<typeof buildExecutionRuntimeConfig>;
}): (() => void) | undefined {
  const {
    env,
    operationalDirectory,
    benchmark,
    pool,
    model,
    embedder,
    operationalCache,
    bridgeObjects,
    clock,
    executionRuntime,
  } = params;
  if (!operationalDirectory || !benchmark) {
    if (clock) throw new Error("Private clock recorder unavailable");
    return undefined;
  }
  const ports = createOperationalProbePorts({
    pool,
    benchmark,
    model,
    embedder,
    cache: operationalCache,
  });
  let remote:
    { campaign_id: string; expiresAtMs: number; objects: PrivateBridgeObjects } | undefined;
  if (env.BENCHMARK_BRIDGE_ENABLED === "true") {
    const campaignId = env.BENCHMARK_BRIDGE_CAMPAIGN_ID;
    if (!campaignId) throw new Error("Private bridge campaign ID unavailable");
    remote = {
      campaign_id: campaignId,
      expiresAtMs: Number(env.BENCHMARK_BRIDGE_EXPIRES_AT_MS),
      objects:
        bridgeObjects ??
        new GcsPrivateBridgeObjects({
          bucket: env.STORAGE_BUCKET ?? env.GCS_WORKSPACE_BUCKET ?? "",
        }),
    };
  }
  if (clock) {
    if (!remote) throw new Error("Private clock object channel unavailable");
    return benchmark.startClockCoordinator({
      directory: operationalDirectory,
      bootstrap: clock,
      remote,
      candidate: env.COMMIT_SHA,
      runtime: executionRuntime,
      ports,
    });
  }
  return benchmark.startOperationalCoordinator(operationalDirectory, ports, remote);
}

function createV2RuntimeForServer(params: {
  env: NodeJS.ProcessEnv;
  pool: Pool;
  sourceLimit: number;
  model: GroundedModel | undefined;
  modelConfigured: boolean;
  reportModel: VertexReportModel | undefined;
  storage: AppDeps["storage"];
  embedder: AppDeps["embedder"];
  notifyJobs: AppDeps["notifyJobs"];
}): AppDeps["v2"] {
  if (params.env.V2_POC === "off") {
    return undefined;
  }
  return createV2Runtime({
    pool: params.pool,
    sourceLimit: params.sourceLimit,
    guideAdmission: loadGuideAdmissionConfig(params.env),
    model: params.model,
    generation: createV2Generation(params.env, params.modelConfigured),
    reportModel: params.reportModel,
    structureGenerator: params.modelConfigured
      ? createEnterpriseStructuredGenerator("flash", params.env)
      : undefined,
    studioContext: params.reportModel?.contextRuntime,
    // FR-SI-02 / Gate v2.0 #1: Source Guides start from the Ready transition, not from a source listing.
    readyWatch: { intervalMs: Number(params.env.V2_READY_WATCH_MS ?? 1_000) },
    // FR-NM-03 (owner decision 2026-10-20): note-sources run the v1 ingestion with this storage and embedder.
    storage: params.storage,
    embedder: params.embedder,
    notifyJobs: params.notifyJobs,
    ...(params.modelConfigured
      ? {
          topicEmoji: new VertexTopicEmojiSelector(new VertexTopicEmojiClient({ env: params.env })),
        }
      : {}),
  });
}

function createBenchmarkForServer(params: {
  env: NodeJS.ProcessEnv;
  model: GroundedModel | undefined;
  embedder: AppDeps["embedder"];
  operationalCache: OperationalCachePort | undefined;
  studioContext: NonNullable<VertexReportModel>["contextRuntime"] | undefined;
  executionRuntime: ReturnType<typeof buildExecutionRuntimeConfig>;
  hasClockBootstrap: boolean;
}): PrivateBenchmarkRecorder | undefined {
  const benchmarkConfig = loadBenchmarkConfig(params.env);
  if (!benchmarkConfig) {
    return undefined;
  }
  const operationalDirectory = params.env.BENCHMARK_OPERATIONAL_DIRECTORY;
  const operationalConfigSha256 =
    operationalDirectory && params.model && params.embedder && params.operationalCache
      ? createHash("sha256")
          .update(
            JSON.stringify({
              model: params.model.id,
              retrieval: params.embedder.model,
              cache: params.operationalCache.identity,
            }),
          )
          .digest("hex")
      : undefined;
  return new PrivateBenchmarkRecorder({
    approved_notebook_ids: benchmarkConfig.approvedNotebookIds,
    revision: benchmarkConfig.revision,
    sink: createPrivateBenchmarkSink(benchmarkConfig.evidenceFile),
    fixtures: benchmarkConfig.fixtures,
    operationalConfigSha256,
    bridgeScaleFile: params.env.BENCHMARK_EVIDENCE_FILE,
    sourceTreeSha256: operationalDirectory
      ? measureOperationalSourceTree(fileURLToPath(new URL("../../../", import.meta.url)))
      : undefined,
    executionEvidence: PrivateBenchmarkRecorder.executionConfigFromEnv(
      params.env,
      params.executionRuntime,
    ),
    requiresClockBootstrap: params.hasClockBootstrap,
    ...(params.studioContext ? { tokenizer: params.studioContext.tokenizer } : {}),
  });
}

function createVerifierForServer(
  config: ReturnType<typeof loadApiConfig>,
  localIssuer: LocalIdentityIssuer | undefined,
): AppDeps["verifier"] {
  return (
    localIssuer?.verifier ??
    createIdentityPlatformVerifier({
      projectId: config.projectId,
      tenantId: config.identityPlatform?.tenantId,
      checkRevocation: config.checkRevocation,
    })
  );
}

function assertProductionModelConfigured(
  env: NodeJS.ProcessEnv,
  modelConfigured: boolean,
  hasExtraV2: boolean,
): void {
  if (
    (env.K_SERVICE || env.NODE_ENV === "production") &&
    !modelConfigured &&
    !hasExtraV2 &&
    env.V2_POC !== "off"
  ) {
    throw new Error("Enterprise Gemini configuration is required for production Studio generation");
  }
}

function createPickerConfigFromEnv(env: NodeJS.ProcessEnv): AppDeps["pickerConfig"] {
  if (!env.GOOGLE_PICKER_API_KEY || !env.GOOGLE_PICKER_APP_ID || !env.GOOGLE_OAUTH_CLIENT_ID) {
    return undefined;
  }
  return {
    developerKey: env.GOOGLE_PICKER_API_KEY,
    appId: env.GOOGLE_PICKER_APP_ID,
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
  };
}

function createChatServiceForServer(params: {
  pool: Pool;
  embedder: AppDeps["embedder"];
  model: GroundedModel | undefined;
  benchmark: PrivateBenchmarkRecorder | undefined;
  codeExecution: { runtime: SandboxRuntime; storage: ObjectStorage } | undefined;
  v2: AppDeps["v2"];
}): AppDeps["chat"] {
  const { pool, embedder, model, benchmark, codeExecution, v2 } = params;
  if (!embedder || !model) {
    return undefined;
  }
  return new ChatService({
    pool,
    embedder,
    model,
    benchmark,
    codeExecution,
    ...(v2
      ? {
          resolvePreferences: (ownerId: string, notebookId: string, locale?: string) =>
            v2.chatPreferences(ownerId, notebookId, locale),
        }
      : {}),
  });
}

function resolveModelPipeline(
  env: NodeJS.ProcessEnv,
  extra: Partial<AppDeps>,
  privateModel: GroundedModel | undefined,
): {
  embedder: AppDeps["embedder"];
  modelConfigured: boolean;
  model: GroundedModel | undefined;
} {
  const vertexConfigured = Boolean(
    env.VERTEX_PROJECT ?? env.GCP_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT,
  );
  const embedder = extra.embedder ?? createServerEmbedder(env, vertexConfigured);
  const modelConfigured = Boolean(
    embedder && vertexConfigured && env.EVERLAST_DEV_TEST_EMBEDDER !== "1",
  );
  assertProductionModelConfigured(env, modelConfigured, Boolean(extra.v2));
  const model = privateModel ?? (modelConfigured ? createGroundedModelFromEnv(env) : undefined);
  return { embedder, modelConfigured, model };
}

function setupCodeExecution(params: {
  env: NodeJS.ProcessEnv;
  pool: Pool;
  storage: ObjectStorage;
  privateRuntime: SandboxRuntime | undefined;
  startupCleanup: Array<() => void>;
}): {
  sandboxRuntime: SandboxRuntime | undefined;
  codeExecution: { runtime: SandboxRuntime; storage: ObjectStorage } | undefined;
  stopReconciler: (() => void) | undefined;
} {
  const sandboxRuntime = params.privateRuntime ?? createSandboxRuntime(params.env);
  const codeExecution = sandboxRuntime
    ? { runtime: sandboxRuntime, storage: params.storage }
    : undefined;
  const stopReconciler = codeExecution
    ? startCodeExecutionReconciler({ pool: params.pool, ...codeExecution })
    : undefined;
  if (stopReconciler) params.startupCleanup.push(stopReconciler);
  return { sandboxRuntime, codeExecution, stopReconciler };
}

async function setupBenchmarkAndOperational(params: {
  env: NodeJS.ProcessEnv;
  pool: Pool;
  extra: Partial<AppDeps>;
  model: GroundedModel | undefined;
  modelConfigured: boolean;
  embedder: AppDeps["embedder"];
  v2: AppDeps["v2"];
  reportModel: VertexReportModel | undefined;
  sandboxRuntime: SandboxRuntime | undefined;
  privateCache: OperationalCachePort | undefined;
  privateBridgeObjects: PrivateBridgeObjects | undefined;
  clock: ReturnType<typeof preparePrivateBridgeEnvironment>["clock"];
  startupCleanup: Array<() => void>;
}): Promise<{
  benchmark: PrivateBenchmarkRecorder | undefined;
  stopOperational: (() => void) | undefined;
}> {
  const operationalDirectory = params.env.BENCHMARK_OPERATIONAL_DIRECTORY;
  assertOperationalDirectorySafe(operationalDirectory, params.env);
  const operationalCache =
    params.privateCache ??
    (operationalDirectory && params.modelConfigured
      ? createOperationalCacheFromEnv(params.env)
      : undefined);
  const executionRuntime = buildExecutionRuntimeConfig(
    params.env,
    params.sandboxRuntime,
    Boolean(params.clock),
  );
  const benchmark =
    params.extra.benchmark ??
    createBenchmarkForServer({
      env: params.env,
      model: params.model,
      embedder: params.embedder,
      operationalCache,
      studioContext: params.reportModel?.contextRuntime,
      executionRuntime,
      hasClockBootstrap: Boolean(params.clock),
    });
  if (benchmark && !params.extra.benchmark) {
    await qualifyBenchmarkDependencies(benchmark, params.pool, params.v2);
  }
  const stopOperational = params.extra.benchmark
    ? undefined
    : startOperationalCoordinatorForServer({
        env: params.env,
        operationalDirectory,
        benchmark,
        pool: params.pool,
        model: params.model,
        embedder: params.embedder,
        operationalCache,
        bridgeObjects: params.privateBridgeObjects,
        clock: params.clock,
        executionRuntime,
      });
  if (stopOperational) params.startupCleanup.push(stopOperational);
  return { benchmark, stopOperational };
}

export async function startApiServer(
  env: NodeJS.ProcessEnv = process.env,
  extra: Partial<AppDeps> = {},
  privateComposition?: {
    model?: GroundedModel;
    cache?: OperationalCachePort;
    runtime?: SandboxRuntime;
    bridgeObjects?: PrivateBridgeObjects;
  },
): Promise<StartedApiServer> {
  if (env.BENCHMARK_BRIDGE_ENABLED === "true" && extra.benchmark)
    throw new Error("Remote private bridge requires actual server-owned recorder");
  const bridgeBootstrap = preparePrivateBridgeEnvironment(env);
  const effectiveEnv = bridgeBootstrap.env;
  const startupCleanup: Array<() => void> = [bridgeBootstrap.cleanup];
  try {
    const config = loadApiConfig(effectiveEnv);
    const pool = extra.pool ?? createPool();
    if (effectiveEnv.MIGRATE_ON_START === "true") await runMigrations(pool);
    const localIssuer =
      config.authMode === "local" ? new LocalIdentityIssuer(effectiveEnv) : undefined;
    const verifier = createVerifierForServer(config, localIssuer);
    const { embedder, modelConfigured, model } = resolveModelPipeline(
      effectiveEnv,
      extra,
      privateComposition?.model,
    );
    const storage = extra.storage ?? createObjectStorage(effectiveEnv);
    const reportModel = createV2ReportModel(effectiveEnv, modelConfigured);
    const notifyJobs = extra.notifyJobs ?? createJobNotifier(effectiveEnv);
    // Release v2 features (D16): stores in PostgreSQL since specs/013; set V2_POC=off to serve v1 only.
    const v2 =
      extra.v2 ??
      createV2RuntimeForServer({
        env: effectiveEnv,
        pool,
        sourceLimit: config.sourceLimit,
        model,
        modelConfigured,
        reportModel,
        storage,
        embedder,
        notifyJobs,
      });
    const { sandboxRuntime, codeExecution, stopReconciler } = setupCodeExecution({
      env: effectiveEnv,
      pool,
      storage,
      privateRuntime: privateComposition?.runtime,
      startupCleanup,
    });
    const { benchmark, stopOperational } = await setupBenchmarkAndOperational({
      env: effectiveEnv,
      pool,
      extra,
      model,
      modelConfigured,
      embedder,
      v2,
      reportModel,
      sandboxRuntime,
      privateCache: privateComposition?.cache,
      privateBridgeObjects: privateComposition?.bridgeObjects,
      clock: bridgeBootstrap.clock,
      startupCleanup,
    });
    const chat =
      extra.chat ??
      createChatServiceForServer({ pool, embedder, model, benchmark, codeExecution, v2 });
    // Delegated Drive access (D11, specs/009): only with an owner-registered OAuth client; the secret is mounted.
    const deps: AppDeps = {
      pool,
      config,
      delegationBroker: createDelegationBrokerFromEnv(effectiveEnv),
      pickerConfig: createPickerConfigFromEnv(effectiveEnv),
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
    server.once("close", () => {
      stopOperational?.();
      stopReconciler?.();
      bridgeBootstrap.cleanup();
    });
    await new Promise<void>((done) => server.listen(config.port, done));
    console.log(
      JSON.stringify({
        severity: "INFO",
        message: `API listening on :${config.port} (auth=${config.authMode})`,
      }),
    );
    return { server, pool, deps };
  } catch (error) {
    for (const cleanup of startupCleanup.reverse()) cleanup();
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startApiServer().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
