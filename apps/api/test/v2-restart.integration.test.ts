import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, seedReadySource, type TestDatabase } from "@everlast/db/testing";
import { resetNoteStore, resetPackageV22Store, resetPocBridge, resetWorkspacePreferenceStore } from "@everlast/db";
import type { StructuredGenerationClient } from "@everlast/worker/package-v2-2";
import { citeAll, startNotesApi, type NotesApi } from "./notes-pg-support.ts";

/**
 * [013-v2-persistence-postgres] Restart suite (DEV-04, SC-001). A "restart" closes the API, clears every in-process
 * v2 store (as a new process would start empty) and starts a new API with a new v2 runtime on the SAME PostgreSQL
 * database. Sections run sequentially in this one file (analysis F2).
 */

const OWNER = "restart-owner";
let db: TestDatabase;
let n: NotesApi;

beforeAll(async () => {
  db = await createTestDatabase();
  n = await startNotesApi({ db });
});
afterAll(async () => {
  await n?.close();
  await db?.drop();
});

async function restart(options: Parameters<typeof startNotesApi>[0] = {}): Promise<void> {
  await n.close();
  resetPocBridge();
  resetNoteStore();
  resetWorkspacePreferenceStore();
  resetPackageV22Store();
  n = await startNotesApi({ ...options, db });
}

const notesOf = async (nb: string) => (await n.call(OWNER, "GET", `/api/notebooks/${nb}/notes`)).json.notes as any[];
const note = async (nb: string, title: string, content: string) =>
  (await n.call(OWNER, "POST", `/api/notebooks/${nb}/notes`, { title, content_md: content })).json.note;
const studio = (nb: string) => `/api/notebooks/${nb}/studio`;

async function waitTerminal(nb: string, id: string): Promise<any> {
  for (let i = 0; i < 400; i++) {
    const r = await n.call(OWNER, "GET", `${studio(nb)}/artifacts/${id}`);
    if (["Completed", "Failed", "Cancelled"].includes(r.json.artifact.status)) return r.json.artifact;
    await new Promise((res) => setTimeout(res, 15));
  }
  throw new Error("Studio job never finished");
}

