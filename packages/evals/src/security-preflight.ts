import { GoogleAuth } from "google-auth-library";

/**
 * NFR-SEC-01 enterprise endpoint preflight (CP-06). Verifies that model, embedding, judge and OCR calls are
 * configured for Google Cloud enterprise endpoints (Vertex AI / Document AI) with keyless ADC in the approved
 * region and that no consumer/developer API key is present in the runtime environment. No-training evidence is
 * reported separately from data-retention statements; zero data retention is never claimed.
 */

export type CheckStatus = "pass" | "fail" | "unavailable";

export interface PreflightCheck {
  id: string;
  description: string;
  status: CheckStatus;
  detail: string;
}

export interface EndpointEvidence {
  service: string;
  purpose: string;
  endpoint: string;
  region: string;
  authentication: string;
  no_training: { status: "contractual" | "not_applicable"; reference: string };
  retention: string;
}

export interface PreflightReport {
  passed: boolean;
  checks: PreflightCheck[];
  endpoints: EndpointEvidence[];
  verified_at: string;
}

export const DEVELOPER_KEY_VARIABLES = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_API_KEY"];
export const APPROVED_REGION = "europe-west4";

const NO_TRAINING_REFERENCE =
  "Google Cloud Service Specific Terms (Vertex AI / Generative AI on Vertex AI: customer data is not used to train foundation models without permission) and https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance";
const RETENTION_STATEMENT =
  "No-training is contractual; retention is separate: Vertex AI may cache inputs in-region for up to 24 h and abuse monitoring may log prompts unless an exception is approved. Zero data retention is NOT claimed.";

export interface PreflightInput {
  env: NodeJS.ProcessEnv;
  /** Vertex clients actually used by the run (inspected, not assumed). */
  clients: { name: string; purpose: string; vertexai: boolean; apiKey?: string | undefined; location?: string | undefined; project?: string | undefined }[];
  ocr: { name: string };
  /** Performs a live authenticated call to verify ADC (release mode). */
  live: boolean;
}

export async function runSecurityPreflight(input: PreflightInput): Promise<PreflightReport> {
  const checks: PreflightCheck[] = [];
  const presentKeys = DEVELOPER_KEY_VARIABLES.filter((name) => input.env[name]);
  checks.push({
    id: "SEC-01",
    description: "No consumer/developer API key in the runtime environment",
    status: presentKeys.length ? "fail" : "pass",
    detail: presentKeys.length ? `present: ${presentKeys.join(", ")}` : "none present",
  });
  for (const client of input.clients) {
    const ok = client.vertexai && !client.apiKey && client.location === APPROVED_REGION;
    checks.push({
      id: `SEC-VERTEX-${client.name}`,
      description: `${client.purpose} uses Vertex AI with ADC in ${APPROVED_REGION}`,
      status: ok ? "pass" : "fail",
      detail: `vertexai=${client.vertexai} apiKey=${client.apiKey ? "set" : "none"} location=${client.location ?? "unset"} project=${client.project ?? "unset"}`,
    });
  }
  const ocrMatch = /^documentai:([^:]+):/.exec(input.ocr.name);
  if (ocrMatch) {
    const exception = input.env.REGION_EXCEPTION_DOCUMENT_AI;
    const location = ocrMatch[1]!;
    // Region map (plan 002): Document AI has no europe-west4 location; its EU multi-region "eu" keeps processing
    // inside the EU as allowed by D3 ("EU preferred"). Any other location needs a recorded decision.
    const allowed = location === APPROVED_REGION || location === "eu";
    checks.push({
      id: "SEC-OCR",
      description: "OCR runs on Document AI (enterprise) in the EU region map or under a recorded region exception",
      status: allowed || exception ? "pass" : "fail",
      detail: allowed ? `location ${location} (EU region map, D3)` : exception ? `location ${location} under recorded decision ${exception}` : `location ${location} requires a recorded region-exception decision (Constitution VI)`,
    });
  } else {
    checks.push({ id: "SEC-OCR", description: "OCR processor configured", status: "unavailable", detail: "no Document AI processor configured: scanned pages cannot be OCR'd" });
  }
  if (input.live) {
    try {
      const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
      const token = await auth.getAccessToken();
      checks.push({ id: "SEC-ADC", description: "Keyless Application Default Credentials available", status: token ? "pass" : "fail", detail: token ? "access token obtained" : "no token" });
    } catch (err) {
      checks.push({ id: "SEC-ADC", description: "Keyless Application Default Credentials available", status: "unavailable", detail: (err as Error).message.split("\n")[0]! });
    }
  }
  const endpoints: EndpointEvidence[] = input.clients.map((c) => ({
    service: "Vertex AI (Gemini)",
    purpose: c.purpose,
    endpoint: `${c.location ?? "?"}-aiplatform.googleapis.com`,
    region: c.location ?? "unset",
    authentication: c.apiKey ? "API key (forbidden)" : "ADC / service account",
    no_training: { status: "contractual", reference: NO_TRAINING_REFERENCE },
    retention: RETENTION_STATEMENT,
  }));
  if (ocrMatch) {
    endpoints.push({
      service: "Document AI",
      purpose: "OCR for scanned PDF pages",
      endpoint: `${ocrMatch[1]}-documentai.googleapis.com`,
      region: ocrMatch[1]!,
      authentication: "ADC / service account",
      no_training: { status: "contractual", reference: "Google Cloud Service Specific Terms (Document AI)" },
      retention: "Document AI online processing does not persist documents beyond processing; zero data retention is NOT claimed.",
    });
  }
  return { passed: checks.every((c) => c.status === "pass"), checks, endpoints, verified_at: new Date().toISOString() };
}
