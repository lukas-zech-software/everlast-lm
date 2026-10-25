import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HashingTestEmbedder, LocalObjectStorage } from "@everlast/cloud";
import { createTestDatabase, seedReadySource, type TestDatabase } from "@everlast/db/testing";
import { deleteSource, getMessageFeedback, getMessageFollowUps, runWithV2Persistence } from "@everlast/db";
import { LATENCY_TABLE_PAGE, POPULATION_STDDEV_QUESTION } from "@everlast/testkit/code-execution-fixtures";
import { ChatService } from "../src/chat/service.ts";
import type { GroundedModel, GroundedModelInput } from "../src/chat/model.ts";
import type { GroundedDraft } from "../src/chat/draft.ts";
import { createV2Runtime } from "../src/v2/runtime.ts";
import { startTestApi, type TestApi } from "./support.ts";
import { latencyComputeDraft, ScriptedSandbox } from "./code-execution-support.ts";

/**
 * [010-code-execution-sandbox] T035 (API/v2 part) — Release v2 compatibility with computed chat messages
 * (FR-GC-08, FR-GC-05, FR-GC-06, FR-GC-09, FR-NM-02, DEV-04; spec FR-007, FR-010, FR-011).
 * Verifies that `configureChatMessageReader` projects computed answers into `ChatMessage` for save-to-note,
 * feedback, and follow-ups without leaking `code_execution_trace` into `Note` records, refuses actions on
 * source-deleted messages, clears all thread state on Clear chat, and isolates app pools via `runWithV2Persistence`.
 */

class ScriptedModel implements GroundedModel {
  readonly id = "scripted-v2-compat-model";
  script: (input: GroundedModelInput) => Promise<GroundedDraft> | GroundedDraft = ({ chunks }) =>
    latencyComputeDraft(chunks, "pstdev");
  async generate(input: GroundedModelInput): Promise<GroundedDraft> {
    return this.script(input);
  }
}

let api: TestApi;
let storage: LocalObjectStorage;
const model = new ScriptedModel();
const sandbox = new ScriptedSandbox();
const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
const embed = (t: string[]) => embedder.embed(t);

beforeAll(async () => {
  storage = new LocalObjectStorage({ root: await mkdtemp(join(tmpdir(), "everlast-ce-v2-")), publicBaseUrl: "http://127.0.0.1" });
  api = await startTestApi({}, (db) => {
    const v2 = createV2Runtime({
      pool: db.pool,
      sourceLimit: 50,
      model,
      storage,
      embedder,
      generation: {
        async generateSourceGuide({ source }) {
          return {
            summary_md: `Summary of ${source.title}.`,
            key_topics: ["latency"],
            supporting_chunk_ids: [source.chunks[0]!.chunk_id],
          };
        },
        async generateOverview({ sources }) {
          return {
            overview_md: "Overview",
            starter_prompts: ["Prompt 1", "Prompt 2", "Prompt 3"],
            supporting_chunk_ids: [sources[0]!.chunks[0]!.chunk_id],
          };
        },
        async generateFollowUps({ sources }) {
          return {
            suggested_followups: [
              {
                text: "What is the sample standard deviation?",
                supporting_chunk_ids: [sources[0]!.chunks[0]!.chunk_id],
              },
            ],
          };
        },
      },
    });
    return {
      embedder,
      storage,
      v2,
      chat: new ChatService({
        pool: db.pool,
        embedder,
        model,
        codeExecution: { runtime: sandbox, storage },
        resolvePreferences: (owner, notebook, locale) => v2.chatPreferences(owner, notebook, locale),
      }),
    };
  });
});

afterAll(async () => {
  await api?.close();
});

beforeEach(() => {
  sandbox.reset();
  model.script = ({ chunks }) => latencyComputeDraft(chunks, "pstdev");
});

async function setupComputedTurn(as: string) {
  const nbRes = await api.fetch("/api/notebooks", { method: "POST", as, json: {} });
  const notebookId = ((await nbRes.json()) as any).notebook.id as string;
  const owner = (await api.db.pool.query("SELECT id FROM users WHERE subject = $1", [`local:${as}`])).rows[0].id as string;
  const src = await seedReadySource(api.db.pool, owner, notebookId, { title: "Latency.pdf", pages: [LATENCY_TABLE_PAGE], embed });

  const turnRes = await api.fetch(`/api/notebooks/${notebookId}/chat/turns`, {
    method: "POST",
    as,
    json: { message: POPULATION_STDDEV_QUESTION, active_source_ids: [src.sourceId], request_id: randomUUID() },
  });
  const text = await turnRes.text();
  const final = JSON.parse(/event: final\ndata: (.+)/.exec(text)![1]!);
  const answer = final.messages[1];
  return { notebookId, owner, src, answer };
}

