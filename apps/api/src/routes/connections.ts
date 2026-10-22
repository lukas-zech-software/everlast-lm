import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { GoogleAuth } from "google-auth-library";
import { AppError } from "@everlast/contracts";
import { consumeOAuthState, createDelegatedConnection, createOAuthState, listDelegatedConnections, revokeDelegatedConnection } from "@everlast/db";
import { readJson, sendJson, sendNoContent } from "../http.ts";
import type { Router } from "../router.ts";
import type { AppDeps } from "../app.ts";

/**
 * Delegated per-user Google access (D11, FR-SI-01 Subset B, NFR-SEC-02; specs/009 T016). The signed-in owner
 * grants read-only Drive access through OAuth consent; the refresh token goes straight into Secret Manager and only
 * an opaque reference is stored. The callback is bound to the initiating user by an HMAC-signed, expiring state.
 * Connection DTOs never expose secrets. No service-account credential ever substitutes for a user's grant.
 *
 * Security review 2026-10-23 (login CSRF / account-linking confusion): `authorize` is an authenticated request; it
 * sets an HttpOnly SameSite=Lax nonce cookie (Path=/oauth/google) and stores the nonce hash, user ID and PKCE
 * verifier server-side. The callback requires the signed state, the matching cookie of the same browser and a
 * single-use, unexpired server row for exactly the state's user; the PKCE verifier never leaves the server.
 * The SPA authenticates with bearer tokens (no session cookie exists), so the nonce cookie set on that user's
 * authenticated response is the browser binding.
 */

export interface DelegationBroker {
  /** Provider consent URL carrying the signed `state` and the PKCE S256 `code_challenge`. */
  authorizationUrl(state: string, codeChallenge: string): string;
  /** Exchanges the authorization code (with the PKCE verifier) and stores the refresh token; returns only a reference. */
  exchangeAndStore(userId: string, code: string, codeVerifier: string): Promise<{ secretRef: string; scopes: string[]; accountLabel: string | null }>;
}

const STATE_TTL_MS = 10 * 60 * 1000;

export function stateSigner(key: Buffer) {
  const sign = (payload: string) => createHmac("sha256", key).update(payload).digest("base64url");
  return {
    issue(userId: string, returnTo: string, nonceHash: string): string {
      const payload = Buffer.from(JSON.stringify({ u: userId, r: returnTo, e: Date.now() + STATE_TTL_MS, n: nonceHash })).toString("base64url");
      return `${payload}.${sign(payload)}`;
    },
    verify(state: string): { userId: string; returnTo: string; nonceHash: string } | null {
      const [payload, signature] = state.split(".");
      if (!payload || !signature) return null;
      const a = Buffer.from(sign(payload));
      const b = Buffer.from(signature);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      try {
        const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u: string; r: string; e: number; n: string };
        if (Date.now() > claims.e || typeof claims.n !== "string") return null;
        return { userId: claims.u, returnTo: claims.r, nonceHash: claims.n };
      } catch {
        return null;
      }
    },
  };
}

/** Only same-origin relative paths are accepted as post-consent destinations (no open redirect). */
export function safeReturnTo(value: unknown): string {
  return typeof value === "string" && /^\/(?!\/)[\w\-./?=&%]*$/.test(value) && value.length <= 512 ? value : "/";
}

export function registerConnectionRoutes(router: Router, deps: AppDeps): void {
  router.add("GET", "/api/connections", async ({ res, user }) => {
    const connections = await listDelegatedConnections(deps.pool, user.userId);
    sendJson(res, 200, {
      connections: connections.map((c) => ({ id: c.id, provider: c.provider, account_label: c.account_label, scopes: c.scopes, created_at: c.created_at })),
      authorization_available: Boolean(deps.delegationBroker),
    });
  });

  router.add("POST", "/api/connections/google/authorize", async ({ req, res, user }) => {
    if (!deps.delegationBroker) throw new AppError("RetryableFailure", 503, "Google Drive access is not configured");
    const body = (await readJson(req)) as { return_to?: unknown };
    const nonce = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const returnTo = safeReturnTo(body.return_to);
    await createOAuthState(deps.pool, { nonceHash: sha256(nonce), userId: user.userId, codeVerifier: verifier, returnTo, ttlSeconds: STATE_TTL_MS / 1000 });
    const state = deps.stateSigner!.issue(user.userId, returnTo, sha256(nonce));
    res.setHeader("Set-Cookie", nonceCookie(req, nonce, STATE_TTL_MS / 1000));
    sendJson(res, 200, { authorization_url: deps.delegationBroker.authorizationUrl(state, createHash("sha256").update(verifier).digest("base64url")) });
  });

  router.add("DELETE", "/api/connections/:connectionId", async ({ res, user, params }) => {
    if (!(await revokeDelegatedConnection(deps.pool, user.userId, params.connectionId!))) throw new AppError("NotFound", 404, "Connection not found");
    sendNoContent(res);
  });
}