describe("US1: notes and Studio reports survive a restart (FR-NM-01..04, FR-ST-10, DEV-04)", () => {
  it("US1-1 (FR-NM-01, FR-NM-02): manual and saved-response notes are unchanged after a restart", async () => {
    const nb = await n.notebook(OWNER);
    const spec = await n.addText(OWNER, nb, "Spec sheet. Port 8080 requires mTLS. Port 9090 is public.");
    await note(nb, "Alpha", "First **idea**.");
    await note(nb, "Beta", "Second idea.");
    await note(nb, "Gamma", "Third idea.");
    const turn = await n.turn(OWNER, nb, "Which port requires mTLS?", [spec]);
    const answer = turn.messages.find((m: any) => m.role === "assistant");
    const saved = (await n.saveNote(OWNER, nb, answer.id)).json.note;
    expect(saved.citations_json.length).toBeGreaterThan(0);
    const before = await notesOf(nb);
    expect(before).toHaveLength(4);

    await restart();
    expect(await notesOf(nb)).toEqual(before);
  });

  it("US1-2 (FR-NM-01): revisions continue after a restart and stale bases conflict", async () => {
    const nb = await n.notebook(OWNER);
    const a = await note(nb, "Draft", "v1");
    await n.call(OWNER, "PATCH", `/api/notebooks/${nb}/notes/${a.id}`, { content_md: "v2", base_revision: 1 });
    await n.call(OWNER, "PATCH", `/api/notebooks/${nb}/notes/${a.id}`, { content_md: "v3", base_revision: 2 });

    await restart();
    const ok = await n.call(OWNER, "PATCH", `/api/notebooks/${nb}/notes/${a.id}`, { content_md: "v4", base_revision: 3 });
    expect(ok.status).toBe(200);
    expect(ok.json.note.revision).toBe(4);
    const stale = await n.call(OWNER, "PATCH", `/api/notebooks/${nb}/notes/${a.id}`, { content_md: "lost", base_revision: 2 });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe("RevisionConflict");
  });

  it("US1-3 (FR-ST-10): a completed report is unchanged after a restart", async () => {
    const nb = await n.notebook(OWNER);
    const owner = await n.userId(OWNER);
    const { sourceId } = await seedReadySource(db.pool, owner, nb, {
      title: "Archive",
      mediaType: "text/plain",
      pages: ["In 1650 the archive opened. Count Ada led it.\n\nIn 1660 the archive moved. It concerned Count Ada Archive."],
      embed: (t) => n.embedder.embed(t, "RETRIEVAL_DOCUMENT"),
    });
    const created = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, { plugin_type: "report", subtype: "briefing_doc", active_source_ids: [sourceId] });
    expect(created.status).toBe(202);
    const done = await waitTerminal(nb, created.json.artifact.id);
    expect(done.status).toBe("Completed");
    const list = (await n.call(OWNER, "GET", `${studio(nb)}/artifacts`)).json;

    await restart();
    expect((await n.call(OWNER, "GET", `${studio(nb)}/artifacts/${done.id}`)).json.artifact).toEqual(done);
    expect((await n.call(OWNER, "GET", `${studio(nb)}/artifacts`)).json).toEqual(list);
  });

  it("US1-4 (FR-NM-03, FR-NM-04): an unchanged note reuses its note-source after a restart", async () => {
    n.model.script = citeAll;
    const nb = await n.notebook(OWNER);
    const a = await note(nb, "Plan", "Deployment needs a maintenance window.");
    const first = await n.call(OWNER, "POST", `/api/notebooks/${nb}/notes/assistant`, { action_type: "summarize", selected_note_ids: [a.id], selected_source_ids: [] });
    expect(first.status).toBe(200);
    expect(first.json.reused).toBe(false);
    const used = (await n.call(OWNER, "GET", `/api/notebooks/${nb}/notes`)).json.source_slots.used;

    await restart();
    n.model.script = citeAll;
    const again = await n.call(OWNER, "POST", `/api/notebooks/${nb}/notes/assistant`, { action_type: "summarize", selected_note_ids: [a.id], selected_source_ids: [] });
    expect(again.status).toBe(200);
    expect(again.json.reused).toBe(true);
    expect(again.json.note_source.id).toBe(first.json.note_source.id);
    expect((await n.call(OWNER, "GET", `/api/notebooks/${nb}/notes`)).json.source_slots.used).toBe(used);
  });
});

