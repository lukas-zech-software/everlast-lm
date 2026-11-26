import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HashingTestEmbedder, LocalObjectStorage, type ObjectStorage } from "@everlast/cloud";
import { admitCodeExecution, finishCodeExecution, type ChatThreadRecord } from "@everlast/db";
import { seedReadySource } from "@everlast/db/testing";
import {
  LATENCY_TABLE_PAGE,
  POPULATION_STDDEV_QUESTION,
} from "@everlast/testkit/code-execution-fixtures";
import { ChatService } from "../src/chat/service.ts";
import type { GroundedModel, GroundedModelInput } from "../src/chat/model.ts";
import type { GroundedDraft } from "../src/chat/draft.ts";
import { startTestApi, readJson, type TestApi } from "./support.ts";
import { latencyComputeDraft, ScriptedSandbox } from "./code-execution-support.ts";

/** [010-code-execution-sandbox] PR #159 review — admission conflicts and chart object cleanup (FR-GC-08, FR-010/FR-011). */
let api: TestApi;
const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
const embed = (t: string[]) => embedder.embed(t);
const deleted: string[] = [];
let clearOnWrite: string | null = null;
class Model implements GroundedModel {
  readonly id = "scripted";
  generate({ chunks }: GroundedModelInput): Promise<GroundedDraft> {
    return Promise.resolve(latencyComputeDraft(chunks, "pstdev"));
  }
}

beforeAll(async () => {
  const local = new LocalObjectStorage({
    root: await mkdtemp(join(tmpdir(), "everlast-pr159-")),
    publicBaseUrl: "http://127.0.0.1",
  });
  // Storage TEST DOUBLE: Clear chat commits while the chart object is being written.
  const storage: ObjectStorage = {
    kind: local.kind,
    write: async (name: string, data: Buffer, type: string) => {
      const meta = await local.write(name, data, type);
      if (clearOnWrite && name.includes("chat-charts/"))
        await api.db.pool.query("DELETE FROM code_executions WHERE notebook_id = $1", [
          clearOnWrite,
        ]);
      return meta;
    },
    read: (name, generation) => local.read(name, generation),
    readRange: (name, generation, start, end) => local.readRange(name, generation, start, end),
    stat: (name) => local.stat(name),
    listVersions: (prefix) => local.listVersions(prefix),
    deleteVersion: async (name: string, generation: string) => {
      deleted.push(name);
      return local.deleteVersion(name, generation);
    },
    createUploadUrl: (name, options) => local.createUploadUrl(name, options),
  };
  api = await startTestApi({}, (db) => ({
    embedder,
    storage,
    chat: new ChatService({
      pool: db.pool,
      embedder,
      model: new Model(),
      codeExecution: { runtime: new ScriptedSandbox(), storage, deadlineMs: 300 },
    }),
  }));
});
afterAll(async () => (api as TestApi | undefined)?.close());

async function notebook(as: string) {
  const res = await api.fetch("/api/notebooks", { method: "POST", as, json: {} });
  const notebookId = (await readJson<{ notebook: { id: string } }>(res)).notebook.id;
  const owner = (
    await api.db.pool.query<{ id: string }>("SELECT id FROM users WHERE subject = $1", [
      `local:${as}`,
    ])
  ).rows[0]!.id;
  const src = await seedReadySource(api.db.pool, owner, notebookId, {
    title: "Latency.pdf",
    pages: [LATENCY_TABLE_PAGE],
    embed,
  });
  return { notebookId, owner, src };
}

describe("[010-code-execution-sandbox] review: admission conflicts are reported truthfully (FR-GC-08)", () => {
  it("re-using the request_id of an ended, unpublished execution is not 'already running'", async () => {
    const { notebookId, owner } = await notebook("adm01");
    await api.fetch(`/api/notebooks/${notebookId}/chat`, { as: "adm01" });
    const thread = (
      await api.db.pool.query<ChatThreadRecord>(
        "SELECT * FROM chat_threads WHERE notebook_id = $1",
        [notebookId],
      )
    ).rows[0]!;
    expect(thread.user_id).toBe(owner);
    const requestId = randomUUID();
    const first = await admitCodeExecution(api.db.pool, { thread, requestId, snapshot: [] });
    await finishCodeExecution(api.db.pool, first.executionId, first.leaseToken, {
      state: "Failed",
      failureCode: "GenerationCancelled",
      trace: {
        schema_version: 1,
        execution_id: first.executionId,
        state: "Failed",
        attempts: [],
        final_attempt_id: null,
        published_artifact_ids: [],
        failure_code: "GenerationCancelled",
        computed_results: [],
      },
    });
    const err = (await admitCodeExecution(api.db.pool, { thread, requestId, snapshot: [] }).catch(
      (e: unknown) => e,
    )) as { code?: string; status?: number };
    expect(err.code).not.toBe("ExecutionInProgress");
    expect(err.status).toBe(409);
  });
});

describe("[010-code-execution-sandbox] review: a chart object without its row is removed (FR-010, FR-011)", () => {
  it("Clear chat during chart registration deletes the written object and reports cancellation, not InternalError", async () => {
    const { notebookId, src } = await notebook("chart01");
    clearOnWrite = notebookId;
    const turn = await api.fetch(`/api/notebooks/${notebookId}/chat/turns`, {
      method: "POST",
      as: "chart01",
      json: {
        message: POPULATION_STDDEV_QUESTION,
        active_source_ids: [src.sourceId],
        request_id: randomUUID(),
      },
    });
    const text = await turn.text();
    clearOnWrite = null;
    expect(text).toContain("event: error");
    expect(text).not.toContain("InternalError");
    expect(text).toContain("GenerationCancelled");
    expect(deleted.some((k) => k.includes(`chat-charts/`))).toBe(true);
  });
});
