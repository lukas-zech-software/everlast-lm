import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createSign, type KeyObject } from "node:crypto";
import {
  AuthenticationError,
  LocalIdentityIssuer,
  StaticKeys,
  TokenVerifier,
  GoogleSecureTokenKeys,
  assertLocalAuthAllowed,
} from "../src/auth/identity.ts";

/** T007/T051 — Identity Platform token verification (FR-WM-04, NFR-SEC-01). */

const PROJECT = "everlast-test-project";
const ISSUER = `https://securetoken.google.com/${PROJECT}`;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = () => Math.floor(Date.now() / 1000);

function sign(payload: Record<string, unknown>, options: { key?: KeyObject; header?: Record<string, unknown> } = {}) {
  const header = options.header ?? { alg: "RS256", kid: "k1" };
  const input = `${b64(header)}.${b64(payload)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(input);
  return `${input}.${signer.sign(options.key ?? privateKey).toString("base64url")}`;
}

const claims = (overrides: Record<string, unknown> = {}) => ({
  aud: PROJECT,
  iss: ISSUER,
  sub: "uid-12345",
  email: "user@example.test",
  auth_time: now() - 60,
  iat: now() - 60,
  exp: now() + 3600,
  ...overrides,
});

function verifier(revoked: Set<string> = new Set()) {
  return new TokenVerifier({
    audience: PROJECT,
    issuer: ISSUER,
    keys: new StaticKeys({ k1: publicKey }),
    revocation: { isRevoked: async (sub) => revoked.has(sub) },
  });
}

const bearer = (token: string) => `Bearer ${token}`;

describe("FR-WM-04 / NFR-SEC-01: Identity Platform token verification", () => {
  it("AUTH-01: rejects a missing Authorization header", async () => {
    await expect(verifier().verifyAuthorizationHeader(undefined)).rejects.toThrow(/missing/i);
  });

  it("AUTH-02: rejects malformed Authorization headers", async () => {
    for (const header of ["Basic abc", "Bearer", "Bearer a.b", "token", "Bearer a.b.c d"]) {
      await expect(verifier().verifyAuthorizationHeader(header)).rejects.toBeInstanceOf(AuthenticationError);
    }
  });

  it("AUTH-03: rejects an expired token", async () => {
    await expect(verifier().verifyAuthorizationHeader(bearer(sign(claims({ exp: now() - 120 }))))).rejects.toThrow(/expired/);
  });

  it("AUTH-04: rejects a revoked token", async () => {
    await expect(verifier(new Set(["uid-12345"])).verifyAuthorizationHeader(bearer(sign(claims())))).rejects.toThrow(/revoked/);
  });

  it("AUTH-05: rejects wrong project audience or issuer", async () => {
    await expect(verifier().verifyAuthorizationHeader(bearer(sign(claims({ aud: "other" }))))).rejects.toThrow(/audience/);
    await expect(
      verifier().verifyAuthorizationHeader(bearer(sign(claims({ iss: "https://securetoken.google.com/other" }))))
    ).rejects.toThrow(/issuer/);
  });

  it("AUTH-06: identity is derived only from the verified token subject", async () => {
    const identity = await verifier().verifyAuthorizationHeader(bearer(sign(claims({ owner_id: "forged-owner" }))));
    expect(identity).toEqual({ issuer: ISSUER, subject: "uid-12345", email: "user@example.test", authTime: expect.any(Number) });
  });

  it("AUTH-07: subject, not email, is the stable identity", async () => {
    const a = await verifier().verifyToken(sign(claims({ email: "a@example.test" })));
    const b = await verifier().verifyToken(sign(claims({ email: "renamed@example.test" })));
    expect(a.subject).toBe(b.subject);
    await expect(verifier().verifyToken(sign(claims({ sub: "" })))).rejects.toThrow(/subject/);
  });

  it("AUTH-08: local fixture issuer cannot run in production or on Cloud Run", () => {
    expect(() => assertLocalAuthAllowed({ NODE_ENV: "production" })).toThrow(/forbidden/);
    expect(() => assertLocalAuthAllowed({ K_SERVICE: "everlast-api" })).toThrow(/forbidden/);
    expect(() => new LocalIdentityIssuer({ NODE_ENV: "production" })).toThrow(/forbidden/);
    // A locally issued token is not accepted by the Identity Platform verifier (different issuer and key).
    const local = new LocalIdentityIssuer({ NODE_ENV: "test" });
    return expect(verifier().verifyToken(local.issue("uid-12345"))).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("AUTH-09: rejects valid claims carrying a forged signature", async () => {
    const forged = `${b64({ alg: "RS256", kid: "k1" })}.${b64(claims({ sub: "attacker" }))}.forged`;
    await expect(verifier().verifyToken(forged)).rejects.toThrow(/signature/);
    await expect(verifier().verifyToken(sign(claims({ sub: "attacker" }), { key: other.privateKey }))).rejects.toThrow(/signature/);
    // Payload swapped after signing.
    const genuine = sign(claims());
    const [h, , s] = genuine.split(".");
    await expect(verifier().verifyToken(`${h}.${b64(claims({ sub: "attacker" }))}.${s}`)).rejects.toThrow(/signature/);
  });

  it("AUTH-10: rejects unsigned (alg=none), HS256 and unknown-key tokens", async () => {
    await expect(verifier().verifyToken(`${b64({ alg: "none" })}.${b64(claims())}.`)).rejects.toThrow(/algorithm/);
    await expect(verifier().verifyToken(sign(claims(), { header: { alg: "HS256", kid: "k1" } }))).rejects.toThrow(/algorithm/);
    await expect(verifier().verifyToken(sign(claims(), { header: { alg: "RS256", kid: "k9" } }))).rejects.toThrow(/key/);
    await expect(verifier().verifyToken(sign(claims(), { header: { alg: "RS256" } }))).rejects.toThrow(/key id/);
  });

  it("AUTH-11: rejects tokens issued in the future or missing exp/iat", async () => {
    await expect(verifier().verifyToken(sign(claims({ iat: now() + 3600 })))).rejects.toThrow(/future/);
    await expect(verifier().verifyToken(sign(claims({ exp: undefined })))).rejects.toThrow(/exp/);
  });

  it("AUTH-12: Google secure-token keys are fetched, cached and used for verification", async () => {
    let fetches = 0;
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const keys = new GoogleSecureTokenKeys({
      fetchImpl: (async () => {
        fetches++;
        return new Response(JSON.stringify({ k1: pem }), { headers: { "cache-control": "public, max-age=600" } });
      }) as typeof fetch,
    });
    const v = new TokenVerifier({ audience: PROJECT, issuer: ISSUER, keys });
    await v.verifyToken(sign(claims()));
    await v.verifyToken(sign(claims()));
    expect(fetches).toBe(1);
  });

  it("AUTH-13: local issuer tokens verify through the same signature path and honour revocation", async () => {
    const local = new LocalIdentityIssuer({ NODE_ENV: "test" });
    const token = local.issue("dev-user", { email: "dev@example.test" });
    expect((await local.verifier.verifyToken(token)).subject).toBe("dev-user");
    local.revoke("dev-user");
    await expect(local.verifier.verifyToken(token)).rejects.toThrow(/revoked/);
  });
});
