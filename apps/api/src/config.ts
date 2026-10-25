import { parseSourceLimitsConfig } from "@everlast/contracts";

/**
 * API runtime configuration (FR-WM-07, NFR-SEC-01, D3, D6). Invalid configuration fails startup.
 * No secret is read from source; deployment inputs come from the environment / Secret Manager mounts.
 */

export type AuthMode = "identity-platform" | "local";

export interface IdentityPlatformClientConfig {
  apiKey: string;
  authDomain: string;
  providerId: string;
  tenantId?: string | undefined;
}

export interface ApiConfig {
  port: number;
  authMode: AuthMode;
  projectId: string;
  sourceLimit: number;
  webDistDir?: string | undefined;
  identityPlatform?: IdentityPlatformClientConfig | undefined;
  checkRevocation: boolean;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const authMode = (env.AUTH_MODE ?? "identity-platform") as AuthMode;
  if (authMode !== "identity-platform" && authMode !== "local") {
    throw new Error(`AUTH_MODE must be identity-platform or local, got ${authMode}`);
  }
  const rawLimit = env.MAX_SOURCES_PER_NOTEBOOK ?? env.QUOTA_MAX_SOURCES_PER_NOTEBOOK;
  const limits = parseSourceLimitsConfig(
    rawLimit === undefined ? {} : { maxSourcesPerNotebook: Number(rawLimit) }
  );
  const projectId = env.IDENTITY_PLATFORM_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT ?? env.GCP_PROJECT_ID ?? "";
  if (authMode === "identity-platform" && !projectId) {
    throw new Error("GOOGLE_CLOUD_PROJECT is required when AUTH_MODE=identity-platform");
  }
  const identityPlatform =
    authMode === "identity-platform" && env.IDENTITY_PLATFORM_API_KEY
      ? {
          apiKey: env.IDENTITY_PLATFORM_API_KEY,
          authDomain: env.IDENTITY_PLATFORM_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`,
          providerId: env.IDENTITY_PLATFORM_PROVIDER_ID ?? "oidc.corporate",
          tenantId: env.IDENTITY_PLATFORM_TENANT_ID,
        }
      : undefined;
  return {
    port: Number(env.PORT ?? 8080),
    authMode,
    projectId,
    sourceLimit: limits.maxSourcesPerNotebook,
    webDistDir: env.WEB_DIST_DIR,
    identityPlatform,
    checkRevocation: env.IDENTITY_CHECK_REVOCATION !== "false",
  };
}

/**
 * FR-GC-08 managed Code Execution sandbox (specs/010, D18/D19/D20). Off unless CODE_EXECUTION_ENABLED=true; then the
 * owner-created parent runtime must be in europe-west4 (D3) or startup fails. No credential is configured here:
 * the API calls the provider with its keyless runtime identity (ADC).
 */
export interface CodeExecutionConfig {
  reasoningEngine: string;
  location: string;
}

export function loadCodeExecutionConfig(env: NodeJS.ProcessEnv = process.env): CodeExecutionConfig | undefined {
  if (env.CODE_EXECUTION_ENABLED !== "true") return undefined;
  const reasoningEngine = env.CODE_EXECUTION_REASONING_ENGINE ?? "";
  const location = env.CODE_EXECUTION_LOCATION ?? "europe-west4";
  const match = /^projects\/[a-z0-9-]+\/locations\/([a-z0-9-]+)\/reasoningEngines\/\d+$/.exec(reasoningEngine);
  if (!match) throw new Error("CODE_EXECUTION_REASONING_ENGINE must be projects/<p>/locations/<region>/reasoningEngines/<id>");
  if (location !== "europe-west4" || match[1] !== location) {
    throw new Error("Code execution must run in europe-west4 (D3); no region exception is approved");
  }
  return { reasoningEngine, location };
}
