import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPocNotebook, getNotebookRaw, getNotebookMetadata, resetPocBridge, resetWorkspacePreferenceStore } from "@everlast/db";
import { applyTopicIcon } from "../src/ready-hooks.ts";
import { selectTopicEmoji, type TopicEmojiClient } from "../src/ingestion/topic-emoji.ts";

beforeEach(() => {
  resetPocBridge();
  resetWorkspacePreferenceStore();
});

describe("Solution Architecture §2.1 Flash-Lite topic emoji enrichment (FR-WM-02)", () => {
  it("sends only source title and media type and accepts a single emoji result", async () => {
    const selectEmoji = vi.fn(async () => "🧬");
    const client: TopicEmojiClient = { selectEmoji };
    expect(await selectTopicEmoji({ title: "Cell Biology", mediaType: "application/pdf" }, client)).toBe("🧬");
    expect(selectEmoji).toHaveBeenCalledWith({ title: "Cell Biology", mediaType: "application/pdf" });
  });

  it("rejects invalid model output and treats model errors as absent suggestions", async () => {
    expect(await selectTopicEmoji({ title: "Text", mediaType: "text/plain" }, { selectEmoji: async () => "🧬🧬" })).toBeNull();
    expect(await selectTopicEmoji({ title: "Text", mediaType: "text/plain" }, { selectEmoji: async () => { throw new Error("unavailable"); } })).toBeNull();
  });

  it("applies a first-Ready topic icon without allowing enrichment failure to fail ingestion", async () => {
    const notebook = createPocNotebook("owner", "Biology");
    const initialUpdatedAt = notebook.updated_at;
    await new Promise((r) => setTimeout(r, 2));
    const selector = { suggest: async () => "🧬" };
    await applyTopicIcon({ notebook_id: notebook.id, source_id: "source-1", revision_id: 1, title: "Cell Biology.pdf", media_type: "application/pdf" }, selector);
    expect(await getNotebookMetadata(notebook.id)).toMatchObject({ icon_emoji: "🧬", icon_source: "topic" });
    expect(getNotebookRaw(notebook.id)?.updated_at).not.toBe(initialUpdatedAt);
  });

  it("keeps ingestion Ready and the default icon when topic selection fails", async () => {
    const notebook = createPocNotebook("owner", "Biology");
    const selector = { suggest: async () => { throw new Error("model unavailable"); } };
    await applyTopicIcon({ notebook_id: notebook.id, source_id: "source-2", revision_id: 1, title: "Cell Biology.pdf", media_type: "application/pdf" }, selector);
    expect(await getNotebookMetadata(notebook.id)).toMatchObject({ icon_emoji: "📓", icon_source: "default" });
  });
});
