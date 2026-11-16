import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

/**
 * [001-workspace-foundation] T060 & Dev Cloud Lifecycle — FR-WM-01/04, NFR-SEC-01/02, D4, D24/DEV-07.
 * Live cloud integration and smoke tests run exclusively against the `dev` environment.
 * When `dev` Cloud SQL / Cloud Run is scaled down to zero, the harness prompts for permission before
 * starting it and automatically scales it back down afterward unless it was already running beforehand.
 */

const NON_DEV_TARGET_RE = /(?:^|[-_/:.])(prod|production|staging)(?:$|[-_/:.])/i;

export function assertDevOnlyEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  const everlastEnv = (env.EVERLAST_ENV ?? "dev").trim().toLowerCase();
  if (everlastEnv !== "dev") {
    throw new Error(`UNAVAILABLE: live cloud tests may only run against the dev environment (got EVERLAST_ENV=${everlastEnv})`);
  }
  if (env.NODE_ENV === "production" || env.K_SERVICE) {
    throw new Error("UNAVAILABLE: live cloud tests are forbidden inside production or deployed Cloud Run runtimes");
  }
  const checkedValues = [
    env.WORKSPACE_IT_PROJECT,
    env.VERTEX_PROJECT,
    env.GCP_PROJECT_ID,
    env.GOOGLE_CLOUD_PROJECT,
    env.WORKSPACE_IT_BUCKET,
    env.GCS_WORKSPACE_BUCKET,
    env.STORAGE_BUCKET,
    env.CLOUD_SQL_CONNECTION_NAME,
    env.CODE_EXECUTION_REASONING_ENGINE,
    env.DEV_CLOUD_SQL_INSTANCE,
    env.DEV_CLOUD_RUN_API,
  ];
  for (const val of checkedValues) {
    if (val && NON_DEV_TARGET_RE.test(val)) {
      throw new Error(`UNAVAILABLE: live cloud tests cannot target staging/production resource (${val})`);
    }
  }
}

export function approvedLiveFixture(env: NodeJS.ProcessEnv, kind: "identity" | "storage"): { project: string; target: string } {
  assertDevOnlyEnvironment(env);
  const project = (
    env.WORKSPACE_IT_PROJECT ??
    env.VERTEX_PROJECT ??
    env.GCP_PROJECT_ID ??
    env.GOOGLE_CLOUD_PROJECT ??
    ""
  ).trim();
  const target = (
    kind === "identity"
      ? env.WORKSPACE_IT_IDENTITY_UID ?? ""
      : env.WORKSPACE_IT_BUCKET ?? env.GCS_WORKSPACE_BUCKET ?? env.STORAGE_BUCKET ?? ""
  ).trim();

  if (!project || !target) {
    throw new Error(`UNAVAILABLE: dev ${kind} fixture configuration is required`);
  }
  if (env.WORKSPACE_IT_APPROVED_FIXTURE && env.WORKSPACE_IT_APPROVED_FIXTURE !== `${project}/${kind}/${target}`) {
    throw new Error(`UNAVAILABLE: WORKSPACE_IT_APPROVED_FIXTURE mismatch for dev ${kind} fixture`);
  }

  if (kind === "storage") {
    let url: URL;
    try {
      url = new URL(env.TEST_DATABASE_URL ?? "http://missing");
    } catch {
      throw new Error("UNAVAILABLE: storage cleanup tests require a valid PostgreSQL TEST_DATABASE_URL");
    }
    if (!["postgres:", "postgresql:"].includes(url.protocol)) {
      throw new Error("UNAVAILABLE: storage cleanup tests require a valid PostgreSQL TEST_DATABASE_URL");
    }
    if (NON_DEV_TARGET_RE.test(url.hostname) || NON_DEV_TARGET_RE.test(url.pathname)) {
      throw new Error("UNAVAILABLE: storage cleanup tests cannot point at a staging/production database");
    }
  }
  return { project, target };
}

