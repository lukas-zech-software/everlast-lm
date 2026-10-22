import { randomUUID } from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import type { ObjectStorage } from "@everlast/cloud";
import type { OfficeRenderer, OfficeRenderInput } from "./office.ts";

/**
 * Worker-side client of the everlast-render Cloud Run Job (C8, FR-SI-01 Subset B, D3; specs/009 T013/T014).
 * Starts one execution with RENDER_* environment overrides (object references and an operation ID only), polls the
 * long-running operation and reads the private output object. Keyless ADC; the job runs in the configured EU region.
 */

export interface RenderJobConfig {
  projectId: string;
  location: string;
  jobName: string;
  storage: ObjectStorage;
  pollMs?: number;
  timeoutMs?: number;
  /** Test seam for the Cloud Run Admin API transport. */
  request?: (options: { url: string; method: "GET" | "POST"; data?: unknown }) => Promise<unknown>;
}

interface Operation {
  name?: string;
  done?: boolean;
  error?: { code?: number; message?: string };
}

export class RenderJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderJobError";
  }
}

export function renderJobConfigFromEnv(env: NodeJS.ProcessEnv, storage: ObjectStorage): RenderJobConfig | null {
  const jobName = env.RENDER_JOB_NAME;
  const projectId = env.GCP_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT;
  if (!jobName || !projectId) return null;
  return { projectId, location: env.RENDER_JOB_LOCATION ?? env.GCP_REGION ?? "europe-west4", jobName, storage };
}

export class CloudRunJobRenderer implements OfficeRenderer {
  readonly name = "everlast-render";
  private readonly config: RenderJobConfig;
  private readonly auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

  constructor(config: RenderJobConfig) {
    this.config = config;
  }

  private async call(url: string, method: "GET" | "POST", data?: unknown): Promise<unknown> {
    if (this.config.request) return this.config.request({ url, method, ...(data !== undefined ? { data } : {}) });
    const client = await this.auth.getClient();
    const res = await client.request({ url, method, ...(data !== undefined ? { data } : {}) });
    return res.data;
  }

  /** Runs one conversion: `office-to-pdf` or `audio-to-flac`, returning the output object's bytes. */
  async run(command: "office-to-pdf" | "audio-to-flac", input: { name: string; generation: string }, format: string | null): Promise<Buffer> {
    const operationId = randomUUID();
    const dir = /^(notebooks\/[^/]+\/sources\/[^/]+)\//.exec(input.name)?.[1];
    if (!dir) throw new RenderJobError("Render input is not a source object");
    const outputObject = `${dir}/normalized/${operationId}.${command === "office-to-pdf" ? "pdf" : "flac"}`;
    const { projectId, location, jobName } = this.config;
    const env = [
      { name: "RENDER_COMMAND", value: command },
      { name: "RENDER_INPUT_OBJECT", value: input.name },
      { name: "RENDER_INPUT_GENERATION", value: input.generation },
      { name: "RENDER_OUTPUT_OBJECT", value: outputObject },
      { name: "RENDER_OPERATION_ID", value: operationId },
      ...(format ? [{ name: "RENDER_INPUT_FORMAT", value: format }] : []),
    ];
    let op = (await this.call(`https://run.googleapis.com/v2/projects/${projectId}/locations/${location}/jobs/${jobName}:run`, "POST", {
      overrides: { containerOverrides: [{ env }], taskCount: 1 },
    })) as Operation;
    const deadline = Date.now() + (this.config.timeoutMs ?? 600_000);
    while (!op.done) {
      if (Date.now() > deadline || !op.name) throw new RenderJobError("Render job did not finish in time");
      await new Promise((r) => setTimeout(r, this.config.pollMs ?? 2000));
      op = (await this.call(`https://run.googleapis.com/v2/${op.name}`, "GET")) as Operation;
    }
    if (op.error) throw new RenderJobError("Render job failed");
    const meta = await this.config.storage.stat(outputObject);
    if (!meta) throw new RenderJobError("Render job produced no output");
    return this.config.storage.read(outputObject, meta.generation);
  }

  async convertToPdf(input: OfficeRenderInput): Promise<Buffer> {
    if (!input.object) throw new RenderJobError("The render job requires a stored input object");
    return this.run("office-to-pdf", input.object, input.format);
  }
}
