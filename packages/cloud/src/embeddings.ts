import { createHash } from "node:crypto";
import { GoogleGenAI } from "@google/genai";

/**
 * Embedding boundary (D1, NFR-SEC-01). Production uses the Gemini embedding model on Vertex AI
 * (enterprise endpoint, no training on customer data) in the configured EU region with 768 dimensions.
 */

export const EMBEDDING_DIMENSIONS = 768;

export type EmbeddingTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export interface Embedder {
  /** Pinned model identifier stored with every revision so re-embedding is a planned job. */
  readonly model: string;
  embed(texts: string[], task: EmbeddingTask): Promise<number[][]>;
}

export interface VertexConfig {
  project: string;
  location: string;
}

export function vertexConfigFromEnv(env: NodeJS.ProcessEnv = process.env): VertexConfig {
  const project = env.VERTEX_PROJECT ?? env.GCP_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT;
  if (!project) throw new Error("VERTEX_PROJECT (or GCP_PROJECT_ID) is required for Vertex AI");
  return { project, location: env.VERTEX_LOCATION ?? env.VERTEX_AI_LOCATION ?? "europe-west4" };
}

/**
 * Creates a Vertex AI client. The constructor refuses developer API keys: company data may only reach the
 * enterprise endpoint (Constitution VI, NFR-SEC-01). Authentication is keyless via ADC.
 */
export function createVertexClient(config: VertexConfig): GoogleGenAI {
  return new GoogleGenAI({ vertexai: true, project: config.project, location: config.location });
}

export class VertexEmbedder implements Embedder {
  readonly model: string;
  private readonly client: GoogleGenAI;
  private readonly batchSize: number;

  constructor(options: { client: GoogleGenAI; model?: string | undefined; batchSize?: number }) {
    this.client = options.client;
    this.model = options.model ?? "gemini-embedding-001";
    this.batchSize = options.batchSize ?? 1;
  }

  async embed(texts: string[], task: EmbeddingTask): Promise<number[][]> {
    const out: number[][] = [];
    const concurrency = 8;
    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) batches.push(texts.slice(i, i + this.batchSize));
    const results: number[][][] = new Array(batches.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
      while (next < batches.length) {
        const index = next++;
        results[index] = await this.embedBatch(batches[index]!, task);
      }
    });
    await Promise.all(workers);
    for (const batch of results) out.push(...batch);
    return out;
  }

  private async embedBatch(texts: string[], task: EmbeddingTask, attempt = 0): Promise<number[][]> {
    try {
      const response = await this.client.models.embedContent({
        model: this.model,
        contents: texts,
        config: { taskType: task, outputDimensionality: EMBEDDING_DIMENSIONS, autoTruncate: false },
      });
      const vectors = (response.embeddings ?? []).map((e) => e.values ?? []);
      if (vectors.length !== texts.length || vectors.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
        throw new Error("Embedding response shape mismatch");
      }
      return vectors.map(normalize);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (attempt < 4 && (status === 429 || (status !== undefined && status >= 500))) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
        return this.embedBatch(texts, task, attempt + 1);
      }
      throw err;
    }
  }
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

/**
 * TEST-ONLY lexical embedder: deterministic hashed bag-of-words vectors. It lets retrieval/scoping tests
 * run without a cloud endpoint. It is not semantic and is refused in production.
 */
export class HashingTestEmbedder implements Embedder {
  readonly model = "test-hashing-embedder-v1";

  constructor(env: NodeJS.ProcessEnv = process.env) {
    if (env.NODE_ENV === "production" || env.K_SERVICE) {
      throw new Error("HashingTestEmbedder is test-only and cannot run in production");
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      for (const token of tokens) {
        const digest = createHash("sha256").update(token).digest();
        const index = digest.readUInt32BE(0) % EMBEDDING_DIMENSIONS;
        vector[index]! += digest[4]! & 1 ? 1 : -1;
      }
      return normalize(vector);
    });
  }
}
