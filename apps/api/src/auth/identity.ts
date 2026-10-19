import { createPublicKey, generateKeyPairSync, createSign, createVerify, randomUUID, type KeyObject } from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import { AppError } from "@everlast/contracts";

/**
 * Identity Platform ID-token verification (FR-WM-04, NFR-SEC-01, D6).
 *
 * Every token is verified cryptographically (RS256 only, key selected by `kid`), then `aud`, `iss`, `exp`,
 * `iat`, `auth_time` and `sub` are checked, then an optional revocation checker runs. The verified
 * (issuer, subject) pair is the only ownership authority; no client-supplied identity is ever trusted.
 */

export class AuthenticationError extends AppError {
  readonly statusCode = 401;

  constructor(message: string) {
    super("Unauthenticated", 401, message);
    this.name = "AuthenticationError";
  }
}

export interface VerifiedIdentity {
  issuer: string;
  subject: string;
  email?: string | undefined;
  authTime: number;
}

/** Supplies verification keys by `kid`. */
export interface KeySource {
  getKey(kid: string): Promise<KeyObject | undefined>;
}

export interface RevocationChecker {
  /** True when tokens issued at `authTime` (seconds) for `subject` must no longer be accepted. */
  isRevoked(subject: string, authTime: number): Promise<boolean>;
}

export interface TokenVerifierOptions {
  audience: string;
  issuer: string;
  keys: KeySource;
  revocation?: RevocationChecker | undefined;
  /** Identity Platform tenant, when multi-tenancy is configured. */
  tenantId?: string | undefined;
  clockSkewSeconds?: number;
  now?: () => number;
}

const SECURE_TOKEN_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

/** Google-published Identity Platform signing certificates, cached per the response `max-age`. */
export class GoogleSecureTokenKeys implements KeySource {
  private cache: { keys: Map<string, KeyObject>; expiresAt: number } | null = null;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { url?: string; fetchImpl?: typeof fetch } = {}) {
    this.url = options.url ?? SECURE_TOKEN_CERTS_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getKey(kid: string): Promise<KeyObject | undefined> {
    if (!this.cache || Date.now() >= this.cache.expiresAt || !this.cache.keys.has(kid)) {
      await this.refresh();
    }
    return this.cache?.keys.get(kid);
  }

  private async refresh(): Promise<void> {
    const response = await this.fetchImpl(this.url);
    if (!response.ok) throw new AuthenticationError("Unable to load token signing keys");
    const certs = (await response.json()) as Record<string, string>;
    const maxAge = /max-age=(\d+)/.exec(response.headers.get("cache-control") ?? "")?.[1];
    const keys = new Map<string, KeyObject>();
    for (const [kid, pem] of Object.entries(certs)) keys.set(kid, createPublicKey(pem));
    this.cache = { keys, expiresAt: Date.now() + Number(maxAge ?? 3600) * 1000 };
  }
}

export class StaticKeys implements KeySource {
  private readonly keys: Map<string, KeyObject>;

  constructor(keys: Record<string, KeyObject | string>) {
    this.keys = new Map(
      Object.entries(keys).map(([kid, key]) => [kid, typeof key === "string" ? createPublicKey(key) : key])
    );
  }

  async getKey(kid: string): Promise<KeyObject | undefined> {
    return this.keys.get(kid);
  }
}

/**
 * Revocation via the Identity Toolkit `accounts:lookup` API using keyless Application Default Credentials.
 * A token is revoked when its `auth_time` predates the account's `validSince` or the account is disabled.
 */
export class IdentityToolkitRevocationChecker implements RevocationChecker {
  private readonly auth: GoogleAuth;
  private readonly cache = new Map<string, { revokedBefore: number; disabled: boolean; expiresAt: number }>();
  private readonly projectId: string;
  private readonly cacheSeconds: number;

  constructor(options: { projectId: string; cacheSeconds?: number }) {
    this.projectId = options.projectId;
    this.cacheSeconds = options.cacheSeconds ?? 30;
    this.auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  }

  async isRevoked(subject: string, authTime: number): Promise<boolean> {
    let entry = this.cache.get(subject);
    if (!entry || Date.now() >= entry.expiresAt) {
      const client = await this.auth.getClient();
      const response = await client.request<{ users?: { validSince?: string; disabled?: boolean }[] }>({
        url: `https://identitytoolkit.googleapis.com/v1/projects/${this.projectId}/accounts:lookup`,
        method: "POST",
        data: { localId: [subject] },
      });
      const user = response.data.users?.[0];
      entry = {
        revokedBefore: user ? Number(user.validSince ?? 0) : Number.POSITIVE_INFINITY,
        disabled: user?.disabled === true,
        expiresAt: Date.now() + this.cacheSeconds * 1000,
      };
      this.cache.set(subject, entry);
    }
    return entry.disabled || authTime < entry.revokedBefore;
  }
}

function decodeSegment(segment: string, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new AuthenticationError(`Malformed token ${label}`);
  }
}

export class TokenVerifier {
  private readonly options: TokenVerifierOptions;

  constructor(options: TokenVerifierOptions) {
    this.options = options;
  }

  get issuer(): string {
    return this.options.issuer;
  }

