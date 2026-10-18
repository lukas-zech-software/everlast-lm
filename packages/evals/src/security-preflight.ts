/**
 * Enterprise No-Training Compliance and Scoping Preflight (NFR-SEC-01, NFR-EVAL-04).
 */

export interface SecurityConfig {
  region?: string;
  allowedRegions?: string[];
  geminiApiKey?: string;
  googleApiKey?: string;
}

export interface SecurityPreflightResult {
  valid: boolean;
  errors: string[];
  region: string;
  enterpriseNoTrainingEnforced: boolean;
}

export const DEFAULT_ALLOWED_REGIONS = ["europe-west4", "eu"];

/**
 * Validates enterprise no-training policy and forbidden consumer API keys (NFR-SEC-01).
 * Verifies that all endpoints reside in europe-west4 / eu.
 */
export function verifyEnterpriseNoTraining(
  config?: SecurityConfig
): SecurityPreflightResult {
  const errors: string[] = [];
  const region = config?.region ?? process.env.GOOGLE_CLOUD_REGION ?? "europe-west4";
  const allowed = config?.allowedRegions ?? DEFAULT_ALLOWED_REGIONS;

  // 1. Region validation
  if (!allowed.includes(region)) {
    errors.push(
      `Region '${region}' is not within authorized enterprise data residency zones (${allowed.join(
        ", "
      )}).`
    );
  }

  // 2. Strict prohibition of consumer / developer API keys
  const geminiKey = config?.geminiApiKey ?? process.env.GEMINI_API_KEY;
  const googleKey = config?.googleApiKey ?? process.env.GOOGLE_API_KEY;

  if (geminiKey) {
    errors.push(
      "Forbidden consumer API key detected: GEMINI_API_KEY. Enterprise workloads must use Vertex AI IAM keyless credentials."
    );
  }
  if (googleKey) {
    errors.push(
      "Forbidden consumer API key detected: GOOGLE_API_KEY. Enterprise workloads must use Vertex AI IAM keyless credentials."
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    region,
    enterpriseNoTrainingEnforced: errors.length === 0,
  };
}

export interface LeakageCheckResult {
  leakageDetected: boolean;
  leakedChunkCount: number;
  leakedChunkIds: string[];
}

/**
 * Validates that zero chunks from deselected or unauthorized sources leak into context (NFR-EVAL-04, C-02).
 */
export function assertNoScopingLeakage(
  retrievedChunks: Array<{ id: string; source_id: string }>,
  deselectedSourceIds: string[]
): LeakageCheckResult {
  const deselectedSet = new Set(deselectedSourceIds);
  const leakedIds: string[] = [];

  for (const chunk of retrievedChunks) {
    if (deselectedSet.has(chunk.source_id)) {
      leakedIds.push(chunk.id);
    }
  }

  return {
    leakageDetected: leakedIds.length > 0,
    leakedChunkCount: leakedIds.length,
    leakedChunkIds: leakedIds,
  };
}
