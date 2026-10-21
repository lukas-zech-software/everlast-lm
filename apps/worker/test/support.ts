import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createTestDatabase, createTestUser, type TestDatabase } from "@everlast/db/testing";
import { acceptReceivedSource, createNotebook, getSourceById, reserveSources, type SourceRecord } from "@everlast/db";
import { HashingTestEmbedder, LocalObjectStorage, type OcrEngine } from "@everlast/cloud";
import { processIngestJob, type IngestOutcome } from "../src/ingestion/pipeline.ts";

/**
 * TEST-ONLY harness: real PostgreSQL, versioned local storage, deterministic lexical embedder and an OCR
 * test double standing in for Document AI (the real processor is exercised only with cloud credentials).
 */
export class FixtureOcr implements OcrEngine {
  readonly name = "fixture-ocr";
  calls: number[][] = [];
  private readonly pages: Map<number, string>;

  constructor(pages: Record<number, string> = {}) {
    this.pages = new Map(Object.entries(pages).map(([k, v]) => [Number(k), v]));
  }

  async recognize(_pdf: Buffer, pages: number[]): Promise<Map<number, string>> {
    this.calls.push(pages);
    return new Map(pages.filter((p) => this.pages.has(p)).map((p) => [p, this.pages.get(p)!]));
  }
}

export interface WorkerHarness {
  db: TestDatabase;
  storage: LocalObjectStorage;
  embedder: HashingTestEmbedder;
  ownerId: string;
  notebookId: string;
  newNotebook(): Promise<string>;
  ingest(input: { name: string; bytes: Buffer; mediaType: string; ocr?: OcrEngine; notebookId?: string }): Promise<{ outcome: IngestOutcome; source: SourceRecord }>;
  close(): Promise<void>;
}

export async function createWorkerHarness(): Promise<WorkerHarness> {
  const db = await createTestDatabase();
  const dir = await mkdtemp(join(tmpdir(), "everlast-ingest-"));
  const storage = new LocalObjectStorage({ root: dir, publicBaseUrl: "http://localhost" });
  const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
  const ownerId = await createTestUser(db.pool);
  const newNotebook = async () => (await createNotebook(db.pool, ownerId, {})).notebook.id;
  const notebookId = await newNotebook();
  return {
    db,
    storage,
    embedder,
    ownerId,
    notebookId,
    newNotebook,
    async ingest({ name, bytes, mediaType, ocr, notebookId: nb }) {
      const target = nb ?? notebookId;
      const attemptId = randomUUID();
      const [admitted] = await reserveSources(db.pool, ownerId, target, [
        { attempt_id: attemptId, title: name, media_type: mediaType, declared_bytes: bytes.length },
      ], { sourceLimit: 300 });
      if (!admitted!.admitted) throw new Error(`admission failed: ${JSON.stringify(admitted!.error)}`);
      const source = admitted!.source!;
      const objectName = `notebooks/${target}/sources/${source.id}/raw`;
      const written = await storage.write(objectName, bytes, mediaType);
      const received = await acceptReceivedSource(db.pool, {
        sourceId: source.id,
        attemptId,
        actualBytes: written.size,
        objectName,
        objectGeneration: written.generation,
      });
      if (received.outcome !== "processing") {
        return { outcome: { status: "failed", code: received.outcome, message: "receipt" }, source: (await getSourceById(db.pool, source.id))! };
      }
      const outcome = await processIngestJob(
        { pool: db.pool, storage, embedder, ocr: ocr ?? new FixtureOcr() },
        { source_id: source.id, attempt_id: attemptId }
      );
      return { outcome, source: (await getSourceById(db.pool, source.id))! };
    },
    async close() {
      await db.drop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Deterministic prose generator for size/word fixtures (no real company content). */
export function prose(words: number, seed = "alpha"): string {
  const vocab = ["quarterly", "review", "pipeline", "budget", "forecast", "vendor", "policy", "audit", "roadmap", "metric", seed];
  const out: string[] = [];
  for (let i = 0; i < words; i++) {
    out.push(vocab[(i * 7 + seed.length) % vocab.length]!);
    if (i % 17 === 16) out[out.length - 1] += ".";
    if (i % 120 === 119) out[out.length - 1] += "\n\n";
  }
  return out.join(" ");
}
