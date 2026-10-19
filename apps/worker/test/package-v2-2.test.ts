import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetPackageV22Store } from "@everlast/db";
import { generateFollowUps, generateNotebookOverview, generateSourceGuide, type PackageV22SourceReader, type ScopedSourceMaterial, type StructuredGenerationClient, readSourceGuide } from "../src/package-v2-2.js";
import { IngestionPipeline } from "../src/ingestion/pipeline.js";

const notebook = "11111111-1111-4111-8111-111111111111";
const source = "22222222-2222-4222-8222-222222222222";
const sourceB = "33333333-3333-4333-8333-333333333333";
const chunk = "018f6b40-0001-7000-8000-000000000001";
const material: ScopedSourceMaterial = { source_id: source, revision: 3, title: "Brief", word_count: 80, chunks: [{ chunk_id: chunk, source_id: source, revision: 3, text: "A source-grounded research note with supported evidence." }] };
const reader: PackageV22SourceReader = { readReadySources: async ({ source_revisions }) => source_revisions.map((entry) => entry.source_id === source ? material : { ...material, source_id: entry.source_id, revision: entry.revision, chunks: material.chunks.map((item) => ({ ...item, source_id: entry.source_id, revision: entry.revision })) }) };
const model: StructuredGenerationClient = {
  generateSourceGuide: async () => ({ summary_md: "A supported summary of the provided source.", key_topics: ["Topic one", "Topic two", "Topic three", "Topic four", "Topic five"], supporting_chunk_ids: [chunk] }),
  generateOverview: async () => ({ overview_md: "Overview grounded in the current notebook sources.", starter_prompts: ["Prompt one", "Prompt two", "Prompt three"], supporting_chunk_ids: [chunk] }),
  generateFollowUps: async () => ({ suggested_followups: ["What evidence supports this?"], supporting_chunk_ids: [chunk] }),
};
beforeEach(() => resetPackageV22Store());

describe("Package 2.2 worker pipelines (FR-SI-02, FR-GC-04/05, C-02)", () => {
  it("reads one exact source snapshot, retries transient model errors with bounded delays, then publishes guide", async () => {
    const waits: number[] = [];
    let calls = 0;
    const fake = { ...model, generateSourceGuide: async () => { calls += 1; if (calls < 3) throw { transient: true }; return model.generateSourceGuide({ source: material, output_language: "en" }); } };
    const result = await generateSourceGuide({ notebook_id: notebook, user_id: "owner", source_id: source, revision: 3, output_language: "en", reader, model: fake, retry: { sleep: async (ms) => { waits.push(ms); } } });
    expect(result.status).toBe("GuideReady");
    expect(calls).toBe(3);
    expect(waits).toEqual([100, 200]);
  });

  it("uses short-source topic bounds without padding and records exhausted failures", async () => {
    const shortSource = { ...material, word_count: 49 };
    const shortReader: PackageV22SourceReader = { readReadySources: async () => [shortSource] };
    const shortModel = { ...model, generateSourceGuide: async () => ({ summary_md: "One sentence summary.", key_topics: ["Only topic"], supporting_chunk_ids: [chunk] }) };
    const result = await generateSourceGuide({ notebook_id: notebook, user_id: "owner", source_id: source, revision: 3, output_language: "en", reader: shortReader, model: shortModel });
    expect(result.key_topics).toEqual(["Only topic"]);
    const failedModel = { ...model, generateSourceGuide: async () => { throw { transient: true }; } };
    const waits: number[] = [];
    await expect(generateSourceGuide({ notebook_id: notebook, user_id: "owner", source_id: source, revision: 3, output_language: "en", reader, model: failedModel, retry: { sleep: async (ms) => { waits.push(ms); } } })).rejects.toBeTruthy();
    expect(waits).toEqual([100, 200]);
    expect((await readSourceGuide(notebook, source, 3))?.status).toBe("GuideFailed");
  });

  it("does not retry non-transient model errors", async () => {
    let calls = 0;
    const failedModel = { ...model, generateSourceGuide: async () => { calls += 1; throw { transient: false }; } };
    await expect(generateSourceGuide({ notebook_id: notebook, user_id: "owner", source_id: source, revision: 3, output_language: "en", reader, model: failedModel, retry: { sleep: async () => { throw new Error("should not sleep"); } } })).rejects.toBeTruthy();
    expect(calls).toBe(1);
  });

  it("fails closed when generated support is outside the exact source scope", async () => {
    const fake = { ...model, generateSourceGuide: async () => ({ summary_md: "A summary.", key_topics: ["a", "b", "c", "d", "e"], supporting_chunk_ids: ["018f6b40-0002-7000-8000-000000000002"] }) };
    await expect(generateSourceGuide({ notebook_id: notebook, user_id: "owner", source_id: source, revision: 3, output_language: "en", reader, model: fake })).rejects.toThrow(/outside the authorized scope/);
  });

  it("keys overview to owner, language, parameters and exact revisions and rejects stale source snapshots", async () => {
    const overview = await generateNotebookOverview({ notebook_id: notebook, user_id: "owner", source_revisions: [{ source_id: source, revision: 3 }], output_language: "en", reader, model });
    const changed = await generateNotebookOverview({ notebook_id: notebook, user_id: "owner", source_revisions: [{ source_id: source, revision: 3 }], output_language: "fr", reader, model });
    const otherOwner = await generateNotebookOverview({ notebook_id: notebook, user_id: "another-owner", source_revisions: [{ source_id: source, revision: 3 }], output_language: "en", reader, model });
    expect(changed.cache_key).not.toBe(overview.cache_key);
    expect(otherOwner.cache_key).not.toBe(overview.cache_key);
    await expect(generateNotebookOverview({ notebook_id: notebook, user_id: "owner", source_revisions: [{ source_id: source, revision: 4 }], output_language: "en", reader, model })).rejects.toThrow(/stale or incomplete/);
    await expect(generateNotebookOverview({ notebook_id: notebook, user_id: "owner", source_revisions: [], output_language: "en", reader, model })).rejects.toThrow(/nonempty/);
  });

  it("offers follow-ups only after completion and binds them to the authorized snapshot", async () => {
    await expect(generateFollowUps({ answer: "answer", notebook_id: notebook, user_id: "owner", source_revisions: [{ source_id: source, revision: 3 }], output_language: "en", reader, model, streaming: true })).rejects.toThrow(/after answer completion/);
    const result = await generateFollowUps({ answer: "answer", notebook_id: notebook, user_id: "owner", source_revisions: [{ source_id: source, revision: 3 }], output_language: "en", reader, model });
    expect(result.suggested_followups).toHaveLength(1);
  });

  it("schedules the guide callback only after ingestion reaches Ready", async () => {
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
    const callback = vi.fn(() => resolveReady());
    const pipeline = new IngestionPipeline({ onReady: callback });
    const result = await pipeline.process({ attempt_id: "attempt-1", notebook_id: notebook, source_id: source, revision_id: 1, media_type: "copied_text", content: "A short source with grounded facts." });
    expect(result.status).toBe("Ready");
    await ready;
    expect(callback).toHaveBeenCalledWith(result);
  });

});
