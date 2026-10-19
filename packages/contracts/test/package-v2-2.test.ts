import { describe, expect, it } from "vitest";
import * as v22 from "../src/package-v2-2.js";

const notebook = "11111111-1111-4111-8111-111111111111";
const source = "22222222-2222-4222-8222-222222222222";
const message = "33333333-3333-4333-8333-333333333333";
const chunk = "018f6b40-0001-7000-8000-000000000001";
const citation = {
  badge_number: 1,
  source_id: source,
  source_title: "Brief.md",
  chunk_id: chunk,
  snippet: "Supported claim.",
  locator: { page_number: 1, start_offset: 0, end_offset: 16 },
};

describe("Package 2.2 schemas (FR-SI-02, FR-GC-04/05/07/09, FR-NM-02, C-02)", () => {
  it("exports strict schemas for each package record", () => {
    for (const name of ["NotebookSourceSelectionSchema", "PersistedMessageFollowUpsSchema", "SourceGuideSchema", "NotebookOverviewSchema", "ChatConfigurationSchema", "MessageFeedbackInputSchema", "SaveResponseNoteRequestSchema", "SavedResponseNoteSchema"]) {
      expect((v22 as Record<string, unknown>)[name], name).toBeDefined();
    }
  });

  it("enforces source guide short-source and normal source boundaries", () => {
    const schema = v22.SourceGuideSchema;
    const base = { notebook_id: notebook, source_id: source, revision: 1, status: "GuideReady", source_word_count: 12, supporting_chunk_ids: [chunk], generated_at: new Date().toISOString() };
    expect(schema.safeParse({ ...base, summary_md: "One sentence.", key_topics: ["Topic"] }).success).toBe(true);
    expect(schema.safeParse({ ...base, source_word_count: 49, summary_md: "One sentence.", key_topics: Array(4).fill("Topic") }).success).toBe(false);
    expect(schema.safeParse({ ...base, source_word_count: 50, summary_md: "A full source summary.", key_topics: Array(4).fill("Topic") }).success).toBe(false);
    expect(schema.safeParse({ ...base, source_word_count: 50, summary_md: "A full source summary.", key_topics: Array(11).fill("Topic") }).success).toBe(false);
    expect(schema.safeParse({ ...base, summary_md: "word ".repeat(251), key_topics: ["Topic"] }).success).toBe(false);
    expect(schema.safeParse({ ...base, summary_md: "Summary", key_topics: Array(5).fill("x".repeat(41)) }).success).toBe(false);
    expect(schema.safeParse({ ...base, unexpected: true, summary_md: "One sentence.", key_topics: ["Topic"] }).success).toBe(false);
  });

  it("enforces the normal-source topic, prompt and follow-up code-point boundaries", () => {
    const guide = { notebook_id: notebook, source_id: source, revision: 1, status: "GuideReady", source_word_count: 50, summary_md: "A full-source summary.", supporting_chunk_ids: [chunk], generated_at: new Date().toISOString() };
    expect(v22.SourceGuideSchema.safeParse({ ...guide, key_topics: Array(5).fill("🌱".repeat(40)) }).success).toBe(true);
    expect(v22.SourceGuideSchema.safeParse({ ...guide, key_topics: ["a", "b", "c", "d"] }).success).toBe(false);
    expect(v22.SourceGuideSchema.safeParse({ ...guide, key_topics: ["🌱".repeat(41), "b", "c", "d", "e"] }).success).toBe(false);
    expect(v22.FollowUpSuggestionSchema.safeParse("🌱".repeat(100)).success).toBe(true);
    expect(v22.FollowUpSuggestionSchema.safeParse("🌱".repeat(101)).success).toBe(false);
    const followupBase = { supporting_chunk_ids: [chunk], source_revisions: [{ source_id: source, revision: 1 }], generated_at: new Date().toISOString() };
    expect(v22.FollowUpSuggestionsSchema.safeParse({ ...followupBase, suggested_followups: [] }).success).toBe(true);
    expect(v22.FollowUpSuggestionsSchema.safeParse({ ...followupBase, suggested_followups: ["same", "same"] }).success).toBe(false);
    expect(v22.FollowUpSuggestionsSchema.safeParse({ ...followupBase, suggested_followups: Array(4).fill("question") }).success).toBe(false);
    expect(v22.StarterPromptSchema.safeParse("🌱".repeat(120)).success).toBe(true);
    expect(v22.StarterPromptSchema.safeParse("🌱".repeat(121)).success).toBe(false);
  });

  it("validates source selection and persisted message follow-up envelopes", () => {
    const sourceRecord = { id: source, notebook_id: notebook, title: "Brief", media_type: "application/pdf", status: "Ready", revision_id: 2 };
    expect(v22.NotebookSourceSelectionSchema.safeParse(sourceRecord).success).toBe(true);
    expect(v22.NotebookSourceSelectionSchema.safeParse({ ...sourceRecord, notebook_id: "not-a-uuid" }).success).toBe(false);
    const suggestions = { suggested_followups: ["Explore evidence"], supporting_chunk_ids: [chunk], source_revisions: [{ source_id: source, revision: 2 }], generated_at: new Date().toISOString() };
    expect(v22.PersistedMessageFollowUpsSchema.safeParse({ notebook_id: notebook, user_id: "owner", message_id: message, suggestions }).success).toBe(true);
    expect(v22.PersistedMessageFollowUpsSchema.safeParse({ notebook_id: notebook, user_id: "owner", message_id: message, suggestions, other: true }).success).toBe(false);
  });

  it("validates configuration custom bounds and feedback empty/over-limit comments", () => {
    const custom = (text: string) => v22.ChatConfigurationSchema.safeParse({ style: "custom", custom_instructions: text }).success;
    expect(custom("x")).toBe(true);
    expect(custom("🌱".repeat(5000))).toBe(true);
    expect(custom("🌱".repeat(5001))).toBe(false);
    expect(v22.MessageFeedbackInputSchema.safeParse({ message_id: message, rating: "down", category: "other", comment: "" }).success).toBe(true);
    expect(v22.MessageFeedbackInputSchema.safeParse({ message_id: message, rating: "down", category: "other", comment: "x".repeat(1001) }).success).toBe(false);
  });

  it("validates overview prompts and feedback comment code points", () => {
    const overviewBase = { notebook_id: notebook, source_revisions: [{ source_id: source, revision: 1 }], authorization_key: "owner", output_language: "en-US", generation_parameters: {}, cache_key: "cache", overview_md: "Overview", supporting_chunk_ids: [chunk], generated_at: new Date().toISOString() };
    expect(v22.NotebookOverviewSchema.safeParse({ ...overviewBase, starter_prompts: Array(3).fill("🌱".repeat(120)) }).success).toBe(true);
    expect(v22.NotebookOverviewSchema.safeParse({ ...overviewBase, starter_prompts: Array(2).fill("prompt") }).success).toBe(true);
    expect(v22.NotebookOverviewSchema.safeParse({ ...overviewBase, starter_prompts: [] }).success).toBe(true);
    expect(v22.NotebookOverviewSchema.safeParse({ ...overviewBase, starter_prompts: Array(6).fill("prompt") }).success).toBe(false);
    expect(v22.NotebookOverviewSchema.safeParse({ ...overviewBase, starter_prompts: [], supporting_chunk_ids: [] }).success).toBe(false);
    expect(v22.NotebookOverviewSchema.safeParse({ ...overviewBase, starter_prompts: ["🌱".repeat(121), "two", "three"] }).success).toBe(false);
    expect(v22.MessageFeedbackInputSchema.safeParse({ message_id: message, rating: "up", comment: "🌱".repeat(1000) }).success).toBe(true);
    expect(v22.MessageFeedbackInputSchema.safeParse({ message_id: message, rating: "down", category: "other", comment: "x".repeat(1001) }).success).toBe(false);
    expect(v22.MessageFeedbackInputSchema.safeParse({ message_id: message, rating: "down" }).success).toBe(false);
  });

  it("counts trimmed custom instructions by Unicode code points and preserves shared note shape", () => {
    const config = (text: string) => v22.ChatConfigurationSchema.safeParse({ style: "custom", custom_instructions: text, response_length: "default" }).success;
    expect(config(` ${"🌟".repeat(5000)} `)).toBe(true);
    expect(config(" ")).toBe(false);
    expect(config("🌟".repeat(5001))).toBe(false);
    expect(v22.SaveResponseNoteRequestSchema.safeParse({ notebook_id: notebook, message_id: message }).success).toBe(true);
    const note = { id: message, notebook_id: notebook, source_message_id: message, title: "Answer", content_md: "Text [1]", citations_json: [citation], origin_type: "saved_response", read_only: true, created_at: new Date().toISOString() };
    expect(v22.SavedResponseNoteSchema.safeParse(note).success).toBe(true);
    expect(v22.SavedResponseNoteSchema.safeParse({ ...note, user_id: "client supplied" }).success).toBe(false);
  });
});