describe("US2: workspace preferences and notebook metadata survive a restart (FR-WM-02, FR-WM-03, FR-UI-02, DEV-04)", () => {
  const topic = { suggest: async () => "🌍" };
  const nbOf = async (id: string) => (await n.call(OWNER, "GET", `/api/notebooks/${id}`)).json.notebook;
  const listed = async () => (await n.call(OWNER, "GET", "/api/notebooks")).json.notebooks as any[];

  it("US2-1 (FR-WM-02): custom and topic icons are kept and a later Ready source replaces neither", async () => {
    await restart({ v2: { topicEmoji: topic } });
    const custom = await n.notebook(OWNER);
    const topical = await n.notebook(OWNER);
    expect((await n.call(OWNER, "PATCH", `/api/notebooks/${custom}/icon`, { icon_emoji: "🧪" })).status).toBe(200);
    await n.addText(OWNER, topical, "The Andes span seven countries in South America.");
    await n.call(OWNER, "GET", `/api/notebooks/${topical}/sources`);
    for (let i = 0; i < 100 && (await nbOf(topical)).icon_source !== "topic"; i++) await new Promise((r) => setTimeout(r, 20));
    expect(await nbOf(topical)).toMatchObject({ icon_emoji: "🌍", icon_source: "topic" });

    await restart({ v2: { topicEmoji: { suggest: async () => "🚀" } } });
    expect(await nbOf(custom)).toMatchObject({ icon_emoji: "🧪", icon_source: "custom" });
    expect(await nbOf(topical)).toMatchObject({ icon_emoji: "🌍", icon_source: "topic" });
    await n.addText(OWNER, custom, "Rockets need fuel.");
    await n.call(OWNER, "GET", `/api/notebooks/${custom}/sources`);
    await new Promise((r) => setTimeout(r, 100));
    expect(await nbOf(custom)).toMatchObject({ icon_emoji: "🧪", icon_source: "custom" });
  });

  it("US2-2 (FR-WM-03): pin and last-opened order are kept; opening does not change the modified time", async () => {
    await restart();
    const older = await n.notebook(OWNER);
    const pinned = await n.notebook(OWNER);
    const opened = await n.notebook(OWNER);
    await n.call(OWNER, "PATCH", `/api/notebooks/${pinned}/preferences`, { is_pinned: true });
    const before = (await nbOf(opened)).updated_at;
    expect((await n.call(OWNER, "POST", `/api/notebooks/${opened}/opened`)).status).toBe(204);
    const orderBefore = (await listed()).map((x) => x.id);

    await restart();
    const after = await listed();
    expect(after.map((x) => x.id)).toEqual(orderBefore);
    expect(after.find((x) => x.id === pinned)).toMatchObject({ is_pinned: true });
    expect(after.find((x) => x.id === opened)!.last_opened_at).not.toBeNull();
    expect(after.find((x) => x.id === opened)!.updated_at).toBe(before);
    expect(after.findIndex((x) => x.id === opened)).toBeLessThan(after.findIndex((x) => x.id === older));
  });

  it("US2-3 (FR-UI-02): theme and languages are kept and the effective notebook output language stays fr-FR", async () => {
    await restart();
    const nb = await n.notebook(OWNER);
    await n.call(OWNER, "PATCH", "/api/preferences", { theme: "dark", output_language: "de-DE" });
    await n.call(OWNER, "PATCH", `/api/notebooks/${nb}/preferences`, { notebook_output_language: "fr-FR" });

    await restart();
    expect((await n.call(OWNER, "GET", "/api/preferences")).json).toMatchObject({ theme: "dark", output_language: "de-DE" });
    expect((await n.call(OWNER, "GET", `/api/notebooks/${nb}/preferences`)).json).toMatchObject({ notebook_output_language: "fr-FR" });
    const owner = await n.userId(OWNER);
    expect(await n.v2.chatPreferences(owner, nb)).toMatchObject({ output_language: "fr-FR" });
  });

  it("US2-4 (FR-WM-03): a v2 content change keeps advancing the notebook's modified time after a restart", async () => {
    await restart();
    const nb = await n.notebook(OWNER);
    const created = (await nbOf(nb)).updated_at;
    await note(nb, "Change", "content");
    const changed = (await nbOf(nb)).updated_at;
    expect(Date.parse(changed)).toBeGreaterThan(Date.parse(created));

    await restart();
    expect((await nbOf(nb)).updated_at).toBe(changed);
  });
});

