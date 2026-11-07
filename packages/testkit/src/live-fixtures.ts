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
