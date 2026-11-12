import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HashingTestEmbedder, LocalObjectStorage, type GenAiFactoryOptions, type GenerateContentRequest } from "@everlast/cloud";
import { createTestDatabase, seedReadySource } from "@everlast/db/testing";
import { expect, it, vi } from "vitest";
import { startApiServer } from "../src/server.ts";

const transport = vi.hoisted(() => ({
  options: [] as GenAiFactoryOptions[],
  requests: [] as GenerateContentRequest[],
}));

vi.mock("@google/genai", async (importOriginal) => {
  const sdk = await importOriginal<typeof import("@google/genai")>();
  return {
    ...sdk,
    GoogleGenAI: class {
      readonly models = {
        countTokens: async () => ({ totalTokens: 12 }),
        generateContent: async () => { throw new Error("Unmocked SDK generation"); },
      };
      readonly caches = {
        create: async () => { throw new Error("Fixture is below cache threshold"); },
        delete: async () => undefined,
      };
    },
  };
});

vi.mock("@everlast/cloud", async (importOriginal) => {
  const cloud = await importOriginal<typeof import("@everlast/cloud")>();
  return {
    ...cloud,
    createEnterpriseStructuredGenerator: (...[role, env, options]: Parameters<typeof cloud.createEnterpriseStructuredGenerator>) =>
      cloud.createEnterpriseStructuredGenerator(role, env, {
        ...options,
        createClient(config) {
          transport.options.push(config);
          return {
            models: {
              async generateContent(request) {
                transport.requests.push(request);
                const { sources } = JSON.parse(request.contents) as { sources: Array<{ chunk_id: string; text: string }> };
                const chunk = sources[0]!;
                const evidence = { chunk_id: chunk.chunk_id, snippet: chunk.text };
                const body = request.config.systemInstruction?.toString().includes("mindmap")
                  ? { findings: [{ ...evidence, topic: "Measured chemistry", subtopic: "Water" }] }
                  : { observations: [{ ...evidence, item_label: "Water", attribute_id: "temperature", attribute_label: "Temperature", value_text: "0" }] };
                return { text: JSON.stringify(body) };
              },
            },
          };
        },
      }),
  };
});

it("[011-studio-mindmaps-data-tables] T065 actual API startup routes both C-03 plugins to scoped EU Flash (FR-ST-08/18, C-02, D23)", async () => {
  const root = await mkdtemp(join(tmpdir(), "everlast-011-api-"));
  const db = await createTestDatabase();
  const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
  const storage = new LocalObjectStorage({ root, publicBaseUrl: "http://127.0.0.1" });
  let running: Awaited<ReturnType<typeof startApiServer>> | undefined;
  try {
    running = await startApiServer({
      AUTH_MODE: "local", NODE_ENV: "test", PORT: "0", VERTEX_PROJECT: "task-011-fixture",
      V2_READY_WATCH_MS: "600000", GENAI_LOCATION: "global",
    }, { pool: db.pool, storage, embedder });
    const address = running.server.address();
    if (!address || typeof address === "string") throw new Error("Missing local API address");
    const base = `http://127.0.0.1:${address.port}`;
    const email = "studio-011@example.test";
    const token = running.deps.localIssuer!.issue(`local:${email}`, { email });
    const headers = { "authorization": `Bearer ${token}`, "content-type": "application/json" };
    const notebookRes = await fetch(`${base}/api/notebooks`, { method: "POST", headers, body: "{}" });
    expect(notebookRes.status).toBe(201);
    const notebookId = (await notebookRes.json()).notebook.id as string;
    const owner = (await db.pool.query("SELECT id FROM users WHERE subject = $1", [`local:${email}`])).rows[0].id as string;
    const source = await seedReadySource(db.pool, owner, notebookId, {
      title: "Scoped chemistry", pages: ["Water freezes at 0 Celsius."], mediaType: "text/plain",
      embed: (texts) => embedder.embed(texts),
    });
    await seedReadySource(db.pool, owner, notebookId, {
      title: "Unselected", pages: ["PRIVATE UNSELECTED MARKER"], mediaType: "text/plain",
      embed: (texts) => embedder.embed(texts),
    });

    const artifacts = `${base}/api/notebooks/${notebookId}/studio/artifacts`;
    for (const plugin_type of ["mindmap", "data_table"]) {
      const response = await fetch(artifacts, {
        method: "POST", headers,
        body: JSON.stringify({ plugin_type, subtype: "default", active_source_ids: [source.sourceId] }),
      });
      expect(response.status).toBe(202);
      const artifactId = (await response.json()).artifact.id as string;
      await expect.poll(async () => {
        const result = await fetch(`${artifacts}/${artifactId}`, { headers });
        const { artifact } = await result.json();
        return artifact;
      }, { timeout: 5_000 }).toMatchObject({
        status: "Completed",
        payload_json: { citations: [expect.objectContaining({ source_id: source.sourceId })] },
      });
    }

    expect(transport.options).toHaveLength(1);
    expect(transport.options[0]).toMatchObject({
      vertexai: true, project: "task-011-fixture", location: "eu",
      httpOptions: { baseUrl: "https://aiplatform.eu.rep.googleapis.com" },
    });
    expect(transport.requests).toHaveLength(2);
    for (const request of transport.requests) {
      expect(request.model).toBe("gemini-3.8-flash");
      expect(request.config).toMatchObject({ responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "LOW" } });
      expect(request.contents).toContain("Water freezes at 0 Celsius.");
      expect(request.contents).not.toContain("PRIVATE UNSELECTED MARKER");
    }
  } finally {
    running?.deps.v2?.close();
    if (running) await new Promise<void>((resolve, reject) => running!.server.close((error) => error ? reject(error) : resolve()));
    await db.drop();
    await rm(root, { recursive: true, force: true });
  }
});