describe("US3: Source Guides, overviews, chat settings and feedback survive a restart (FR-SI-02, FR-GC-04/05/07/09, DEV-04)", () => {
  const calls = { guide: 0, overview: 0, followups: 0 };
  /** TEST DOUBLE: deterministic structured model that counts calls and cites the first chunk it was given. */
  const generation: StructuredGenerationClient = {
    async generateSourceGuide({ source }) {
      calls.guide++;
      return { summary_md: "Port 8080 requires mTLS.", key_topics: ["mTLS"], supporting_chunk_ids: [source.chunks[0]!.chunk_id] };
    },
    async generateOverview({ sources }) {
      calls.overview++;
      return { overview_md: "The notebook covers ports.", starter_prompts: ["Which port needs mTLS?"], supporting_chunk_ids: [sources[0]!.chunks[0]!.chunk_id] };
    },
    async generateFollowUps({ sources }) {
      calls.followups++;
      return { suggested_followups: [{ text: "What about port 9090?", supporting_chunk_ids: [sources[0]!.chunks[0]!.chunk_id] }] };
    },
  };
  let nb: string;
  let spec: string;
  let messageId: string;
  const guideUrl = () => `/api/notebooks/${nb}/sources/${spec}/guide?revision=1`;
  const scope = () => ({ source_revisions: [{ source_id: spec, revision: 1 }] });

  it("US3-1, US3-2 (FR-SI-02): a Ready guide is served after a restart without any new generation", async () => {
    await restart({ v2: { generation } });
    nb = await n.notebook(OWNER);
    spec = await n.addText(OWNER, nb, "Spec sheet. Port 8080 requires mTLS. Port 9090 is public.");
    await n.call(OWNER, "GET", `/api/notebooks/${nb}/sources`);
    await expect.poll(async () => (await n.call(OWNER, "GET", guideUrl())).json.status, { timeout: 5_000 }).toBe("GuideReady");
    const ready = (await n.call(OWNER, "GET", guideUrl())).json;
    const before = calls.guide;

    await restart({ v2: { generation } });
    await n.call(OWNER, "GET", `/api/notebooks/${nb}/sources`);
    await new Promise((r) => setTimeout(r, 200));
    const after = await n.call(OWNER, "GET", guideUrl());
    expect(after.status).toBe(200);
    expect(after.json).toEqual(ready);
    expect(calls.guide).toBe(before);
    const otherRevision = await n.call(OWNER, "GET", `/api/notebooks/${nb}/sources/${spec}/guide?revision=2`);
    expect(otherRevision.json.revision === 1 && otherRevision.status === 200).toBe(false);
  });

  it("US3-3 (FR-GC-07): the chat configuration is used after a restart", async () => {
    const put = await n.call(OWNER, "PUT", `/api/notebooks/${nb}/chat/configuration`, { style: "custom", custom_instructions: "Answer as a tutor.", response_length: "longer" });
    expect(put.status).toBe(200);

    await restart({ v2: { generation } });
    expect((await n.call(OWNER, "GET", `/api/notebooks/${nb}/chat/configuration`)).json).toEqual({ style: "custom", custom_instructions: "Answer as a tutor.", response_length: "longer" });
    expect(await n.v2.chatPreferences(await n.userId(OWNER), nb)).toMatchObject({ style: "custom", custom_instructions: "Answer as a tutor.", response_length: "longer" });
  });

  it("US3-4 (FR-GC-05, FR-GC-09): feedback and follow-ups are unchanged after a restart", async () => {
    const turn = await n.turn(OWNER, nb, "Which port requires mTLS?", [spec]);
    messageId = turn.messages.find((m: any) => m.role === "assistant").id;
    const feedback = await n.call(OWNER, "POST", `/api/notebooks/${nb}/chat/messages/${messageId}/feedback`, { rating: "down", category: "incomplete", comment: "More detail" });
    expect(feedback.status).toBe(200);
    const followups = await n.call(OWNER, "POST", `/api/notebooks/${nb}/chat/messages/${messageId}/follow-ups`, scope());
    expect(followups.status).toBe(200);
    const before = calls.followups;

    await restart({ v2: { generation } });
    const again = await n.call(OWNER, "POST", `/api/notebooks/${nb}/chat/messages/${messageId}/follow-ups`, scope());
    expect(again.json).toEqual(followups.json);
    expect(calls.followups).toBe(before);
    const owner = await n.userId(OWNER);
    const stored = (await db.pool.query("SELECT record FROM message_feedback WHERE notebook_id = $1 AND user_id = $2 AND message_id = $3", [nb, owner, messageId])).rows[0]?.record;
    expect(stored).toMatchObject({ rating: "down", category: "incomplete", comment: "More detail" });
  });

  it("CC-04: clearing the chat deletes the thread's feedback and follow-ups with its messages", async () => {
    const owner = await n.userId(OWNER);
    const count = async (table: string) => (await db.pool.query(`SELECT count(*)::int AS c FROM ${table} WHERE notebook_id = $1 AND user_id = $2`, [nb, owner])).rows[0].c as number;
    expect(await count("message_feedback")).toBe(1);
    expect(await count("message_followups")).toBe(1);
    expect((await n.call(OWNER, "DELETE", `/api/notebooks/${nb}/chat`)).status).toBeLessThan(300);
    expect(await count("message_feedback")).toBe(0);
    expect(await count("message_followups")).toBe(0);
  });

  it("US3-5 (FR-GC-04): a cached overview is served after a restart without regeneration", async () => {
    const first = await n.call(OWNER, "POST", `/api/notebooks/${nb}/overview`, { ...scope(), output_language: "en-US" });
    expect(first.status).toBe(200);
    const before = calls.overview;

    await restart({ v2: { generation } });
    const cached = await n.call(OWNER, "GET", `/api/notebooks/${nb}/overview?cache_key=${first.json.cache_key}`);
    expect(cached.status).toBe(200);
    expect(cached.json).toEqual(first.json);
    expect((await n.call(OWNER, "POST", `/api/notebooks/${nb}/overview`, { ...scope(), output_language: "en-US" })).json).toEqual(first.json);
    expect(calls.overview).toBe(before);
  });
});

