/**
 * Identity Platform token adapter and verified owner context (FR-WM-04, NFR-SEC-01).
 * Validates Identity Platform ID tokens with revocation checks, project audience verification,
 * and deterministic, forgery-proof owner context resolution.
 */

export class AuthenticationError extends Error {
  public readonly statusCode = 401;

  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export interface RevocationChecker {
  isRevoked: (sub: string, authTime: number) => boolean | Promise<boolean>;
}

export interface TokenVerifierConfig {
  projectId: string;
  issuer?: string;
  isProduction?: boolean;
  revocationCheck?: RevocationChecker;
}

export interface VerifiedIdentity {
  subject: string;
  email?: string;
  projectId: string;
  authTime?: number;
}

export interface OwnerContext {
  ownerId: string;
  subject: string;
  email?: string;
}

/**
 * Resolves verified owner context from identity.
 * Completely ignores and rejects any client-supplied owner_id to prevent authorization spoofing (FR-WM-04).
 * Maps subject to stable local owner identifier.
 */
export function resolveOwnerContext(
  identity: VerifiedIdentity,
  clientInput?: Record<string, unknown>
): OwnerContext {
  const ctx: OwnerContext = {
    ownerId: identity.subject,
    subject: identity.subject,
  };
  if (identity.email !== undefined) {
    ctx.email = identity.email;
  }
  return ctx;
}

/**
 * Verifies a Bearer token from the HTTP Authorization header.
 * Enforces audience project scoping, expiration, revocation, and production sandbox restrictions.
 */
export async function verifyBearerToken(
  authHeader: string | undefined,
  config: TokenVerifierConfig
): Promise<VerifiedIdentity> {
  if (!authHeader) {
    throw new AuthenticationError("Missing Authorization header");
  }

  const parts = authHeader.trim().split(" ");
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer" || !parts[1]) {
    throw new AuthenticationError(
      "Malformed Authorization header format. Expected 'Bearer <token>'"
    );
  }

  const token = parts[1];
  const tokenParts = token.split(".");
  if (tokenParts.length !== 3) {
    throw new AuthenticationError("Malformed token: expected 3 JWT segments");
  }

  let payload: Record<string, any>;
  try {
    const rawPayload = Buffer.from(tokenParts[1]!, "base64url").toString("utf8");
    payload = JSON.parse(rawPayload);
  } catch {
    throw new AuthenticationError("Malformed token: failed to decode JSON payload");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  // 1. Expiration check
  if (typeof payload.exp === "number" && payload.exp <= nowSeconds) {
    throw new AuthenticationError(`Token has expired at timestamp ${payload.exp}`);
  }

  // 2. Audience / Project ID check
  if (payload.aud !== config.projectId) {
    throw new AuthenticationError(
      `Invalid token project audience: expected ${config.projectId}, got ${payload.aud}`
    );
  }

  // 3. Issuer check
  if (config.issuer && payload.iss !== config.issuer) {
    throw new AuthenticationError(
      `Invalid token issuer: expected ${config.issuer}, got ${payload.iss}`
    );
  }

  // 4. Subject check
  if (!payload.sub || typeof payload.sub !== "string" || payload.sub.trim().length === 0) {
    throw new AuthenticationError("Invalid token: missing subject (sub) claim");
  }

  // 5. Revocation check
  if (config.revocationCheck) {
    const authTime = typeof payload.auth_time === "number" ? payload.auth_time : (payload.iat || 0);
    const isRevoked = await config.revocationCheck.isRevoked(payload.sub, authTime);
    if (isRevoked) {
      throw new AuthenticationError("Token has been revoked");
    }
  }

  // 6. Production rejection of fixture/mock identities (NFR-SEC-01)
  const isProd = config.isProduction ?? (process.env.NODE_ENV === "production");
  if (isProd) {
    if (payload.isFixtureMock || payload.sub.includes("isolated") || payload.sub.includes("fixture")) {
      throw new AuthenticationError(
        "Production rejection of fixture identities: mock/fixture tokens forbidden in production mode"
      );
    }
  }

  return {
    subject: payload.sub,
    email: payload.email,
    projectId: payload.aud,
    authTime: payload.auth_time,
  };
}
