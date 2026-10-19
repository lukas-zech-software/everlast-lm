import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { UnifiedDocumentChunk } from "@everlast/contracts";
import { createNote, getChatMessages, getScopedContext, listNotes } from "@everlast/db";
import type { NoteAssistantModel } from "../src/notes/assistant-model.ts";
import { newNotebook, resetAll, startApi, stubIngestor, USER, uuidv7 } from "./notes-fixtures.ts";

const EXT = "55555555-5555-4555-8555-555555555555";

describe("FR-NM-04, C-02: Note Assistant", () => {
  let nb: string;
  let api: Awaited<ReturnType<typeof startApi>>;
  let modelCalls: Parameters<NoteAssistantModel["answer"]>[0][];
  let extRevision: number;
  let extChunk: UnifiedDocumentChunk;
  let noteIds: string[];

  // Test double for the grounded answer port: cites every chunk it was given (real model + verifier in production).
  const assistant: NoteAssistantModel = {
    async answer(input) {
      modelCalls.push(input);
      return {
        refusal: false,
        content: input.chunks.map((_c, i) => `Claim [[${i + 1}]]`).join(" "),
        citations: input.chunks.map((c, i) => ({
          badge_number: i + 1,
          source_id: c.source_id,
          source_title: input.titles.get(c.source_id) ?? "Source",
          chunk_id: c.chunk_id,
          snippet: c.text,
          locator: c.locator,
        })),
      };
    },
  };

  const start = async (extra: Record<string, unknown> = {}, mode: "ok" | "failed" = "ok") => {
    api = await startApi({
      ingestor: stubIngestor(mode).ingestor,
      assistant,
      scopedContext: {
        async getScopedContext(notebookId, ids) {
          const own = ids.filter((id) => id !== EXT);
          const chunks = await getScopedContext(notebookId, own);
          return ids.includes(EXT) ? [...chunks, { ...extChunk, revision: extRevision }] : chunks;
        },
      },
      ...extra,
    });
  };
  const run = (body: unknown) => api.call("POST", `/api/notebooks/${nb}/notes/assistant`, body);

  beforeEach(async () => {
    resetAll();
    modelCalls = [];
    extRevision = 1;
    extChunk = {
      chunk_id: uuidv7(), source_id: EXT, revision: 1,
      locator: { page_number: 1, start_offset: 0, end_offset: 5 }, token_count: 3, text: "External fact",
    };
    nb = await newNotebook();
    noteIds = [
      (await createNote(nb, USER, { title: "A", content_md: "Alpha idea" })).id,
      (await createNote(nb, USER, { title: "B", content_md: "Beta idea" })).id,
    ];
  });
  afterEach(() => api.close());

  it("summarizes using only the note source and flags note assertions", async () => {
    await start();
    const r = await run({ action_type: "summarize", selected_note_ids: noteIds, selected_source_ids: [] });
    expect(r.status).toBe(200);
    expect(modelCalls).toHaveLength(1);
    expect(modelCalls[0]!.chunks.every((c) => c.source_id === r.json.note_source.id)).toBe(true);
    expect(Object.values(r.json.citation_kinds)).toEqual(["note_assertion"]);
    expect(r.json.note_assertion_source_ids).toEqual([r.json.note_source.id]);
    expect(r.json.snapshot).toEqual([{ source_id: r.json.note_source.id, revision: 1 }]);
    expect((await getChatMessages(undefined, nb, USER)).filter((m) => m.role === "assistant")).toHaveLength(1);
  });

  it("critique requires a comparison source and makes no conversion or model call without one", async () => {
    await start();
    const r = await run({ action_type: "critique", selected_note_ids: noteIds, selected_source_ids: [] });
    expect(r.status).toBe(400);
    expect(r.json.error).toEqual({ code: "ComparisonSourceRequired", message: "Select a comparison source first" });
    expect(modelCalls).toHaveLength(0);
    const slots = await api.call("GET", `/api/notebooks/${nb}/notes`);
    expect(slots.json.source_slots.used).toBe(0);
  });

  it("critique distinguishes note assertions from other source facts", async () => {
    await start();
    const r = await run({ action_type: "critique", selected_note_ids: noteIds, selected_source_ids: [EXT] });
    expect(r.status).toBe(200);
    expect(Object.values(r.json.citation_kinds).sort()).toEqual(["note_assertion", "source_fact"]);
    expect(r.json.snapshot).toHaveLength(2);
  });

  it("makes no model call when conversion fails", async () => {
    await start({}, "failed");
    const r = await run({ action_type: "summarize", selected_note_ids: noteIds, selected_source_ids: [] });
    expect(r.status).toBe(502);
    expect(modelCalls).toHaveLength(0);
  });

  it("validates selection size, action and ownership of notes", async () => {
    await start();
    const many = Array.from({ length: 51 }, () => uuidv7());
    expect((await run({ action_type: "summarize", selected_note_ids: many, selected_source_ids: [] })).status).toBe(422);
    expect((await run({ action_type: "rewrite", selected_note_ids: noteIds, selected_source_ids: [] })).status).toBe(422);
    expect((await run({ action_type: "summarize", selected_note_ids: [uuidv7()], selected_source_ids: [] })).status).toBe(404);
    expect(modelCalls).toHaveLength(0);
  });

  it("fails without publishing when a source revision changes mid-run", async () => {
    await start();
    const originalAnswer = assistant.answer.bind(assistant);
    assistant.answer = async (p) => {
      extRevision = 2;
      return originalAnswer(p);
    };
    const r = await run({ action_type: "related_ideas", selected_note_ids: noteIds, selected_source_ids: [EXT] });
    assistant.answer = originalAnswer;
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("SourceSnapshotInvalid");
    expect(await getChatMessages(undefined, nb, USER)).toHaveLength(0);
  });

  it("fails without publishing when authorization is revoked before publication", async () => {
    let calls = 0;
    await start({ verifyOwnership: () => ++calls < 3 });
    const r = await run({ action_type: "summarize", selected_note_ids: noteIds, selected_source_ids: [] });
    expect(r.status).toBe(403);
    expect(await getChatMessages(undefined, nb, USER)).toHaveLength(0);
    expect(await listNotes(nb, USER)).toHaveLength(2);
  });
});
