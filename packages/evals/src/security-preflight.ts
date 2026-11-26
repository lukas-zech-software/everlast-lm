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
const REGIONAL_ENDPOINT = "https://europe-west4-aiplatform.googleapis.com";
const GEMINI_ENDPOINT = "https://aiplatform.eu.rep.googleapis.com";

const NO_TRAINING_REFERENCE =
  "Google Cloud Service Specific Terms (Vertex AI / Generative AI on Vertex AI: customer data is not used to train foundation models without permission) and https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance";
const RETENTION_STATEMENT =
  "No-training is contractual; retention is separate: Vertex AI may cache inputs in-region for up to 24 h and abuse monitoring may log prompts unless an exception is approved. Zero data retention is NOT claimed.";

export interface PreflightInput {
  env: NodeJS.ProcessEnv;
  /** Vertex clients actually used by the run (inspected, not assumed). */
  clients: Array<{
    name: string;
    purpose: string;
    vertexai: boolean;
    apiKey?: string | undefined;
    location?: string | undefined;
    project?: string | undefined;
    route: "gemini" | "regional";
    endpoint: string;
  }>;
  ocr: { name: string };
  /** Performs a live authenticated call to verify ADC (release mode). */
  live: boolean;
}

function buildVertexClientCheck(client: PreflightInput["clients"][number]): PreflightCheck {
  const isGemini = client.route === "gemini";
  const region = isGemini ? "eu" : APPROVED_REGION;
  const requiredEndpoint = isGemini ? GEMINI_ENDPOINT : REGIONAL_ENDPOINT;
  const endpoint = client.endpoint.replace(/\/$/, "");
  const ok =
    client.vertexai &&
    !client.apiKey &&
    client.location === region &&
    endpoint === requiredEndpoint;
  return {
    id: `SEC-VERTEX-${client.name}`,
    description: `${client.purpose} uses Vertex AI with ADC in ${region} at ${requiredEndpoint}`,
    status: ok ? "pass" : "fail",
    detail: `vertexai=${client.vertexai} apiKey=${client.apiKey ? "set" : "none"} location=${client.location ?? "unset"} project=${client.project ?? "unset"} endpoint=${endpoint}`,
  };
}

function buildOcrDetail(location: string, allowed: boolean, exception: string | undefined): string {
  if (allowed) {
    return `location ${location} (EU region map, D3)`;
  }
  if (exception) {
    return `location ${location} under recorded decision ${exception}`;
  }
  return `location ${location} requires a recorded region-exception decision (Constitution VI)`;
}

function buildOcrCheckAndEndpoint(
  ocrName: string,
  env: NodeJS.ProcessEnv,
): { check: PreflightCheck; endpoint: EndpointEvidence | null } {
  const ocrLocation = /^documentai:([^:]+):/.exec(ocrName)?.[1];
  if (!ocrLocation) {
    return {
      check: {
        id: "SEC-OCR",
        description: "OCR processor configured",
        status: "unavailable",
        detail: "no Document AI processor configured: scanned pages cannot be OCR'd",
      },
      endpoint: null,
    };
  }
  const exception = env.REGION_EXCEPTION_DOCUMENT_AI;
  // Region map (plan 002): Document AI has no europe-west4 location; its EU multi-region "eu" keeps processing
  // inside the EU as allowed by D3 ("EU preferred"). Any other location needs a recorded decision.
  const allowed = ocrLocation === APPROVED_REGION || ocrLocation === "eu";
  return {
    check: {
      id: "SEC-OCR",
      description:
        "OCR runs on Document AI (enterprise) in the EU region map or under a recorded region exception",
      status: allowed || exception ? "pass" : "fail",
      detail: buildOcrDetail(ocrLocation, allowed, exception),
    },
    endpoint: {
      service: "Document AI",
      purpose: "OCR for scanned PDF pages",
      endpoint: `${ocrLocation}-documentai.googleapis.com`,
      region: ocrLocation,
      authentication: "ADC / service account",
      no_training: {
        status: "contractual",
        reference: "Google Cloud Service Specific Terms (Document AI)",
      },
      retention:
        "Document AI online processing does not persist documents beyond processing; zero data retention is NOT claimed.",
    },
  };
}

async function checkLiveAdc(): Promise<PreflightCheck> {
  try {
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    const token = await auth.getAccessToken();
    return {
      id: "SEC-ADC",
      description: "Keyless Application Default Credentials available",
      status: token ? "pass" : "fail",
      detail: token ? "access token obtained" : "no token",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: "SEC-ADC",
      description: "Keyless Application Default Credentials available",
      status: "unavailable",
      detail: message.split("\n")[0] ?? message,
    };
  }
}

export async function runSecurityPreflight(input: PreflightInput): Promise<PreflightReport> {
  const presentKeys = DEVELOPER_KEY_VARIABLES.filter((name) => input.env[name]);
  const checks: PreflightCheck[] = [
    {
      id: "SEC-01",
      description: "No consumer/developer API key in the runtime environment",
      status: presentKeys.length ? "fail" : "pass",
      detail: presentKeys.length ? `present: ${presentKeys.join(", ")}` : "none present",
    },
    ...input.clients.map(buildVertexClientCheck),
  ];
  const ocr = buildOcrCheckAndEndpoint(input.ocr.name, input.env);
  checks.push(ocr.check);
  if (input.live) {
    checks.push(await checkLiveAdc());
  }
  const endpoints: EndpointEvidence[] = input.clients.map((c) => ({
    service: c.route === "gemini" ? "Vertex AI (Gemini)" : "Vertex AI (regional)",
    purpose: c.purpose,
    endpoint: c.endpoint.replace(/^https:\/\//, "").replace(/\/$/, ""),
    region: c.location ?? "unset",
    authentication: c.apiKey ? "API key (forbidden)" : "ADC / service account",
    no_training: { status: "contractual", reference: NO_TRAINING_REFERENCE },
    retention: RETENTION_STATEMENT,
  }));
  if (ocr.endpoint) {
    endpoints.push(ocr.endpoint);
  }
  return {
    passed: checks.every((c) => c.status === "pass"),
    checks,
    endpoints,
    verified_at: new Date().toISOString(),
  };
}
