import { beforeEach, describe, expect, it } from "vitest";
import * as repo from "../src/package-v2-2.js";
import { clearChatThread, persistChatMessage, resetChatStore } from "../src/chat-history.js";

const notebookId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";
const userId = "owner-one";
const messageId = "33333333-3333-4333-8333-333333333333";
const chunkId = "018f6b40-0001-7000-8000-000000000001";
const timestamp = "2026-10-19T00:00:00.000Z";
const citation = { badge_number: 1, source_id: sourceId, source_title: "Brief", chunk_id: chunkId, snippet: "claim", locator: { page_number: 1, start_offset: 0, end_offset: 5 } };

beforeEach(() => {
  repo.resetPackageV22Store();
  resetChatStore();
});

describe("Package 2.2 in-memory repository (FR-GC-09, FR-NM-02, NFR-EVAL-04)", () => {
  it("exports reset and repository operations", () => {
    for (const name of ["resetPackageV22Store", "getSourceGuide", "saveSourceGuide", "getOverview", "saveOverview", "getChatConfiguration", "saveChatConfiguration", "saveMessageFeedback", "saveResponseNote"]) {
      expect((repo as Record<string, unknown>)[name], name).toBeDefined();
    }
  });

  it("isolates records and cache by notebook, owner, exact scope and revisions", async () => {
    const overview = { notebook_id: notebookId, source_revisions: [{ source_id: sourceId, revision: 1 }], authorization_key: userId, output_language: "en-US", generation_parameters: {}, cache_key: "scope-one", overview_md: "Overview", starter_prompts: ["a", "b", "c"], supporting_chunk_ids: [chunkId], generated_at: timestamp };
    await repo.saveOverview(overview);
    expect(await repo.getOverview("scope-one")).toEqual(overview);
    expect(await repo.getOverview("scope-two")).toBeNull();
    expect(await repo.getOverviewForUser("scope-one", "owner-two")).toBeNull();
  });

  it("keeps saved response notes idempotent and independent from chat deletion", async () => {
    await persistChatMessage(undefined, { id: messageId, thread_id: notebookId, notebook_id: notebookId, user_id: userId, role: "assistant", content: "Claim [1]", active_source_revisions_snapshot: [{ source_id: sourceId, revision: 1 }], citations: [citation], created_at: timestamp });
    const [first, second] = await Promise.all([
      repo.saveResponseNote({ notebook_id: notebookId, message_id: messageId, user_id: userId }),
      repo.saveResponseNote({ notebook_id: notebookId, message_id: messageId, user_id: userId }),
    ]);
    expect(second).toEqual(first);
    expect(first.content_md).toBe("Claim [1]");
    expect(first.citations_json).toEqual([citation]);
    await clearChatThread(undefined, notebookId, userId);
    expect(await repo.getSavedResponseNote(userId, messageId)).toEqual(first);
  });

  it("rejects user messages and stores feedback isolated per user and message", async () => {
    await persistChatMessage(undefined, { id: messageId, thread_id: notebookId, notebook_id: notebookId, user_id: userId, role: "user", content: "question", created_at: timestamp });
    await expect(repo.saveResponseNote({ notebook_id: notebookId, message_id: messageId, user_id: userId })).rejects.toThrow();
    await persistChatMessage(undefined, { id: "44444444-4444-4444-8444-444444444444", thread_id: notebookId, notebook_id: notebookId, user_id: userId, role: "assistant", content: "Answer", created_at: timestamp });
    const feedback = await repo.saveMessageFeedback({ notebook_id: notebookId, user_id: userId, message_id: "44444444-4444-4444-8444-444444444444", rating: "down", category: "wrong_citation", comment: "Needs review" });
    expect(feedback.rating).toBe("down");
    expect(await repo.getMessageFeedback(notebookId, userId, feedback.message_id)).toEqual(feedback);
    expect(await repo.getMessageFeedback(notebookId, "owner-two", feedback.message_id)).toBeNull();
  });
});
