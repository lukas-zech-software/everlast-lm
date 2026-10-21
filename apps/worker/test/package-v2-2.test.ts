import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetPackageV22Store } from "@everlast/db";
import { generateFollowUps, generateNotebookOverview, generateSourceGuide, type PackageV22SourceReader, type ScopedSourceMaterial, type StructuredGenerationClient, readSourceGuide } from "../src/package-v2-2.ts";
import { createReadySourceDispatcher } from "../src/ready-hooks.ts";

const notebook = "11111111-1111-4111-8111-111111111111";
const source = "22222222-2222-4222-8222-222222222222";
const sourceB = "33333333-3333-4333-8333-333333333333";
const chunk = "018f6b40-0001-7000-8000-000000000001";
const material: ScopedSourceMaterial = { source_id: source, revision: 3, title: "Brief", word_count: 80, chunks: [{ chunk_id: chunk, source_id: source, revision: 3, text: "A source-grounded research note with supported evidence." }] };
const reader: PackageV22SourceReader = { readReadySources: async ({ source_revisions }) => source_revisions.map((entry) => entry.source_id === source ? material : { ...material, source_id: entry.source_id, revision: entry.revision, chunks: material.chunks.map((item) => ({ ...item, source_id: entry.source_id, revision: entry.revision })) }) };
const model: StructuredGenerationClient = {
  generateSourceGuide: async () => ({ summary_md: "A supported summary of the provided source.", key_topics: ["Topic one", "Topic two", "Topic three", "Topic four", "Topic five"], supporting_chunk_ids: [chunk] }),
  generateOverview: async () => ({ overview_md: "Overview grounded in the current notebook sources.", starter_prompts: ["Prompt one", "Prompt two", "Prompt three"], supporting_chunk_ids: [chunk] }),
  generateFollowUps: async () => ({ suggested_followups: [{ text: "What evidence supports this?", supporting_chunk_ids: [chunk] }] }),
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
    expect(overview.authorization_key).toMatch(/^[a-f0-9]{64}$/);
    expect(changed.cache_key).not.toBe(overview.cache_key);
    expect(otherOwner.cache_key).not.toBe(overview.cache_key);
    await expect(generateNotebookOverview({ notebook_id: notebook, user_id: "owner", source_revisions: [{ source_id: source, revision: 4 }], output_language: "en", reader, model })).rejects.toThrow(/stale or incomplete/);
    await expect(generateNotebookOverview({ notebook_id: notebook, user_id: "owner", source_revisions: [], output_language: "en", reader, model })).rejects.toThrow(/nonempty/);
  });

  it("keeps fewer supported overview prompts without padding (FR-GC-04)", async () => {
    const limitedModel = { ...model, generateOverview: async () => ({ overview_md: "Overview grounded in this evidence.", starter_prompts: ["One supported question?", "Another supported question?"], supporting_chunk_ids: [chunk] }) };
    const result = await generateNotebookOverview({ notebook_id: notebook, user_id: "owner", source_revisions: [{ source_id: source, revision: 3 }], output_language: "en", reader, model: limitedModel });
    expect(result.starter_prompts).toHaveLength(2);
  });

  it("rejects overview output without supporting source chunks (FR-GC-04/FR-020)", async () => {
    const unsupportedModel = { ...model, generateOverview: async () => ({ overview_md: "Unsupported overview.", starter_prompts: ["Question one?", "Question two?", "Question three?"], supporting_chunk_ids: [] }) };
    await expect(generateNotebookOverview({ notebook_id: notebook, user_id: "owner", source_revisions: [{ source_id: source, revision: 3 }], output_language: "en", reader, model: unsupportedModel })).rejects.toThrow();
  });

  it("rejects multi-sentence summaries for sources under 50 words (FR-SI-02)", async () => {
    const shortSource = { ...material, word_count: 49 };
    const shortReader: PackageV22SourceReader = { readReadySources: async () => [shortSource] };
    const invalidModel = { ...model, generateSourceGuide: async () => ({ summary_md: "First supported sentence. Second unsupported sentence.", key_topics: ["Topic"], supporting_chunk_ids: [chunk] }) };
    await expect(generateSourceGuide({ notebook_id: notebook, user_id: "owner", source_id: source, revision: 3, output_language: "en", reader: shortReader, model: invalidModel })).rejects.toThrow(/one sentence/i);
  });

  it("counts one sentence across Markdown line breaks and abbreviations, still rejecting two (FR-SI-02, live Gate v2.0 #1)", async () => {
    const shortSource = { ...material, word_count: 45 };
    const shortReader: PackageV22SourceReader = { readReadySources: async () => [shortSource] };
    const guideWith = (summary_md: string, output_language: string) => generateSourceGuide({
      notebook_id: notebook, user_id: "owner", source_id: source, revision: 3, output_language, reader: shortReader,
      model: { ...model, generateSourceGuide: async () => ({ summary_md, key_topics: ["Office rules"], supporting_chunk_ids: [chunk] }) },
    });
    await expect(guideWith("**Office Handbook:**\nVisitors are escorted, badges are worn and the canteen closes at 15:30 on Fridays.", "en-US")).resolves.toMatchObject({ status: "GuideReady" });
    await expect(guideWith("Das Handbuch regelt z. B. Besuche, u. a. Ausweise und die Kantine (Fr. 15:30 Uhr).", "de-DE")).resolves.toMatchObject({ status: "GuideReady" });
    await expect(guideWith("The handbook covers visitors, e.g. escorts, and the canteen (closes 15:30 Fri.).", "en-US")).resolves.toMatchObject({ status: "GuideReady" });
    await expect(guideWith("Visitors are escorted. Badges are worn.", "en-US")).rejects.toThrow(/one sentence/i);
    await expect(guideWith("Besucher werden begleitet. Die Kantine schließt um 15:30 Uhr.", "de-DE")).rejects.toThrow(/one sentence/i);
    await expect(guideWith("Visitors are escorted! Badges are worn?", "en-US")).rejects.toThrow(/one sentence/i);
    await expect(guideWith("- Visitors are escorted.\n- Badges are worn.", "en-US")).rejects.toThrow(/one sentence/i);
  });

  it("offers follow-ups only after completion and binds them to the authorized snapshot", async () => {
    await expect(generateFollowUps({ answer: "answer", notebook_id: notebook, user_id: "owner", source_revisions: [{ source_id: source, revision: 3 }], output_language: "en", reader, model, streaming: true })).rejects.toThrow(/after answer completion/);
    const result = await generateFollowUps({ answer: "answer", notebook_id: notebook, user_id: "owner", source_revisions: [{ source_id: source, revision: 3 }], output_language: "en", reader, model });
    expect(result.suggested_followups).toHaveLength(1);
  });

  it("meets deterministic local completion budgets and invalidates cached overview after scope revocation", async () => {
    let authorized = true;
    const revocableReader: PackageV22SourceReader = { readReadySources: async (request) => {
      if (!authorized) throw new Error("C-02 authorization revoked");
      return request.source_revisions.map((pair) => ({ ...material, source_id: pair.source_id, revision: pair.revision, chunks: material.chunks.map((item) => ({ ...item, source_id: pair.source_id, revision: pair.revision })) }));
    } };
    const within = async <T>(limitMs: number, operation: () => Promise<T>) => {
      const start = performance.now();
      const result = await operation();
      expect(performance.now() - start).toBeLessThan(limitMs);
      return result;
    };
    await within(10_000, () => generateSourceGuide({ notebook_id: notebook, user_id: "owner", source_id: source, revision: 3, output_language: "en", reader: revocableReader, model }));
    await within(6_000, () => generateNotebookOverview({ notebook_id: notebook, user_id: "owner", source_revisions: [{ source_id: source, revision: 3 }], output_language: "en", reader: revocableReader, model }));
    await within(1_000, () => generateFollowUps({ answer: "answer", notebook_id: notebook, user_id: "owner", source_revisions: [{ source_id: source, revision: 3 }], output_language: "en", reader: revocableReader, model }));
    authorized = false;
    await expect(generateNotebookOverview({ notebook_id: notebook, user_id: "owner", source_revisions: [{ source_id: source, revision: 3 }], output_language: "en", reader: revocableReader, model })).rejects.toThrow(/revoked/);
  });

  it("runs the guide hook once per Ready source revision", async () => {
    const callback = vi.fn(async () => undefined);
    const dispatch = createReadySourceDispatcher([callback]);
    const event = { notebook_id: notebook, source_id: source, revision_id: 1, title: "Short source", media_type: "copied_text" };
    await dispatch(event);
    await dispatch(event);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(event);
  });


  it("drops only follow-up chips whose support falls outside the current C-02 scope (FR-GC-05, FR-008, C-02)", async () => {
    const outside = "018f6b40-0009-7000-8000-000000000009";
    const mixed = { ...model, generateFollowUps: async () => ({ suggested_followups: [
      { text: "What evidence supports this?", supporting_chunk_ids: [chunk] },
      { text: "What does the other notebook say?", supporting_chunk_ids: [outside] },
      { text: "Which claim is strongest?", supporting_chunk_ids: [chunk, outside] },
    ] }) };
    const result = await generateFollowUps({ answer: "answer", notebook_id: notebook, user_id: "owner", source_revisions: [{ source_id: source, revision: 3 }], output_language: "en", reader, model: mixed });
    expect(result.suggested_followups.map((c) => c.text)).toEqual(["What evidence supports this?"]);
    expect(result.suggested_followups[0]!.supporting_chunk_ids).toEqual([chunk]);
    expect(result.output_language).toBe("en");
  });
});