const NONCE_COOKIE = "everlast_oauth_nonce";
const sha256 = (value: string) => createHash("sha256").update(value).digest("base64url");

function isSecure(req: IncomingMessage): boolean {
  return req.headers["x-forwarded-proto"] === "https" || Boolean((req.socket as { encrypted?: boolean }).encrypted) || Boolean(process.env.K_SERVICE);
}

export function nonceCookie(req: IncomingMessage, value: string, maxAgeSeconds: number): string {
  return `${NONCE_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/oauth/google; Max-Age=${maxAgeSeconds}${isSecure(req) ? "; Secure" : ""}`;
}

function readCookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

/**
 * Provider redirect target (handled before /api auth). Requires: valid signed state, the same browser's nonce
 * cookie matching the state, and a single-use unexpired server row for the state's user (consumed atomically).
 */
export async function handleOAuthCallback(deps: AppDeps, req: IncomingMessage, url: URL): Promise<{ location: string; clearCookie: string }> {
  if (!deps.delegationBroker || !deps.stateSigner) throw new AppError("NotFound", 404, "Not found");
  const invalid = () => new AppError("ValidationFailed", 400, "Invalid or expired authorization state");
  const claims = deps.stateSigner.verify(url.searchParams.get("state") ?? "");
  const code = url.searchParams.get("code");
  const cookieNonce = readCookie(req, NONCE_COOKIE);
  if (!claims || !code || !cookieNonce) throw invalid();
  const a = Buffer.from(sha256(cookieNonce));
  const b = Buffer.from(claims.nonceHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw invalid();
  const pending = await consumeOAuthState(deps.pool, claims.nonceHash, claims.userId);
  if (!pending) throw invalid();
  let stored;
  try {
    stored = await deps.delegationBroker.exchangeAndStore(claims.userId, code, pending.codeVerifier);
  } catch {
    throw new AppError("ValidationFailed", 400, "Google Drive access could not be granted");
  }
  await createDelegatedConnection(deps.pool, { userId: claims.userId, secretRef: stored.secretRef, scopes: stored.scopes, accountLabel: stored.accountLabel });
  return { location: pending.returnTo, clearCookie: nonceCookie(req, "", 0) };
}

/**
 * Production broker: Google OAuth 2.0 authorization-code flow (read-only Drive scope, offline access) and Secret
 * Manager storage of the refresh token (one secret per connection, keyless ADC). Configured only with an OAuth
 * client registered by the project owner.
 */
export class GoogleDelegationBroker implements DelegationBroker {
  private readonly auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  private readonly config: { clientId: string; clientSecret: () => Promise<string>; redirectUri: string; projectId: string };

  constructor(config: { clientId: string; clientSecret: () => Promise<string>; redirectUri: string; projectId: string }) {
    this.config = config;
  }

  authorizationUrl(state: string, codeChallenge: string): string {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "https://www.googleapis.com/auth/drive.readonly openid email");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  async exchangeAndStore(userId: string, code: string, codeVerifier: string) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: this.config.clientId, client_secret: await this.config.clientSecret(), redirect_uri: this.config.redirectUri, code_verifier: codeVerifier }),
    });
    if (!res.ok) throw new Error("token exchange failed");
    const token = (await res.json()) as { refresh_token?: string; scope?: string; id_token?: string };
    if (!token.refresh_token) throw new Error("no refresh token granted");
    const email = token.id_token ? (JSON.parse(Buffer.from(token.id_token.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string }).email ?? null : null;
    const client = await this.auth.getClient();
    const secretId = `delegated-google-${userId.slice(0, 8)}-${randomBytes(6).toString("hex")}`;
    await client.request({
      url: `https://secretmanager.googleapis.com/v1/projects/${this.config.projectId}/secrets?secretId=${secretId}`,
      method: "POST",
      data: { replication: { userManaged: { replicas: [{ location: "europe-west4" }] } }, labels: { purpose: "delegated-drive" } },
    });
    const version = await client.request<{ name: string }>({
      url: `https://secretmanager.googleapis.com/v1/projects/${this.config.projectId}/secrets/${secretId}:addVersion`,
      method: "POST",
      data: { payload: { data: Buffer.from(token.refresh_token, "utf8").toString("base64") } },
    });
    return { secretRef: version.data.name, scopes: (token.scope ?? "").split(" ").filter(Boolean), accountLabel: email };
  }
}
