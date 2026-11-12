import { ThinkingLevel } from "@google/genai";

/** D23, NFR-SEC-01: enterprise Gemini inference, token counting and caching. */
export type GeminiModelRole = "flash" | "flash-lite";

const EU_LOCATION = "eu";
const EU_BASE_URL = "https://aiplatform.eu.rep.googleapis.com";

const MODEL_PROFILES = {
  get flash() {
    return { model: "gemini-3.8-flash", thinkingLevel: ThinkingLevel.LOW } as const;
  },
  get "flash-lite"() {
    return { model: "gemini-3.5-flash-lite", thinkingLevel: ThinkingLevel.MINIMAL } as const;
  },
};

type GeminiModelProfile<Role extends GeminiModelRole> = (typeof MODEL_PROFILES)[Role];

export interface EnterpriseGeminiConfig<Role extends GeminiModelRole = GeminiModelRole> {
  clientOptions: {
    vertexai: true;
    project: string;
    location: typeof EU_LOCATION;
    httpOptions: { baseUrl: typeof EU_BASE_URL };
  };
  model: GeminiModelProfile<Role>["model"];
  thinkingConfig: { thinkingLevel: GeminiModelProfile<Role>["thinkingLevel"] };
}

/** Resolve an approved role without inheriting embedding regions or SDK endpoint overrides. */
export function resolveEnterpriseGeminiConfig<Role extends GeminiModelRole>(
  role: Role,
  env: NodeJS.ProcessEnv = process.env,
): EnterpriseGeminiConfig<Role> {
  const project = (env.VERTEX_PROJECT ?? env.GCP_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT)?.trim();
  if (!project) throw new Error("VERTEX_PROJECT (or GCP_PROJECT_ID) is required for enterprise Gemini");
  const location = env.GEMINI_LOCATION ?? EU_LOCATION;
  if (location !== EU_LOCATION) throw new Error("GEMINI_LOCATION must be eu under D23");

  const profile = MODEL_PROFILES[role];
  return {
    clientOptions: { vertexai: true, project, location, httpOptions: { baseUrl: EU_BASE_URL } },
    model: profile.model,
    thinkingConfig: { thinkingLevel: profile.thinkingLevel },
  };
}
