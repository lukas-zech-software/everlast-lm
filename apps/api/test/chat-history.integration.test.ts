import { describe, it, expect, beforeEach } from "vitest";
import {
  getOrCreateChatThread,
  getChatMessages,
  persistChatMessage,
  resetChatStore,
} from "@everlast/db";
import { filterEligibleHistory } from "../src/chat/context.js";
import type { Citation } from "@everlast/contracts";

describe("FR-GC-06, C-02, NFR-EVAL-04, SC-004: Chat History Integration & Performance Tests", () => {
  const notebookId = "99999999-9999-4999-8999-999999999999";
  const userId = "usr_alice_123";
  const source1Id = "11111111-1111-4111-8111-111111111111";
  const source2Id = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    resetChatStore();
  });

  it("SC-004: 50 turns load and render in <= 500 ms upon opening a notebook", async () => {
    const thread = await getOrCreateChatThread(undefined, notebookId, userId);

    // Prepopulate 50 turns (100 messages total)
    const now = Date.now();
    for (let i = 1; i <= 50; i++) {
      const userTime = new Date(now - (50 - i) * 1000 * 60).toISOString();
      const asstTime = new Date(now - (50 - i) * 1000 * 60 + 5000).toISOString();

      await persistChatMessage(undefined, {
        thread_id: thread.id,
        notebook_id: notebookId,
        user_id: userId,
        role: "user",
        content: `User query ${i} regarding project specifications.`,
        active_source_revisions_snapshot: [{ source_id: source1Id, revision: 1 }],
        citations: [],
        created_at: userTime,
      });

      await persistChatMessage(undefined, {
        thread_id: thread.id,
        notebook_id: notebookId,
        user_id: userId,
        role: "assistant",
        content: `Assistant factual response ${i} supported by source [1].`,
        active_source_revisions_snapshot: [{ source_id: source1Id, revision: 1 }],
        citations: [
          {
            badge_number: 1,
            source_id: source1Id,
            source_title: "Spec.pdf",
            chunk_id: `018f6b40-000${(i % 9) + 1}-7000-8000-000000000001`,
            snippet: "Documented fact.",
            locator: { page_number: 1, start_offset: 0, end_offset: 50 },
          },
        ],
        created_at: asstTime,
      });
    }

    // Benchmark loading 50 turns upon opening notebook
    const startTime = performance.now();
    const loadedMessages = await getChatMessages(undefined, notebookId, userId);
    const durationMs = performance.now() - startTime;

    // SC-004: Loads in <= 500 ms
    expect(durationMs).toBeLessThanOrEqual(500);
    expect(loadedMessages).toHaveLength(100);

    // Chronological order verification
    for (let j = 0; j < loadedMessages.length - 1; j++) {
      const t1 = new Date(loadedMessages[j]!.created_at).getTime();
      const t2 = new Date(loadedMessages[j + 1]!.created_at).getTime();
      expect(t1).toBeLessThanOrEqual(t2);
    }
  });

  it("NFR-EVAL-04, CP3, CP4: Historical messages remain viewable, but deselected source turns are excluded from new generation prompt", async () => {
    const thread = await getOrCreateChatThread(undefined, notebookId, userId);

    // Turn 1 used Source 1 and Source 2
    const userMsg1 = await persistChatMessage(undefined, {
      thread_id: thread.id,
      notebook_id: notebookId,
      user_id: userId,
      role: "user",
      content: "Explain auth and architecture.",
      active_source_revisions_snapshot: [
        { source_id: source1Id, revision: 1 },
        { source_id: source2Id, revision: 1 },
      ],
      citations: [],
    });

    const asstMsg1 = await persistChatMessage(undefined, {
      thread_id: thread.id,
      notebook_id: notebookId,
      user_id: userId,
      role: "assistant",
      content: "Server Alpha uses port 8080 and TLS 1.3.",
      active_source_revisions_snapshot: [
        { source_id: source1Id, revision: 1 },
        { source_id: source2Id, revision: 1 },
      ],
      citations: [],
    });

    // Both messages are persisted and viewable in UI
    const viewableHistory = await getChatMessages(undefined, notebookId, userId);
    expect(viewableHistory).toHaveLength(2);

    // When Source 2 is deselected before the next turn:
    const currentActiveSources = [source1Id]; // Source 2 deselected
    const currentRevisions = new Map([[source1Id, 1]]);

    const eligibleHistory = filterEligibleHistory(
      viewableHistory,
      currentActiveSources,
      currentRevisions
    );

    // Zero Leakage: Turn 1 is excluded from the new prompt context
    expect(eligibleHistory).toHaveLength(0);
  });
});
