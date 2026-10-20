import http from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDatabase } from "@everlast/db/testing";
import { HashingTestEmbedder, LocalObjectStorage } from "@everlast/cloud";
import { createApp, type AppDeps } from "@everlast/api/app";
import { LocalIdentityIssuer } from "@everlast/api/auth/identity";
import { ChatService } from "@everlast/api/chat/service";
import { createV2Runtime } from "@everlast/api/v2/runtime";
import type { GroundedModel, GroundedModelInput } from "@everlast/api/chat/model";
import type { GroundedDraft } from "@everlast/api/chat/draft";
import { createWorkerHandler } from "@everlast/worker";

/**
 * TEST-ONLY E2E server (FR-UI-01, FR-SI-01/03/04, FR-GC-01/02/03/06, Gate v1.0 #1/#3).
 * Real API, real PostgreSQL (fresh database), real ingestion worker and local versioned storage. Two clearly
 * labelled test doubles replace cloud AI: a lexical embedder and a deterministic fixture model that cites
 * retrieved chunks sharing keywords with the question (or refuses). UI behavior, scoping, verification and
 * citation navigation are therefore real; answer quality is measured separately by the judged eval suite.
 */

const STOP = new Set(["what", "which", "does", "with", "that", "this", "from", "about", "have", "there", "their", "where", "when", "summarize", "tell", "please", "repeat"]);

class FixtureModel implements GroundedModel {
  readonly id = "e2e-fixture-model";

  async generate({ question, chunks }: GroundedModelInput): Promise<GroundedDraft> {
    const words = (question.toLowerCase().match(/[\p{L}\p{N}$.]{4,}/gu) ?? []).map((w) => w.replace(/[.?]+$/, "")).filter((w) => !STOP.has(w));
    const hits = chunks.filter((c) => words.some((w) => c.text.toLowerCase().includes(w)));
    if (hits.length === 0) return { status: "not_in_sources", missing_topic: question.replace(/[?.!]+$/, ""), sentences: [] };
    return {
      status: "answered",
      sentences: hits.slice(0, 8).map((c) => ({ text: c.text.split(/(?<=[.!?])\s/)[0]!.slice(0, 300), citations: [c.chunk_id], kind: "claim" as const })),
    };
  }
}

export async function startE2eServer(port: number) {
  const db = await createTestDatabase();
  const dir = await mkdtemp(join(tmpdir(), "everlast-e2e-"));
  const baseUrl = `http://127.0.0.1:${port}`;
  const storage = new LocalObjectStorage({ root: dir, publicBaseUrl: baseUrl });
  const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
  const issuer = new LocalIdentityIssuer({ NODE_ENV: "test" });
  const worker = createWorkerHandler({ pool: db.pool, storage, embedder, ocr: { name: "none", recognize: async () => new Map() } }, { NODE_ENV: "test" });
  let pending: Promise<unknown> = Promise.resolve();
  const notifyJobs = () => {
    pending = pending.then(() => worker.drain());
  };
  // Note-sources run the real v1 ingestion with the same storage and lexical embedder (FR-NM-03, Gate v2.0 #2).
  const v2 = createV2Runtime({ pool: db.pool, sourceLimit: Number(process.env.MAX_SOURCES_PER_NOTEBOOK ?? 50), model: new FixtureModel(), storage, embedder, notifyJobs });
  const deps: AppDeps = {
    pool: db.pool,
    config: {
      port,
      authMode: "local",
      projectId: "e2e",
      sourceLimit: Number(process.env.MAX_SOURCES_PER_NOTEBOOK ?? 50),
      checkRevocation: false,
      webDistDir: fileURLToPath(new URL("../dist", import.meta.url)),
    },
    verifier: issuer.verifier,
    localIssuer: issuer,
    storage,
    embedder,
    chat: new ChatService({
      pool: db.pool,
      embedder,
      model: new FixtureModel(),
      resolvePreferences: (owner, notebook, locale) => v2.chatPreferences(owner, notebook, locale),
    }),
    // Release v2 PoC stores (D16); no generation client, so Source Guide/overview/follow-ups report 503.
    v2,
    notifyJobs,
  };
  const server = http.createServer(createApp(deps));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const close = async () => {
    server.close();
    await db.drop();
  };
  return { server, db, close };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.E2E_PORT ?? 4317);
  const { close } = await startE2eServer(port);
  console.log(`E2E server on http://127.0.0.1:${port} (TEST DOUBLES: lexical embedder + fixture model)`);
  const stop = () => void close().finally(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
