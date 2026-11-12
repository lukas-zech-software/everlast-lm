import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HashingTestEmbedder, LocalObjectStorage, type GenerateContentRequest } from "@everlast/cloud";
import { createNotebook, PostgresStudioArtifactRepository } from "@everlast/db";
import { createTestDatabase, createTestUser, seedReadySource } from "@everlast/db/testing";
import { expect, it, vi } from "vitest";
import { startWorker } from "../src/server.ts";

const transport = vi.hoisted(() => ({
  mode: "valid",
  requests: [] as GenerateContentRequest[],
}));

vi.mock("@everlast/cloud", async (importOriginal) => {
  const cloud = await importOriginal<typeof import("@everlast/cloud")>();
  return {
    ...cloud,
    createEnterpriseStructuredGenerator: (...[role, env, options]: Parameters<typeof cloud.createEnterpriseStructuredGenerator>) =>
      cloud.createEnterpriseStructuredGenerator(role, env, {
        ...options,
        createClient: () => ({
          models: {
            async generateContent(request) {
              transport.requests.push(request);
              const { sources } = JSON.parse(request.contents) as { sources: Array<{ chunk_id: string; text: string }> };
              const chunk = sources[0]!;
              const evidence = {
                chunk_id: transport.mode === "forged-id" ? "01965b10-0000-7000-8000-000000000301" : chunk.chunk_id,
                snippet: transport.mode === "forged-quote" ? "Unstated result" : chunk.text,
              };
              const body = request.config.systemInstruction?.toString().includes("mindmap")
                ? { findings: [{ ...evidence, topic: transport.mode === "malformed" ? null : "Measured chemistry", subtopic: "Water" }] }
                : { observations: ["0", "1"].map(value_text => ({
                  ...evidence, item_label: "Water", attribute_id: "temperature", attribute_label: "Temperature", value_text,
                })) };
              return { text: JSON.stringify(body) };
            },
          },
        }),
      }),
  };
});

it("[011-studio-mindmaps-data-tables] T065 actual worker startup drains both plugins through EU Flash and fences invalid output (FR-ST-08/18, C-02/C-03, D23)", async () => {
  const root = await mkdtemp(join(tmpdir(), "everlast-011-worker-"));
  const db = await createTestDatabase();
  const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
  const storage = new LocalObjectStorage({ root, publicBaseUrl: "http://127.0.0.1" });
  let running: Awaited<ReturnType<typeof startWorker>> | undefined;
  try {
    const owner = await createTestUser(db.pool);
    const notebook = (await createNotebook(db.pool, owner, { title: "Startup evidence" })).notebook;
    const source = await seedReadySource(db.pool, owner, notebook.id, {
      title: "Scoped measurements", pages: ["Water froze at 0 Celsius in one trial and 1 Celsius in another."],
      mediaType: "text/plain", embed: (texts) => embedder.embed(texts),
    });
    const repo = new PostgresStudioArtifactRepository(db.pool);
    const queued = (plugin_type: "mindmap" | "data_table") => repo.createQueued({
      notebook_id: notebook.id, owner_id: owner, plugin_type, subtype: "default", title: "Studio startup",
      params_json: {}, snapshot: [{ source_id: source.sourceId, revision: 1 }],
    });
    const map = await queued("mindmap");
    const table = await queued("data_table");
    running = await startWorker({ NODE_ENV: "test", PORT: "0", WORKER_POLL_MS: "600000", VERTEX_PROJECT: "task-011-fixture" }, {
      pool: db.pool, storage, embedder, ocr: { name: "none", recognize: async () => new Map() },
    });

    await running.worker.drain();
    expect(await repo.getById(map.id)).toMatchObject({
      status: "Completed", payload_json: { root_node: { label: "Measured chemistry" } },
    });
    expect(await repo.getById(table.id)).toMatchObject({
      status: "Completed",
      payload_json: {
        rows: [{ cells: { temperature: {
          state: "conflict", disagreement: true,
          values: ["0", "1"].map(value => ({ value, citations: [expect.objectContaining({ source_id: source.sourceId })] })),
        } } }],
      },
    });

    for (const [mode, kind] of [["forged-id", "mindmap"], ["forged-quote", "data_table"], ["malformed", "mindmap"]] as const) {
      transport.mode = mode;
      const invalid = await queued(kind);
      await running.worker.drain();
      expect(await repo.getById(invalid.id)).toMatchObject({ status: "Failed", payload_json: null });
    }
    expect(transport.requests).toHaveLength(5);
    expect(transport.requests.every(request => request.model === "gemini-3.8-flash")).toBe(true);
  } finally {
    if (running) await new Promise<void>((resolve, reject) => running!.server.close((error) => error ? reject(error) : resolve()));
    await db.drop();
    await rm(root, { recursive: true, force: true });
  }
});