export function requiredFixtureValue(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`UNAVAILABLE: ${key} is required for the dev live test fixture`);
  return value;
}

/** [001-workspace-foundation] T061 — Frozen description of the two-user dev test plan. */
function approvedUser(env: NodeJS.ProcessEnv, suffix: "" | "_B") {
  const { project } = approvedLiveFixture(env, "identity");
  const uid = env[`WORKSPACE_IT_IDENTITY_UID${suffix}`] ?? "";
  const email = env[`WORKSPACE_IT_EMAIL${suffix}`] ?? "";
  const explicitApproval = env[`WORKSPACE_IT_APPROVED_FIXTURE${suffix}`];
  if (!uid || !email || (explicitApproval && explicitApproval !== `${project}/identity/${uid}`)) {
    throw new Error(`UNAVAILABLE: dev identity user${suffix ? " B" : " A"} configuration is required`);
  }
  return { uid, email };
}

export function frozenLiveFixturePlan(env: NodeJS.ProcessEnv) {
  const a = approvedUser(env, "");
  const b = approvedUser(env, "_B");
  if (a.uid === b.uid || a.email.toLowerCase() === b.email.toLowerCase()) {
    throw new Error("UNAVAILABLE: the two test users must be distinct");
  }
  approvedLiveFixture(env, "identity");
  approvedLiveFixture(env, "storage");
  return Object.freeze({
    users: Object.freeze([
      Object.freeze({ id: "a", ...a, notebookPrefixLabel: "notebook-a" }),
      Object.freeze({ id: "b", ...b, notebookPrefixLabel: "notebook-b" }),
    ]),
    objects: Object.freeze([
      Object.freeze({ owner: "a", name: "sources/fixture/raw", generations: Object.freeze(["v1", "v2"]), hold: "v1" as string | null }),
      Object.freeze({ owner: "a", name: "sources/late/raw", generations: Object.freeze(["late-put"]), hold: null as string | null }),
      Object.freeze({ owner: "b", name: "sources/fixture/raw", generations: Object.freeze(["v1", "v2"]), hold: null as string | null }),
    ]),
    signup: Object.freeze({ probe: "existing-email", expectedError: "ADMIN_ONLY_OPERATION", requiredPolicy: "disabledUserSignup=true", rollback: env.WORKSPACE_IT_SIGNUP_ROLLBACK ?? "disabledUserSignup=true" }),
    revocation: Object.freeze({ revokedUser: "a", survivingUser: "b" }),
    cleanupRetry: Object.freeze(["retry:RetainedObject", "deferred", "purged"]),
  });
}

/** Individually recorded resumable-upload scenarios. The API issues signed PUT capabilities only. */
export const RESUMABLE_SCENARIOS: ReadonlyArray<{ id: string; verifiable: boolean; reason: string }> = Object.freeze([
  { id: "signed-put-expiry-late-sweep", verifiable: true, reason: "Real signed PUT lands before expiry; cleanup waits, then fails after expiry." },
  { id: "post-resumable-denied-on-put-capability", verifiable: true, reason: "POST x-goog-resumable start is rejected on the issued PUT capability." },
  { id: "externally-created-resumable-session-cancel", verifiable: false, reason: "UNAVAILABLE: the API never issues or tracks resumable sessions, so cancellation cannot be exercised through it." },
  { id: "resumable-session-survives-notebook-delete", verifiable: false, reason: "UNAVAILABLE: needs an API-issued resumable session; current API exposes none." },
]);

export interface DevInstanceState {
  environment: "dev";
  sqlInstance: string;
  apiService: string;
  region: string;
  sqlActivationPolicy: string;
  sqlState: string;
  sqlRunning: boolean;
  apiMinInstances: number;
}

export interface EnsureDevEnvironmentOptions {
  env?: NodeJS.ProcessEnv;
  warmupApi?: boolean;
  execCommand?: (cmd: string, args: string[]) => string | null;
  promptConfirm?: (question: string) => Promise<boolean>;
  log?: (msg: string) => void;
}