  async verifyAuthorizationHeader(header: string | undefined): Promise<VerifiedIdentity> {
    if (!header) throw new AuthenticationError("Missing Authorization header");
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)$/.exec(header.trim());
    if (!match) throw new AuthenticationError("Malformed Authorization header. Expected 'Bearer <token>'");
    return this.verifyToken(match[1]!);
  }

  async verifyToken(token: string): Promise<VerifiedIdentity> {
    const [headerB64, payloadB64, signatureB64] = token.split(".");
    if (!headerB64 || !payloadB64) throw new AuthenticationError("Malformed token");
    const header = decodeSegment(headerB64, "header");
    if (header.alg !== "RS256") throw new AuthenticationError("Unsupported token algorithm");
    if (!signatureB64) throw new AuthenticationError("Token is not signed");
    if (typeof header.kid !== "string" || header.kid.length === 0) throw new AuthenticationError("Token has no key id");

    const key = await this.options.keys.getKey(header.kid);
    if (!key) throw new AuthenticationError("Unknown token signing key");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${headerB64}.${payloadB64}`);
    if (!verifier.verify(key, Buffer.from(signatureB64, "base64url"))) {
      throw new AuthenticationError("Invalid token signature");
    }

    const claims = decodeSegment(payloadB64, "payload");
    const now = Math.floor((this.options.now ?? Date.now)() / 1000);
    const skew = this.options.clockSkewSeconds ?? 60;
    const num = (name: string): number => {
      const value = claims[name];
      if (typeof value !== "number" || !Number.isFinite(value)) throw new AuthenticationError(`Token missing ${name}`);
      return value;
    };
    if (num("exp") <= now - skew) throw new AuthenticationError("Token has expired");
    if (num("iat") > now + skew) throw new AuthenticationError("Token issued in the future");
    const authTime = typeof claims.auth_time === "number" ? claims.auth_time : num("iat");
    if (authTime > now + skew) throw new AuthenticationError("Token auth_time is in the future");
    if (claims.aud !== this.options.audience) throw new AuthenticationError("Invalid token audience");
    if (claims.iss !== this.options.issuer) throw new AuthenticationError("Invalid token issuer");
    const subject = claims.sub;
    if (typeof subject !== "string" || subject.length === 0 || subject.length > 128) {
      throw new AuthenticationError("Invalid token subject");
    }
    if (this.options.tenantId) {
      const firebase = claims.firebase as { tenant?: unknown } | undefined;
      if (firebase?.tenant !== this.options.tenantId) throw new AuthenticationError("Invalid token tenant");
    }
    if (this.options.revocation && (await this.options.revocation.isRevoked(subject, authTime))) {
      throw new AuthenticationError("Token has been revoked");
    }
    return {
      issuer: this.options.issuer,
      subject,
      email: typeof claims.email === "string" ? claims.email : undefined,
      authTime,
    };
  }
}

export function createIdentityPlatformVerifier(options: {
  projectId: string;
  tenantId?: string | undefined;
  checkRevocation?: boolean;
}): TokenVerifier {
  return new TokenVerifier({
    audience: options.projectId,
    issuer: `https://securetoken.google.com/${options.projectId}`,
    keys: new GoogleSecureTokenKeys(),
    tenantId: options.tenantId,
    revocation:
      options.checkRevocation === false ? undefined : new IdentityToolkitRevocationChecker({ projectId: options.projectId }),
  });
}

export const LOCAL_ISSUER = "https://local.everlast.invalid";
export const LOCAL_AUDIENCE = "everlast-local";

export function assertLocalAuthAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === "production" || env.K_SERVICE) {
    throw new Error("Local authentication is forbidden in production and on Cloud Run (NFR-SEC-01)");
  }
}

/**
 * Development/test identity issuer. Uses a per-process RSA key so local tokens still pass the same
 * signature verification path; refuses to start in production or on Cloud Run.
 */
export class LocalIdentityIssuer {
  private readonly privateKey: KeyObject;
  private readonly kid = `local-${randomUUID()}`;
  readonly verifier: TokenVerifier;
  private revokedBefore = new Map<string, number>();

  constructor(env: NodeJS.ProcessEnv = process.env) {
    assertLocalAuthAllowed(env);
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    this.privateKey = privateKey;
    this.verifier = new TokenVerifier({
      audience: LOCAL_AUDIENCE,
      issuer: LOCAL_ISSUER,
      keys: new StaticKeys({ [this.kid]: publicKey }),
      revocation: { isRevoked: async (subject, authTime) => authTime < (this.revokedBefore.get(subject) ?? 0) },
    });
  }

  issue(subject: string, options: { email?: string; ttlSeconds?: number; authTime?: number } = {}): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", kid: this.kid, typ: "JWT" };
    const payload = {
      iss: LOCAL_ISSUER,
      aud: LOCAL_AUDIENCE,
      sub: subject,
      iat: now,
      auth_time: options.authTime ?? now,
      exp: now + (options.ttlSeconds ?? 3600),
      ...(options.email ? { email: options.email } : {}),
    };
    const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const signingInput = `${b64(header)}.${b64(payload)}`;
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    return `${signingInput}.${signer.sign(this.privateKey).toString("base64url")}`;
  }

  /** Revokes every token for `subject` issued at or before now. */
  revoke(subject: string): void {
    this.revokedBefore.set(subject, Math.floor(Date.now() / 1000) + 1);
  }
}
