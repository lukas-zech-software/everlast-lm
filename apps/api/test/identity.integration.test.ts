import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GoogleAuth } from "google-auth-library";
import { approvedLiveFixture, ensureDevEnvironmentForTests, requiredFixtureValue, type DevEnvironmentLease } from "@everlast/testkit/live-fixtures";
import { GoogleSecureTokenKeys, IdentityToolkitRevocationChecker, LocalIdentityIssuer, TokenVerifier } from "../src/auth/identity.ts";

/**
 * [001-workspace-foundation] T046/T060 — FR-WM-04, NFR-SEC-01/02.
 * Runs only against the `dev` Identity Platform tenant and revokes tokens on the test user.
 */
describe.skipIf(process.env.WORKSPACE_IDENTITY_IT !== "1")("dev real Identity Platform", () => {
  let project: string, uid: string, key: string, email: string, password: string;
  let devLease: DevEnvironmentLease | undefined;
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

  beforeAll(async () => {
    devLease = await ensureDevEnvironmentForTests({ env: process.env });
    ({ project, target: uid } = approvedLiveFixture(process.env, "identity"));
    key = requiredFixtureValue(process.env, "WORKSPACE_IT_API_KEY");
    email = requiredFixtureValue(process.env, "WORKSPACE_IT_EMAIL");
    password = requiredFixtureValue(process.env, "WORKSPACE_IT_PASSWORD");

    const client = await auth.getClient();
    const config = await client.request<{ client?: { permissions?: { disabledUserSignup?: boolean } } }>({
      url: `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`,
      headers: { "x-goog-user-project": project },
      timeout: 30_000,
    }).catch(() => {
      throw new Error("UNAVAILABLE: dev Identity Platform config is unreadable");
    });
    expect(config.data.client?.permissions?.disabledUserSignup, "Refuse signup probe until self-signup is disabled").toBe(true);
  });

  afterAll(async () => {
    await devLease?.restore();
  });

  it("preserves existing sign-in, denies direct registration and verifies real token revocation", async () => {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Dev test user sign-in failed (HTTP ${response.status})`);
    const signed = (await response.json()) as { idToken: string; localId: string };
    expect(signed.localId).toBe(uid);

    const verifier = new TokenVerifier({
      audience: project,
      issuer: `https://securetoken.google.com/${project}`,
      keys: new GoogleSecureTokenKeys(),
      revocation: new IdentityToolkitRevocationChecker({ projectId: project, cacheSeconds: 0 }),
    });
    expect((await verifier.verifyToken(signed.idToken)).subject).toBe(uid);

    // Probe with the existing email: confirm direct self-signup stays disabled.
    const signup = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      signal: AbortSignal.timeout(30_000),
    });
    const denied = (await signup.json()) as { error?: { message?: string } };
    expect(signup.ok).toBe(false);
    expect(denied.error?.message).toBe("ADMIN_ONLY_OPERATION");

    const client = await auth.getClient();
    await client.request({
      url: `https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:update`,
      method: "POST",
      timeout: 30_000,
      data: { localId: uid, validSince: String(Math.floor(Date.now() / 1000) + 1) },
    }).catch(() => {
      throw new Error("Dev fixture token revocation failed");
    });
    await expect(verifier.verifyToken(signed.idToken)).rejects.toThrow(/revoked/);

    // Optional second test user check when configured in dev.
    if (process.env.WORKSPACE_IT_EMAIL_B && process.env.WORKSPACE_IT_PASSWORD_B && process.env.WORKSPACE_IT_IDENTITY_UID_B) {
      const signedB = (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          email: process.env.WORKSPACE_IT_EMAIL_B,
          password: process.env.WORKSPACE_IT_PASSWORD_B,
          returnSecureToken: true,
        }),
      }).then((r) => r.json())) as { idToken: string; localId: string };
      expect(signedB.localId).toBe(process.env.WORKSPACE_IT_IDENTITY_UID_B);
      expect((await verifier.verifyToken(signedB.idToken)).subject).toBe(signedB.localId);
    }
    expect(() => new LocalIdentityIssuer({ NODE_ENV: "production" })).toThrow(/forbidden/);
  });
});