export interface DevEnvironmentLease {
  stateBefore: DevInstanceState;
  startedSql: boolean;
  warmedApi: boolean;
  restore(): Promise<void>;
}

function defaultExecGcloud(cmd: string, args: string[]): string | null {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function defaultPromptConfirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export function inspectDevInstanceState(
  options: Pick<EnsureDevEnvironmentOptions, "env" | "execCommand" | "warmupApi"> = {}
): DevInstanceState {
  const env = options.env ?? process.env;
  assertDevOnlyEnvironment(env);

  const sqlInstance = (env.DEV_CLOUD_SQL_INSTANCE ?? "everlast-dev-pg").trim();
  const apiService = (env.DEV_CLOUD_RUN_API ?? "everlast-dev-api").trim();
  const region = (env.DEV_CLOUD_RUN_REGION ?? "europe-west4").trim();
  const run = options.execCommand ?? defaultExecGcloud;

  let sqlRaw: string | null = null;
  try {
    sqlRaw = run("gcloud", ["sql", "instances", "describe", sqlInstance, "--format=json", "--quiet"]);
  } catch (err) {
    throw new Error(
      `UNAVAILABLE: Could not inspect dev Cloud SQL instance (${sqlInstance}): ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!sqlRaw) {
    throw new Error(`UNAVAILABLE: Dev Cloud SQL instance (${sqlInstance}) returned empty state`);
  }

  let sqlJson: { settings?: { activationPolicy?: string }; state?: string };
  try {
    sqlJson = JSON.parse(sqlRaw) as typeof sqlJson;
  } catch {
    throw new Error(`UNAVAILABLE: Invalid JSON inspecting dev Cloud SQL instance (${sqlInstance})`);
  }

  const sqlActivationPolicy = sqlJson.settings?.activationPolicy ?? "UNKNOWN";
  const sqlState = sqlJson.state ?? "UNKNOWN";
  const sqlRunning = sqlActivationPolicy === "ALWAYS" && sqlState === "RUNNABLE";

  let apiMinInstances = 0;
  try {
    const apiRaw = run("gcloud", ["run", "services", "describe", apiService, `--region=${region}`, "--format=json", "--quiet"]);
    if (apiRaw) {
      const apiJson = JSON.parse(apiRaw) as { spec?: { template?: { metadata?: { annotations?: Record<string, string> } } } };
      apiMinInstances = Number(apiJson.spec?.template?.metadata?.annotations?.["run.googleapis.com/minScale"] ?? 0);
      if (!Number.isFinite(apiMinInstances)) apiMinInstances = 0;
    } else if (options.warmupApi) {
      throw new Error(`Dev Cloud Run service (${apiService}) returned empty state`);
    }
  } catch (err) {
    if (options.warmupApi) {
      throw new Error(
        `UNAVAILABLE: Could not inspect dev Cloud Run service (${apiService}): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return {
    environment: "dev",
    sqlInstance,
    apiService,
    region,
    sqlActivationPolicy,
    sqlState,
    sqlRunning,
    apiMinInstances,
  };
}

/**
 * Ensures the `dev` cloud environment is running before live cloud tests execute.
 * - Rejects non-`dev` targets unconditionally.
 * - If `everlast-dev-pg` is scaled down (`activationPolicy !== "ALWAYS"` or `state !== "RUNNABLE"`), asks the user
 *   for permission before starting it and scales it back down to zero in `restore()`.
 * - If `everlast-dev-pg` (and `everlast-dev-api` when `warmupApi=true`) was already running beforehand, leaves it
 *   untouched in `restore()`.
 */
export async function ensureDevEnvironmentForTests(
  options: EnsureDevEnvironmentOptions = {}
): Promise<DevEnvironmentLease> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((msg: string) => console.log(msg));
  const run = options.execCommand ?? defaultExecGcloud;
  const confirm = options.promptConfirm ?? defaultPromptConfirm;

  const stateBefore = inspectDevInstanceState(options);
  const needsSqlStart = !stateBefore.sqlRunning;
  const needsApiWarmup = Boolean(options.warmupApi) && stateBefore.apiMinInstances === 0;

  if (!needsSqlStart && !needsApiWarmup) {
    log(
      `[dev-env] Dev environment (${stateBefore.sqlInstance}) is already running; leaving it running after test execution.`
    );
    return {
      stateBefore,
      startedSql: false,
      warmedApi: false,
      async restore() {},
    };
  }

  const preApproved = env.EVERLAST_START_DEV_APPROVED === "1" || env.EVERLAST_AUTO_START_DEV === "1";
  const targets: string[] = [];
  if (needsSqlStart) targets.push(`${stateBefore.sqlInstance} (${stateBefore.sqlActivationPolicy}/${stateBefore.sqlState})`);
  if (needsApiWarmup) targets.push(`${stateBefore.apiService} (min-instances=0)`);

  const question =
    `Dev environment (${targets.join(", ")}) is currently scaled down to zero. ` +
    "Start the dev environment for test execution (it will be scaled back down afterward)? [y/N]: ";

  const granted = preApproved || (await confirm(question));
  if (!granted) {
    throw new Error(
      `UNAVAILABLE: Dev environment (${stateBefore.sqlInstance}) is not running and permission to start it for test execution was not granted.`
    );
  }

  let startedSql = false;
  let warmedApi = false;
  let restored = false;

  const scaleBackDown = async () => {
    if (restored) return;
    restored = true;
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);

    const errors: string[] = [];
    if (warmedApi) {
      try {
        log(`[dev-env] Scaling down ${stateBefore.apiService} back to min-instances=0...`);
        run("gcloud", [
          "run",
          "services",
          "update",
          stateBefore.apiService,
          `--region=${stateBefore.region}`,
          "--min-instances=0",
          "--quiet",
        ]);
      } catch (err) {
        errors.push(`Cloud Run scale-down failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (startedSql) {
      try {
        log(`[dev-env] Scaling down ${stateBefore.sqlInstance} back to activation-policy=NEVER...`);
        run("gcloud", ["sql", "instances", "patch", stateBefore.sqlInstance, "--activation-policy=NEVER", "--quiet"]);
      } catch (err) {
        errors.push(`Cloud SQL pause failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (errors.length > 0) {
      console.error(`[dev-env] WARNING: ${errors.join("; ")}`);
      throw new Error(errors.join("; "));
    }
  };

  const onSignal = () => {
    void scaleBackDown().finally(() => process.exit(130));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    if (needsSqlStart) {
      log(`[dev-env] Starting ${stateBefore.sqlInstance} (activation-policy=ALWAYS) for test execution...`);
      run("gcloud", ["sql", "instances", "patch", stateBefore.sqlInstance, "--activation-policy=ALWAYS", "--quiet"]);
      startedSql = true;
    }
    if (needsApiWarmup) {
      log(`[dev-env] Warming up ${stateBefore.apiService} (min-instances=1) for test execution...`);
      run("gcloud", [
        "run",
        "services",
        "update",
        stateBefore.apiService,
        `--region=${stateBefore.region}`,
        "--min-instances=1",
        "--quiet",
      ]);
      warmedApi = true;
    }
  } catch (err) {
    await scaleBackDown().catch(() => {});
    throw err;
  }

  return {
    stateBefore,
    startedSql,
    warmedApi,
    restore: scaleBackDown,
  };
}

export async function withDevTestEnvironment<T>(
  options: EnsureDevEnvironmentOptions,
  fn: (lease: DevEnvironmentLease) => Promise<T>
): Promise<T> {
  const lease = await ensureDevEnvironmentForTests(options);
  try {
    return await fn(lease);
  } finally {
    await lease.restore();
  }
}
