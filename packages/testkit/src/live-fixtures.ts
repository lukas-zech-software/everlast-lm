/** [001-workspace-foundation] T060 — FR-WM-01/04, NFR-SEC-01/02.
 * Test-only admission: never infer destructive cloud fixture authorization from ordinary app env.
 */
export function approvedLiveFixture(env: NodeJS.ProcessEnv, kind: "identity" | "storage"): { project: string; target: string } {
  const project = env.WORKSPACE_IT_PROJECT ?? "";
  const target = env[kind === "identity" ? "WORKSPACE_IT_IDENTITY_UID" : "WORKSPACE_IT_BUCKET"] ?? "";
  if (!project || !target || env.WORKSPACE_IT_APPROVED_FIXTURE !== `${project}/${kind}/${target}`) {
    throw new Error(`UNAVAILABLE: explicit disposable ${kind} fixture configuration/approval is required`);
  }
  if (/prod(uction)?/i.test(project) || /prod(uction)?/i.test(target) || env.K_SERVICE || env.NODE_ENV === "production") {
    throw new Error("UNAVAILABLE: production fixtures and deployed execution are forbidden");
  }
  if (kind === "storage") {
    let url: URL;
    try { url = new URL(env.TEST_DATABASE_URL ?? "http://missing"); }
    catch { throw new Error("UNAVAILABLE: storage cleanup tests require a valid disposable local PostgreSQL URL"); }
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !["postgres:", "postgresql:"].includes(url.protocol)) {
      throw new Error("UNAVAILABLE: storage cleanup tests require disposable local PostgreSQL");
    }
    if (target === env.STORAGE_BUCKET || target === env.GCS_WORKSPACE_BUCKET) {
      throw new Error("UNAVAILABLE: application workspace buckets cannot be used as fixtures");
    }
  }
  return { project, target };
}
export function requiredFixtureValue(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`UNAVAILABLE: ${key} is required for the approved disposable fixture`);
  return value;
}

/** [001-workspace-foundation] T061 — FR-WM-01/04, NFR-SEC-01/02.
 * Frozen, side-effect-free description of the approved live run. Building it never touches the cloud.
 */
function approvedUser(env: NodeJS.ProcessEnv, suffix: "" | "_B") {
  const uid = env[`WORKSPACE_IT_IDENTITY_UID${suffix}`] ?? "";
  const email = env[`WORKSPACE_IT_EMAIL${suffix}`] ?? "";
  const project = env.WORKSPACE_IT_PROJECT ?? "";
  if (!uid || !email || !project || env[`WORKSPACE_IT_APPROVED_FIXTURE${suffix}`] !== `${project}/identity/${uid}`) {
    throw new Error(`UNAVAILABLE: approved disposable identity user${suffix ? " B" : " A"} is required`);
  }
  return { uid, email };
}
export function frozenLiveFixturePlan(env: NodeJS.ProcessEnv) {
  const a = approvedUser(env, "");
  const b = approvedUser(env, "_B");
  if (a.uid === b.uid || a.email.toLowerCase() === b.email.toLowerCase()) {
    throw new Error("UNAVAILABLE: the two disposable users must be distinct");
  }
  approvedLiveFixture({ ...env, WORKSPACE_IT_IDENTITY_UID: a.uid, WORKSPACE_IT_APPROVED_FIXTURE: `${env.WORKSPACE_IT_PROJECT}/identity/${a.uid}` }, "identity");
  const bucket = env.WORKSPACE_IT_BUCKET ?? "";
  if (env.WORKSPACE_IT_APPROVED_STORAGE !== `${env.WORKSPACE_IT_PROJECT}/storage/${bucket}`) {
    throw new Error("UNAVAILABLE: approved disposable storage fixture is required");
  }
  approvedLiveFixture({ ...env, WORKSPACE_IT_APPROVED_FIXTURE: env.WORKSPACE_IT_APPROVED_STORAGE }, "storage");
  const rollback = env.WORKSPACE_IT_SIGNUP_ROLLBACK ?? "";
  if (rollback !== "disabledUserSignup=true") {
    throw new Error("UNAVAILABLE: the reviewed signup rollback input is required");
  }
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
    signup: Object.freeze({ probe: "existing-email", expectedError: "ADMIN_ONLY_OPERATION", requiredPolicy: "disabledUserSignup=true", rollback }),
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
