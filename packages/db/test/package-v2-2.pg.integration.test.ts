import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clearMessageFeedback,
  configureV2Persistence,
  createNotebook,
  deleteSourceGuides,
  getChatConfiguration,
  getMessageFeedback,
  getMessageFollowUps,
  getOverview,
  getOverviewForUser,
  getSourceGuide,
  persistChatMessage,
  resetChatStore,
  resetPackageV22Store,
  saveChatConfiguration,
  saveMessageFeedback,
  saveMessageFollowUps,
  saveOverview,
  saveSourceGuide,
} from "../src/index.ts";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "../src/testing.ts";

/**
 * [013-v2-persistence-postgres] T020 — Package 2.2 stores over PostgreSQL (FR-SI-02, FR-GC-04/05/07/09, CC-04).
 * The in-memory maps are cleared before reads to prove the values came from PostgreSQL.
 */

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
  configureV2Persistence(db.pool);
});
afterAll(async () => {
  configureV2Persistence(null);
  resetChatStore();
  await db?.drop();
});

const embed = async (texts: string[]) => texts.map(() => Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)));
const hash = (u: string) => createHash("sha256").update(u).digest("hex");

async function setup() {
  const owner = await createTestUser(db.pool);
  const nb = (await createNotebook(db.pool, owner, {})).notebook.id;
  const { sourceId, chunkIds } = (await seedReadySource(db.pool, owner, nb, { title: "S", mediaType: "text/plain", pages: ["Water freezes at zero."], embed })) as any;
  return { owner, nb, sourceId: sourceId as string, chunk: (chunkIds?.[0] as string | undefined) ?? "018f6b40-0001-7000-8000-000000000001" };
}

const guide = (nb: string, sourceId: string, chunk: string, language: string, status: "GuidePending" | "GuideReady" = "GuideReady") =>
  status === "GuideReady"
    ? { notebook_id: nb, source_id: sourceId, revision: 1, output_language: language, status, source_word_count: 4, summary_md: `Summary ${language}`, key_topics: ["Freezing"], supporting_chunk_ids: [chunk], generated_at: "2026-10-21T08:00:00.000Z" }
    : { notebook_id: nb, source_id: sourceId, revision: 1, output_language: language, status, source_word_count: 0, summary_md: "Generation pending", key_topics: [], supporting_chunk_ids: [] };

describe("FR-SI-02: Source Guides in PostgreSQL", () => {
  it("keys guides by (source, revision, language), prefers a Ready guide for any-language reads and is removed with its source", async () => {
    const { nb, sourceId, chunk } = await setup();
    await saveSourceGuide(guide(nb, sourceId, chunk, "de-DE", "GuidePending") as any);
    await saveSourceGuide(guide(nb, sourceId, chunk, "en-US") as any);
    resetPackageV22Store();
    expect(await getSourceGuide(nb, sourceId, 1, "en-US")).toMatchObject({ status: "GuideReady", summary_md: "Summary en-US" });
    expect(await getSourceGuide(nb, sourceId, 1, "fr-FR")).toBeNull();
    expect(await getSourceGuide(nb, sourceId, 2, "en-US")).toBeNull();
    expect(await getSourceGuide(nb, sourceId, 1)).toMatchObject({ output_language: "en-US", status: "GuideReady" });
    expect(await getSourceGuide(randomUUID(), sourceId, 1, "en-US")).toBeNull();
    await saveSourceGuide({ ...guide(nb, sourceId, chunk, "en-US"), summary_md: "Updated" } as any);
    expect((await getSourceGuide(nb, sourceId, 1, "en-US"))!.summary_md).toBe("Updated");
    await deleteSourceGuides(nb, sourceId);
    expect(await getSourceGuide(nb, sourceId, 1)).toBeNull();
    await saveSourceGuide(guide(nb, sourceId, chunk, "en-US") as any);
    await db.pool.query("DELETE FROM sources WHERE id = $1", [sourceId]);
    expect(await getSourceGuide(nb, sourceId, 1, "en-US")).toBeNull();
  });
});

describe("FR-GC-04/07: overviews and chat configuration in PostgreSQL", () => {
  it("serves an overview only to the user whose authorization key it carries", async () => {
    const { owner, nb, sourceId, chunk } = await setup();
    const key = `scope-${randomUUID()}`;
    const overview = { notebook_id: nb, source_revisions: [{ source_id: sourceId, revision: 1 }], authorization_key: hash(owner), output_language: "en-US", generation_parameters: {}, cache_key: key, overview_md: "Overview", starter_prompts: ["a"], supporting_chunk_ids: [chunk], generated_at: "2026-10-21T08:00:00.000Z" };
    await saveOverview(overview);
    resetPackageV22Store();
    expect(await getOverview(key)).toEqual(overview);
    expect(await getOverviewForUser(key, owner)).toEqual(overview);
    expect(await getOverviewForUser(key, "someone-else")).toBeNull();
    expect(await getOverview(`${key}-x`)).toBeNull();
  });

  it("returns the default configuration without a row and the saved one per notebook and user", async () => {
    const { owner, nb } = await setup();
    const other = await createTestUser(db.pool);
    expect(await getChatConfiguration(nb, owner)).toEqual({ style: "default", response_length: "default" });
    await saveChatConfiguration(nb, owner, { style: "custom", custom_instructions: "Answer as a tutor.", response_length: "longer" });
    resetPackageV22Store();
    expect(await getChatConfiguration(nb, owner)).toEqual({ style: "custom", custom_instructions: "Answer as a tutor.", response_length: "longer" });
    expect(await getChatConfiguration(nb, other)).toEqual({ style: "default", response_length: "default" });
  });
});

describe("FR-GC-05/09: feedback and follow-ups in PostgreSQL", () => {
  it("stores feedback per user and message, clears it, and keeps follow-ups per output language with the snapshot check", async () => {
    const { owner, nb, sourceId, chunk } = await setup();
    const message = await persistChatMessage(undefined, { thread_id: nb, notebook_id: nb, user_id: owner, role: "assistant", content: "Water freezes at zero [1].", active_source_revisions_snapshot: [{ source_id: sourceId, revision: 1 }] });
    const feedback = await saveMessageFeedback({ notebook_id: nb, user_id: owner, message_id: message.id, rating: "down", category: "incomplete", comment: "More detail" });
    resetPackageV22Store();
    expect(await getMessageFeedback(nb, owner, message.id)).toEqual(feedback);
    expect(await getMessageFeedback(nb, randomUUID(), message.id)).toBeNull();
    expect(await clearMessageFeedback(nb, owner, message.id)).toBe(true);
    expect(await clearMessageFeedback(nb, owner, message.id)).toBe(false);
    expect(await getMessageFeedback(nb, owner, message.id)).toBeNull();

    const followups = { source_revisions: [{ source_id: sourceId, revision: 1 }], output_language: "en-US", suggested_followups: [{ text: "Below zero?", supporting_chunk_ids: [chunk] }], generated_at: "2026-10-21T08:00:00.000Z" };
    await saveMessageFollowUps({ notebook_id: nb, user_id: owner, message_id: message.id, followups } as any);
    resetPackageV22Store();
    expect(await getMessageFollowUps(nb, owner, message.id, "en-US")).toMatchObject({ suggested_followups: [{ text: "Below zero?" }] });
    expect(await getMessageFollowUps(nb, owner, message.id, "de-DE")).toBeNull();
    await expect(saveMessageFollowUps({ notebook_id: nb, user_id: owner, message_id: message.id, followups: { ...followups, source_revisions: [{ source_id: sourceId, revision: 2 }] } } as any)).rejects.toThrow();
  });
});
