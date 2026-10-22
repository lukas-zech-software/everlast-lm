import { GoogleAuth } from "google-auth-library";

/**
 * Prompt-injection screening boundary for external content (FR-SI-01/05, NFR-SEC-01/02, Constitution VI).
 * Web, synced and delegated-import content is screened before indexing or model use; quarantined content never
 * becomes Ready or enters C-02. Any screening error or timeout fails closed.
 */

export interface ScreeningVerdict {
  verdict: "clean" | "quarantined";
  /** Stable filter name that matched (no content). */
  reason?: string | undefined;
}

export interface ContentScreener {
  readonly name: string;
  /** Screens every text block; throws on transport/provider errors (callers fail closed). */
  screen(texts: string[]): Promise<ScreeningVerdict>;
}

export class ScreeningUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreeningUnavailableError";
  }
}

// ---------------------------------------------------------------------------------------------------------
// Model Armor (regional, EU) — specs/009 T023
// ---------------------------------------------------------------------------------------------------------


const EU_LOCATIONS = /^europe-[a-z]+\d+$|^eu$/;

export interface ModelArmorConfig {
  projectId: string;
  location: string;
  templateId: string;
  /** Characters per sanitize request (content is split, never truncated). */
  maxCharsPerRequest?: number;
  timeoutMs?: number;
  concurrency?: number;
  /** Test seam for the regional REST transport. */
  request?: (req: { url: string; data: { userPromptData: { text: string } } }) => Promise<unknown>;
}

export function modelArmorConfigFromEnv(env: NodeJS.ProcessEnv): ModelArmorConfig | null {
  const templateId = env.MODEL_ARMOR_TEMPLATE_ID;
  const projectId = env.GCP_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT;
  if (!templateId || !projectId) return null;
  return { projectId, location: env.MODEL_ARMOR_LOCATION ?? env.GCP_REGION ?? "europe-west4", templateId };
}

interface SanitizeResponse {
  sanitizationResult?: { filterMatchState?: string };
}

/**
 * Model Armor `sanitizeUserPrompt` against a regional EU template (Constitution VI, D3). Any filter match quarantines
 * the whole source; transport errors and timeouts throw so the pipeline fails closed. Only EU locations are allowed.
 */
export class ModelArmorScreener implements ContentScreener {
  readonly name = "model-armor";
  private readonly config: ModelArmorConfig;
  private readonly auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

  constructor(config: ModelArmorConfig) {
    if (!EU_LOCATIONS.test(config.location)) throw new Error("Model Armor must run in an EU location (D3)");
    this.config = config;
  }

  private endpoint(): string {
    const { projectId, location, templateId } = this.config;
    return `https://modelarmor.${location}.rep.googleapis.com/v1/projects/${projectId}/locations/${location}/templates/${templateId}:sanitizeUserPrompt`;
  }

  private async call(text: string): Promise<SanitizeResponse> {
    const url = this.endpoint();
    const data = { userPromptData: { text } };
    const send = async () => {
      if (this.config.request) return (await this.config.request({ url, data })) as SanitizeResponse;
      const client = await this.auth.getClient();
      return (await client.request<SanitizeResponse>({ url, method: "POST", data })).data;
    };
    const timeout = this.config.timeoutMs ?? 15_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([send(), new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new ScreeningUnavailableError("Model Armor timed out")), timeout)))]);
    } finally {
      clearTimeout(timer);
    }
  }

  async screen(texts: string[]): Promise<ScreeningVerdict> {
    const max = this.config.maxCharsPerRequest ?? 50_000;
    const pieces: string[] = [];
    let current = "";
    for (const text of texts) {
      for (let i = 0; i < text.length; i += max) {
        const part = text.slice(i, i + max);
        if (current.length + part.length + 1 > max && current) {
          pieces.push(current);
          current = "";
        }
        current = current ? `${current}\n${part}` : part;
      }
    }
    if (current) pieces.push(current);
    const concurrency = Math.max(1, this.config.concurrency ?? 4);
    let next = 0;
    let quarantined = false;
    const workers = Array.from({ length: Math.min(concurrency, pieces.length) }, async () => {
      while (!quarantined && next < pieces.length) {
        const res = await this.call(pieces[next++]!);
        const state = res.sanitizationResult?.filterMatchState;
        if (state === "MATCH_FOUND") quarantined = true;
        else if (state !== "NO_MATCH_FOUND") throw new ScreeningUnavailableError("Unexpected Model Armor response");
      }
    });
    await Promise.all(workers);
    return quarantined ? { verdict: "quarantined", reason: "model_armor_match" } : { verdict: "clean" };
  }
}
