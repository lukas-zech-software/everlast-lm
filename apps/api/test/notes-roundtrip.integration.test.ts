import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getChatMessages, getOrCreateChatThread, getScopedContext, persistChatMessage } from "@everlast/db";
import type { UnifiedDocumentChunk } from "@everlast/contracts";
import type { GroundedModel } from "../src/chat/model.ts";
import { GroundedNoteAssistant } from "../src/notes/assistant-model.ts";
import { newNotebook, resetAll, startApi, stubIngestor, USER, uuidv7 } from "./notes-fixtures.ts";

describe("Gate v2.0 #2, FR-NM-03, NFR-EVAL-02, NFR-EVAL-04: note → source round trip", () => {
  let api: Awaited<ReturnType<typeof startApi>>;
  beforeEach(() => resetAll());
  afterEach(() => api.close());

  it("answers TITAN-77 citing the converted note source with zero deselected leakage", async () => {
    const nb = await newNotebook();
    api = await startApi({ ingestor: stubIngestor().ingestor });

    const decoy: UnifiedDocumentChunk = {
      chunk_id: uuidv7(), source_id: "66666666-6666-4666-8666-666666666666", revision: 1,
      locator: { page_number: 1, start_offset: 0, end_offset: 5 }, token_count: 2, text: "DECOY-99 unrelated",
    };
    const thread = await getOrCreateChatThread(undefined, nb, USER);
    const answer = await persistChatMessage(undefined, {
      thread_id: thread.id, notebook_id: nb, user_id: USER, role: "assistant",
      content: "The project codename is TITAN-77 [1]",
      citations: [{
        badge_number: 1, source_id: "44444444-4444-4444-8444-444444444444", source_title: "Raw_Data.pdf",
        chunk_id: uuidv7(), snippet: "TITAN-77", locator: { page_number: 1, start_offset: 0, end_offset: 8 },
      }],
    });

    const saved = await api.call("POST", `/api/notebooks/${nb}/notes/from-message`, { message_id: answer.id });
    expect(saved.status).toBe(201);

    const started = performance.now();
    const converted = await api.call("POST", `/api/notebooks/${nb}/notes/convert-to-source`, { note_ids: [saved.json.note.id] });
    expect(performance.now() - started).toBeLessThan(2000);
    expect(converted.json.source.status).toBe("Ready");
    const sourceId: string = converted.json.source.id;

    const seen: UnifiedDocumentChunk[][] = [];
    // Scripted grounded model; the production citation verifier (D13) checks its draft.
    const model: GroundedModel = {
      id: "test:scripted",
      async generate(input) {
        seen.push(input.chunks);
        const hit = input.chunks.find((c) => c.text.includes("TITAN-77"));
        return hit
          ? { status: "answered", sentences: [{ text: "The project codename is TITAN-77.", citations: [hit.chunk_id], kind: "claim" }] }
          : { status: "not_in_sources", missing_topic: "the project codename", sentences: [] };
      },
    };
    const chunks = await getScopedContext(nb, [sourceId]);
    const turn = await new GroundedNoteAssistant(model).answer({
      question: "What is the project codename?",
      chunks,
      titles: new Map([[sourceId, converted.json.source.title as string]]),
    });

    expect(turn.content).toContain("TITAN-77");
    expect(turn.citations).toHaveLength(1);
    expect(turn.citations[0]!.source_id).toBe(sourceId);
    expect(seen.flat().some((c) => c.chunk_id === decoy.chunk_id || c.source_id !== sourceId)).toBe(false);
    expect(await getChatMessages(undefined, nb, USER)).toHaveLength(1);
  });

  it("converts a 5,000-word note within 2.0 seconds", async () => {
    const nb = await newNotebook();
    api = await startApi({ ingestor: stubIngestor().ingestor });
    const created = await api.call("POST", `/api/notebooks/${nb}/notes`, {
      title: "Big", content_md: Array.from({ length: 5000 }, (_, i) => `w${i}`).join(" "),
    });
    const t = performance.now();
    const r = await api.call("POST", `/api/notebooks/${nb}/notes/convert-to-source`, { note_ids: [created.json.note.id] });
    expect(r.status).toBe(201);
    expect(performance.now() - t).toBeLessThan(2000);
  });
});
