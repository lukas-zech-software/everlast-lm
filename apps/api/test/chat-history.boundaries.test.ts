import { describe, it, expect, beforeEach } from "vitest";
import {
  getOrCreateChatThread,
  getChatMessages,
  persistChatMessage,
  clearChatThread,
  resetChatStore,
  searchChatMessages,
} from "@everlast/db";
import { publishTurn } from "../src/chat/publication.js";

describe("FR-GC-06: User Story 4 - Persistent History Boundary & Error Tests", () => {
  const notebookId = "99999999-9999-4999-8999-999999999999";
  const otherNotebookId = "88888888-8888-4888-8888-888888888888";
  const userAlice = "usr_alice_123";
  const userBob = "usr_bob_456";

  beforeEach(() => {
    resetChatStore();
  });

  it("Boundary 1: Empty or whitespace-only search query returns empty array", async () => {
    const thread = await getOrCreateChatThread(undefined, notebookId, userAlice);
    await persistChatMessage(undefined, {
      thread_id: thread.id,
      notebook_id: notebookId,
      user_id: userAlice,
      role: "user",
      content: "Hello world!",
    });

    const emptyResults = await searchChatMessages(undefined, notebookId, userAlice, "");
    expect(emptyResults).toEqual([]);

    const whitespaceResults = await searchChatMessages(undefined, notebookId, userAlice, "   ");
    expect(whitespaceResults).toEqual([]);
  });

  it("Boundary 2: Search term with zero matches returns empty results ('No messages found')", async () => {
    const thread = await getOrCreateChatThread(undefined, notebookId, userAlice);
    await persistChatMessage(undefined, {
      thread_id: thread.id,
      notebook_id: notebookId,
      user_id: userAlice,
      role: "user",
      content: "Discussing standard HTTP protocols.",
    });

    const results = await searchChatMessages(undefined, notebookId, userAlice, "QuantumTeleportation");
    expect(results).toHaveLength(0);
  });

  it("Boundary 3: Strict tenant and user thread isolation (FR-WM-04, FR-GC-06)", async () => {
    // Alice's thread in notebook 1
    const threadAlice = await getOrCreateChatThread(undefined, notebookId, userAlice);
    await persistChatMessage(undefined, {
      thread_id: threadAlice.id,
      notebook_id: notebookId,
      user_id: userAlice,
      role: "user",
      content: "Alice's secret inquiry.",
    });

    // Bob's thread in notebook 1
    const threadBob = await getOrCreateChatThread(undefined, notebookId, userBob);
    await persistChatMessage(undefined, {
      thread_id: threadBob.id,
      notebook_id: notebookId,
      user_id: userBob,
      role: "user",
      content: "Bob's private notes.",
    });

    // Alice's thread in notebook 2
    const threadAliceNb2 = await getOrCreateChatThread(undefined, otherNotebookId, userAlice);
    await persistChatMessage(undefined, {
      thread_id: threadAliceNb2.id,
      notebook_id: otherNotebookId,
      user_id: userAlice,
      role: "user",
      content: "Alice's notebook 2 content.",
    });

    // Verify Bob cannot see Alice's messages in notebook 1
    const bobMessages = await getChatMessages(undefined, notebookId, userBob);
    expect(bobMessages).toHaveLength(1);
    expect(bobMessages[0]!.content).toBe("Bob's private notes.");

    // Verify Alice cannot see Bob's messages in notebook 1
    const aliceMessages = await getChatMessages(undefined, notebookId, userAlice);
    expect(aliceMessages).toHaveLength(1);
    expect(aliceMessages[0]!.content).toBe("Alice's secret inquiry.");

    // Verify searching for Alice's inquiry from Bob returns 0 results
    const bobSearchResults = await searchChatMessages(undefined, notebookId, userBob, "Alice");
    expect(bobSearchResults).toHaveLength(0);

    // Verify cross-notebook search isolation
    const nb2SearchResults = await searchChatMessages(undefined, otherNotebookId, userAlice, "secret");
    expect(nb2SearchResults).toHaveLength(0);
  });

  it("Boundary 4: In-flight generation rejection and epoch invalidation on confirmed Clear Chat", async () => {
    // Initial thread at epoch 1
    const thread = await getOrCreateChatThread(undefined, notebookId, userAlice);
    expect(thread.generation_epoch).toBe(1);

    // User triggers Clear Chat while an assistant turn is being generated at epoch 1
    const clearResult = await clearChatThread(undefined, notebookId, userAlice);
    expect(clearResult.cleared).toBe(true);
    expect(clearResult.generationEpoch).toBe(2);

    // Late arriving response from epoch 1 attempts to publish and persist
    const latePublishResult = await publishTurn({
      notebookId,
      userId: userAlice,
      threadId: thread.id,
      expectedEpoch: 1, // generated for epoch 1
      draftText: "Late arriving assistant answer.",
      activeChunks: [],
      activeSourceIds: ["11111111-1111-4111-8111-111111111111"],
      getThreadEpoch: async () => (await getOrCreateChatThread(undefined, notebookId, userAlice)).generation_epoch,
    });

    expect(latePublishResult.success).toBe(false);
    expect(latePublishResult.rejectedDueToEpoch).toBe(true);

    // Verify thread remains empty: late response did not resurrect or write to the cleared thread
    const currentMessages = await getChatMessages(undefined, notebookId, userAlice);
    expect(currentMessages).toHaveLength(0);
  });
});
