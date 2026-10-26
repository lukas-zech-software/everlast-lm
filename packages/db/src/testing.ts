import { randomUUID } from "node:crypto";
import pg from "pg";
import type { Pool } from "pg";
import { runMigrations } from "./migrate.ts";
import { ensureUser } from "./users.ts";

/**
 * TEST-ONLY helpers (not exported from the package index). Each call creates an isolated, freshly migrated
 * PostgreSQL database so suites never share state. Without TEST_DATABASE_URL the suite fails loudly with
 * UNAVAILABLE instead of passing on zero assertions (Constitution II).
 */

export interface TestDatabase {
  pool: Pool;
  url: string;
  drop(): Promise<void>;
}

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "UNAVAILABLE: TEST_DATABASE_URL is not set. Start PostgreSQL+pgvector with `pnpm db:test:up` and export " +
        "TEST_DATABASE_URL=postgres://everlast:everlast@127.0.0.1:54329/everlast"
    );
  }
  return url;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = testDatabaseUrl();
  const name = `everlast_t_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 20 });
  pool.on("error", () => {});
  await runMigrations(pool);

  return {
    pool,
    url: url.toString(),
    async drop() {
      await pool.end();
      const cleanup = new pg.Client({ connectionString: adminUrl });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

export async function createTestUser(pool: Pool, subject: string = `subject-${randomUUID()}`): Promise<string> {
  const user = await ensureUser(pool, { issuer: "https://test.everlast.local", subject });
  return user.id;
}

/**
 * TEST-ONLY: creates a Ready source whose chunks are the blank-line separated paragraphs of each page, with
 * embeddings from the supplied function. Goes through the real admission → receipt → publication path.
 */
export async function seedReadySource(
  pool: Pool,
  ownerId: string,
  notebookId: string,
  input: {
    title?: string;
    pages: string[];
    embed: (texts: string[]) => Promise<number[][]>;
    mediaType?: "application/pdf" | "text/plain" | "text/markdown" | "copied_text" | "note_markdown";
  }
): Promise<{ sourceId: string; revision: number; chunkIds: string[] }> {
  const { reserveSources, acceptReceivedSource } = await import("./quota.ts");
  const { publishReadySource } = await import("./ingestion.ts");
  const { uuidv7 } = await import("@everlast/contracts");
  const attemptId = randomUUID();
  const mediaType = input.mediaType ?? "application/pdf";
  const bytes = Buffer.byteLength(input.pages.join("\n"));
  const [admitted] = await reserveSources(pool, ownerId, notebookId, [
    { attempt_id: attemptId, title: input.title ?? "Fixture.pdf", media_type: mediaType, declared_bytes: bytes },
  ], { sourceLimit: 300 });
  const sourceId = admitted!.source!.id;
  await acceptReceivedSource(pool, { sourceId, attemptId, actualBytes: bytes, objectName: `fixtures/${sourceId}`, objectGeneration: "1" });
  const chunks: { text: string; page: number; start: number; end: number }[] = [];
  input.pages.forEach((page, p) => {
    let offset = 0;
    for (const para of page.split("\n\n")) {
      const len = Array.from(para).length;
      if (para.trim()) chunks.push({ text: para, page: p + 1, start: offset, end: offset + len });
      offset += len + 2;
    }
  });
  const vectors = await input.embed(chunks.map((c) => c.text));
  const isPdf = mediaType === "application/pdf";
  const built = chunks.map((c, i) => ({
    chunk: {
      chunk_id: uuidv7(),
      source_id: sourceId,
      revision: 1,
      locator: { page_number: c.page, ...(isPdf ? { physical_page: c.page } : {}), start_offset: c.start, end_offset: c.end },
      token_count: c.text.split(/\s+/).filter(Boolean).length,
      text: c.text,
    },
    embedding: vectors[i]!,
  }));
  const result = await publishReadySource(pool, {
    sourceId,
    attemptId,
    revision: 1,
    byteSize: bytes,
    wordCount: input.pages.join(" ").split(/\s+/).filter(Boolean).length,
    pageCount: input.pages.length,
    embeddingModel: "test-hashing-embedder-v1",
    pages: input.pages.map((text, i) => ({ page_number: i + 1, ...(isPdf ? { physical_page: i + 1 } : {}), text })),
    chunks: built,
  });
  if (!result.published) throw new Error(`seedReadySource failed: ${result.reason}`);
  return { sourceId, revision: 1, chunkIds: built.map((b) => b.chunk.chunk_id) };
}