describe("US4: interrupted background work is never left hanging (FR-ST-10/11, FR-SI-02, C-03)", () => {
  it("US4-1: reports Queued/Running before the start fail as interrupted, can be retried, and new reports are untouched", async () => {
    await restart();
    const nb = await n.notebook(OWNER);
    const owner = await n.userId(OWNER);
    const { sourceId } = await seedReadySource(db.pool, owner, nb, { title: "Archive", mediaType: "text/plain", pages: ["In 1650 the archive opened."], embed: (t) => n.embedder.embed(t, "RETRIEVAL_DOCUMENT") });
    const snapshot = JSON.stringify([{ source_id: sourceId, revision: 1 }]);
    const seed = async (status: string) => {
      const id = crypto.randomUUID();
      await db.pool.query(
        `INSERT INTO studio_artifacts (id, notebook_id, owner_id, plugin_type, subtype, status, title, source_revisions_snapshot, progress_json, updated_at)
         VALUES ($1, $2, $3, 'report', 'faq', $4, 'FAQ', $5, $6, now() - interval '1 minute')`,
        [id, nb, owner, status, snapshot, status === "Running" ? JSON.stringify({ stage: "extracting", percent: 40 }) : null]
      );
      return id;
    };
    const running = await seed("Running");
    const queued = await seed("Queued");

    await restart();
    for (const id of [running, queued]) {
      await expect.poll(async () => (await n.call(OWNER, "GET", `${studio(nb)}/artifacts/${id}`)).json.artifact.status, { timeout: 5_000 }).toBe("Failed");
      const artifact = (await n.call(OWNER, "GET", `${studio(nb)}/artifacts/${id}`)).json.artifact;
      expect(artifact).toMatchObject({ payload_json: null, progress: null, failure: { code: "GenerationError" } });
      expect(artifact.failure.message).toMatch(/interrupted/i);
    }
    const retry = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${running}/retry`, { active_source_ids: [sourceId] });
    expect(retry.status).toBe(202);
    expect((await waitTerminal(nb, retry.json.artifact.id)).status).toBe("Completed");
  });

  it("US4-2: a guide left GuidePending before the start is dropped and the next open starts it again", async () => {
    const calls: string[] = [];
    const generation: StructuredGenerationClient = {
      async generateSourceGuide({ source }) {
        calls.push(source.source_id);
        return { summary_md: "The archive opened in 1650.", key_topics: ["Archive"], supporting_chunk_ids: [source.chunks[0]!.chunk_id] };
      },
      async generateOverview() {
        throw new Error("unused");
      },
      async generateFollowUps() {
        throw new Error("unused");
      },
    };
    await restart({ v2: { generation } });
    const nb = await n.notebook(OWNER);
    const owner = await n.userId(OWNER);
    const { sourceId } = await seedReadySource(db.pool, owner, nb, { title: "Archive", mediaType: "text/plain", pages: ["In 1650 the archive opened."], embed: (t) => n.embedder.embed(t, "RETRIEVAL_DOCUMENT") });
    const pending = { notebook_id: nb, source_id: sourceId, revision: 1, output_language: "en-US", status: "GuidePending", source_word_count: 0, summary_md: "Generation pending", key_topics: [], supporting_chunk_ids: [] };
    await db.pool.query(
      "INSERT INTO source_guides (source_id, revision, output_language, notebook_id, status, record, updated_at) VALUES ($1, 1, 'en-US', $2, 'GuidePending', $3, now() - interval '1 minute')",
      [sourceId, nb, JSON.stringify(pending)]
    );

    await restart({ v2: { generation } });
    await expect.poll(async () => (await db.pool.query("SELECT count(*)::int AS c FROM source_guides WHERE source_id = $1 AND status = 'GuidePending'", [sourceId])).rows[0].c, { timeout: 5_000 }).toBe(0);
    const url = `/api/notebooks/${nb}/sources/${sourceId}/guide?revision=1`;
    const first = await n.call(OWNER, "GET", url);
    expect([200, 202]).toContain(first.status);
    await expect.poll(async () => (await n.call(OWNER, "GET", url)).json.status, { timeout: 5_000 }).toBe("GuideReady");
    expect(calls).toContain(sourceId);
  });
});
