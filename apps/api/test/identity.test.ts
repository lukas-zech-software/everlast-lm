import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  verifyBearerToken,
  resolveOwnerContext,
  AuthenticationError,
  type TokenVerifierConfig,
  type VerifiedIdentity,
} from "../src/auth/identity.js";

describe("FR-WM-04 / NFR-SEC-01: Identity Platform Authentication Adapter", () => {
  const config: TokenVerifierConfig = {
    projectId: "everlast-test-project",
    issuer: "https://securetoken.google.com/everlast-test-project",
  };

  const createMockJwt = (payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256" }) => {
    const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    return `${b64(header)}.${b64(payload)}.mock-signature`;
  };

  const validPayload = {
    aud: "everlast-test-project",
    iss: "https://securetoken.google.com/everlast-test-project",
    sub: "usr_google_sub_12345",
    email: "user@example.com",
    auth_time: Math.floor(Date.now() / 1000) - 60,
    iat: Math.floor(Date.now() / 1000) - 60,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  it("AUTH-01: rejects missing Authorization header", async () => {
    await expect(verifyBearerToken(undefined, config)).rejects.toThrow(
      AuthenticationError
    );
    await expect(verifyBearerToken(undefined, config)).rejects.toThrow(
      /missing/i
    );
  });

  it("AUTH-02: rejects malformed Authorization header", async () => {
    await expect(verifyBearerToken("Basic 12345", config)).rejects.toThrow(
      AuthenticationError
    );
    await expect(verifyBearerToken("Bearer", config)).rejects.toThrow(
      /malformed|format/i
    );
    await expect(verifyBearerToken("NotBearer token", config)).rejects.toThrow(
      /malformed|format/i
    );
  });

  it("AUTH-03: rejects expired token", async () => {
    const expiredToken = createMockJwt({
      ...validPayload,
      exp: Math.floor(Date.now() / 1000) - 100, // expired in past
    });

    await expect(
      verifyBearerToken(`Bearer ${expiredToken}`, config)
    ).rejects.toThrow(/expired/i);
  });

  it("AUTH-04: rejects revoked token", async () => {
    // Revocation threshold set after auth_time
    const revokedConfig: TokenVerifierConfig = {
      ...config,
      revocationCheck: {
        isRevoked: (sub: string, authTime: number) => true,
      },
    };

    const token = createMockJwt(validPayload);
    await expect(
      verifyBearerToken(`Bearer ${token}`, revokedConfig)
    ).rejects.toThrow(/revoked/i);
  });

  it("AUTH-05: rejects token from wrong Google Cloud project or audience", async () => {
    const wrongAudienceToken = createMockJwt({
      ...validPayload,
      aud: "wrong-foreign-project",
    });

    await expect(
      verifyBearerToken(`Bearer ${wrongAudienceToken}`, config)
    ).rejects.toThrow(/project|audience/i);
  });

  it("AUTH-06: rejects forged client-supplied owner ID in body/params; derives strictly from token sub", () => {
    const verified: VerifiedIdentity = {
      subject: "usr_verified_sub_abc",
      email: "user@example.com",
      projectId: "everlast-test-project",
    };

    const forgedBody = {
      owner_id: "forged_victim_user_999",
      title: "Hacked Notebook",
    };

    const ownerContext = resolveOwnerContext(verified, forgedBody);
    expect(ownerContext.ownerId).toBe("usr_verified_sub_abc");
    expect(ownerContext.ownerId).not.toBe("forged_victim_user_999");
  });

  it("AUTH-07: provides stable deterministic subject mapping rather than mutable email", () => {
    const identity1: VerifiedIdentity = {
      subject: "usr_stable_sub_456",
      email: "old.email@example.com",
      projectId: "everlast-test-project",
    };
    const identity2: VerifiedIdentity = {
      subject: "usr_stable_sub_456",
      email: "new.email@example.com",
      projectId: "everlast-test-project",
    };

    const ctx1 = resolveOwnerContext(identity1);
    const ctx2 = resolveOwnerContext(identity2);
    expect(ctx1.ownerId).toBe(ctx2.ownerId);
    expect(ctx1.ownerId).toBe("usr_stable_sub_456");
  });

  it("AUTH-08: production rejection of fixture/mock bypass identities", async () => {
    const prodConfig: TokenVerifierConfig = {
      ...config,
      isProduction: true,
    };

    // Fixture identity token should be rejected in production
    const fixtureToken = createMockJwt({
      ...validPayload,
      sub: "usr_subject_alpha_isolated", // test fixture subject
      isFixtureMock: true,
    });

    await expect(
      verifyBearerToken(`Bearer ${fixtureToken}`, prodConfig)
    ).rejects.toThrow(/production rejection of fixture identities|invalid token/i);
  });
});