describe("T035 Release v2 compatibility with computed chat messages (FR-GC-08, FR-GC-09, FR-NM-02)", () => {
  it("CE-V2-01: saving a computed response to a note, rating it with feedback, and generating follow-ups succeed without leaking code_execution_trace into Note records", async () => {
    const { notebookId, src, answer } = await setupComputedTurn("v2-compat-1");
    expect(answer.code_execution_trace).toBeTruthy();

    // 1. Save computed response to note
    const saveRes = await api.fetch(`/api/notebooks/${notebookId}/chat/messages/${answer.id}/note`, {
      method: "POST",
      as: "v2-compat-1",
      json: { notebook_id: notebookId, message_id: answer.id },
    });
    expect(saveRes.status).toBe(200);
    const saved = ((await saveRes.json()) as any).note;
    expect(saved).toMatchObject({
      notebook_id: notebookId,
      source_message_id: answer.id,
      title: POPULATION_STDDEV_QUESTION,
      origin_type: "saved_response",
      read_only: true,
    });
    expect(saved.content_md).toContain("(Computed)[[1]]");
    expect(saved).not.toHaveProperty("code_execution_trace");
    expect(JSON.stringify(saved)).not.toContain("# FIXTURE:pstdev");

    // 2. Submit feedback on the computed message
    const fbRes = await api.fetch(`/api/notebooks/${notebookId}/chat/messages/${answer.id}/feedback`, {
      method: "POST",
      as: "v2-compat-1",
      json: { rating: "up" },
    });
    expect(fbRes.status).toBe(200);
    expect((await fbRes.json()) as any).toMatchObject({ message_id: answer.id, rating: "up" });

    // 3. Generate follow-ups for the computed message
    const fuRes = await api.fetch(`/api/notebooks/${notebookId}/chat/messages/${answer.id}/follow-ups`, {
      method: "POST",
      as: "v2-compat-1",
      json: { source_revisions: [{ source_id: src.sourceId, revision: 1 }] },
    });
    expect(fuRes.status).toBe(200);
    const fu = (await fuRes.json()) as any;
    expect(fu.suggested_followups).toEqual([
      { text: "What is the sample standard deviation?", supporting_chunk_ids: [src.chunkIds[0]] },
    ]);
  });

  it("CE-V2-02: once a cited source of a computed message is deleted, projectVisibleMessages hides it from v2 readers so save-to-note, feedback and follow-ups cannot leak redacted content", async () => {
    const { notebookId, owner, src, answer } = await setupComputedTurn("v2-compat-2");
    await deleteSource(api.db.pool, owner, notebookId, src.sourceId);

    // Save to note must return 404 MessageNotFound (hidden messages are filtered out of configureChatMessageReader)
    const saveRes = await api.fetch(`/api/notebooks/${notebookId}/chat/messages/${answer.id}/note`, {
      method: "POST",
      as: "v2-compat-2",
      json: { notebook_id: notebookId, message_id: answer.id },
    });
    expect(saveRes.status).toBe(404);

    // Feedback must be rejected (422) because the message is no longer visible
    const fbRes = await api.fetch(`/api/notebooks/${notebookId}/chat/messages/${answer.id}/feedback`, {
      method: "POST",
      as: "v2-compat-2",
      json: { rating: "down" },
    });
    expect(fbRes.status).toBe(422);

    // Follow-ups must return 404 MessageNotFound
    const fuRes = await api.fetch(`/api/notebooks/${notebookId}/chat/messages/${answer.id}/follow-ups`, {
      method: "POST",
      as: "v2-compat-2",
      json: { source_revisions: [{ source_id: src.sourceId, revision: 1 }] },
    });
    expect(fuRes.status).toBe(404);
  });

  it("CE-V2-03: DELETE /api/notebooks/:id/chat clears messages, traces, charts, feedback and follow-ups together under the owning app pool", async () => {
    const { notebookId, owner, src, answer } = await setupComputedTurn("v2-compat-3");
    await api.fetch(`/api/notebooks/${notebookId}/chat/messages/${answer.id}/feedback`, {
      method: "POST",
      as: "v2-compat-3",
      json: { rating: "up" },
    });
    await api.fetch(`/api/notebooks/${notebookId}/chat/messages/${answer.id}/follow-ups`, {
      method: "POST",
      as: "v2-compat-3",
      json: { source_revisions: [{ source_id: src.sourceId, revision: 1 }] },
    });

    const clearRes = await api.fetch(`/api/notebooks/${notebookId}/chat`, { method: "DELETE", as: "v2-compat-3" });
    expect(clearRes.status).toBe(200);

    const historyRes = await api.fetch(`/api/notebooks/${notebookId}/chat`, { as: "v2-compat-3" });
    expect(((await historyRes.json()) as any).messages).toEqual([]);

    await runWithV2Persistence(api.db.pool, async () => {
      expect(await getMessageFeedback(notebookId, owner, answer.id)).toBeNull();
      expect(await getMessageFollowUps(notebookId, owner, answer.id, "en-US")).toBeNull();
    });

    // Separate app pool sees nothing from this runtime (DEV-04 pool isolation)
    const otherDb: TestDatabase = await createTestDatabase();
    try {
      await runWithV2Persistence(otherDb.pool, async () => {
        expect(await getMessageFeedback(notebookId, owner, answer.id)).toBeNull();
      });
    } finally {
      await otherDb.drop();
    }
  });
});
