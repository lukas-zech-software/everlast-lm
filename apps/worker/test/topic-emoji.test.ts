import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNotebook, getNotebookRaw, getNotebookMetadata, resetNotebookStore, resetQuotaStore, resetWorkspacePreferenceStore } from "@everlast/db";
import { IngestionPipeline } from "../src/ingestion/pipeline.js";
import { selectTopicEmoji, type TopicEmojiClient } from "../src/ingestion/topic-emoji.js";

beforeEach(() => {
  resetNotebookStore();
  resetQuotaStore();
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
    const notebook = await createNotebook(undefined, "owner", { title: "Biology" });
    const initialUpdatedAt = notebook.updated_at;
    const pipeline = new IngestionPipeline({ topicEmojiSelector: { suggest: async () => "🧬" } });
    const result = await pipeline.process({
      attempt_id: "attempt-1",
      notebook_id: notebook.id,
      source_id: "source-1",
      revision_id: 1,
      title: "Cell Biology.pdf",
      media_type: "application/pdf",
      content: Buffer.from("%PDF-1.4 cell biology"),
    });
    expect(result.status).toBe("Ready");
    expect(await getNotebookMetadata(notebook.id)).toMatchObject({ icon_emoji: "🧬", icon_source: "topic" });
    expect(getNotebookRaw(notebook.id)?.updated_at).not.toBe(initialUpdatedAt);
  });

  it("keeps ingestion Ready and the default icon when topic selection fails", async () => {
    const notebook = await createNotebook(undefined, "owner", { title: "Biology" });
    const pipeline = new IngestionPipeline({ topicEmojiSelector: { suggest: async () => { throw new Error("model unavailable"); } } });
    const result = await pipeline.process({
      attempt_id: "attempt-2",
      notebook_id: notebook.id,
      source_id: "source-2",
      revision_id: 1,
      title: "Cell Biology.pdf",
      media_type: "application/pdf",
      content: Buffer.from("%PDF-1.4 cell biology"),
    });
    expect(result.status).toBe("Ready");
    expect(await getNotebookMetadata(notebook.id)).toMatchObject({ icon_emoji: "📓", icon_source: "default" });
  });
});
