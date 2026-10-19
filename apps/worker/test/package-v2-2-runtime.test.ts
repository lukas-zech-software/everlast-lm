import { describe, expect, it, vi } from "vitest";
import { createPackageV22Runtime } from "../src/package-v2-2-runtime.js";
import type { StructuredGenerationClient } from "../src/package-v2-2.js";
import { IngestionPipeline } from "../src/ingestion/pipeline.js";
import { type ScopedContextProvider } from "@everlast/contracts";

const notebook = "11111111-1111-4111-8111-111111111111";
const source = "22222222-2222-4222-8222-222222222222";
const chunk = "018f6b40-0001-7000-8000-000000000001";
const provider: ScopedContextProvider = { getScopedContext: vi.fn(async () => [{ chunk_id: chunk, text: "Evidence", source_id: source, revision: 1, token_count: 2, locator: { page_number: 1, start_offset: 0, end_offset: 8 } }]) };
const validateScope = async (_userId: string, request: import("@everlast/contracts").ScopedContextEnvelope) => ({ snapshot: request.source_revisions ?? [] });
const getSourceMetadata = async () => [{ source_id: source, revision: 1, title: "Brief", word_count: 50 }];
const model: StructuredGenerationClient = {
  generateSourceGuide: async () => ({ summary_md: "Summary", key_topics: ["one", "two", "three", "four", "five"], supporting_chunk_ids: [chunk] }),
  generateOverview: async () => ({ overview_md: "Overview", starter_prompts: ["one", "two", "three"], supporting_chunk_ids: [chunk] }),
  generateFollowUps: async () => ({ suggested_followups: ["What evidence?"], supporting_chunk_ids: [chunk] }),
};

describe("Package 2.2 runtime composition (FR-SI-02, FR-GC-04/05, C-02)", () => {
  it("exposes deterministic injected generation and fails closed when unconfigured", async () => {
    const unconfigured = createPackageV22Runtime({ resolveOwner: async () => "owner" });
    expect(() => unconfigured.generateOverview({ notebook_id: notebook, user_id: "owner", source_revisions: [{ source_id: source, revision: 1 }], output_language: "en-US" })).toThrow(/not configured/);
    const configured = createPackageV22Runtime({ provider, validateScope, getSourceMetadata, model, resolveOwner: async () => "owner" });
    await expect(configured.generateFollowUps({ notebook_id: notebook, user_id: "owner", answer: "Answer", source_revisions: [{ source_id: source, revision: 1 }], output_language: "en-US" })).resolves.toMatchObject({ suggested_followups: ["What evidence?"] });
    await expect(configured.onSourceReady({ notebook_id: notebook, source_id: source, revision_id: 1 })).resolves.toMatchObject({ status: "GuideReady" });
    const guideStarted = new Promise<void>((resolve) => { provider.getScopedContext = vi.fn(async () => { resolve(); return [{ chunk_id: chunk, text: "Evidence", source_id: source, revision: 1, token_count: 2, locator: { page_number: 1, start_offset: 0, end_offset: 8 } }]; }); });
    const pipeline = new IngestionPipeline({ onReady: async (ready) => { await configured.onSourceReady({ notebook_id: ready.notebook_id, source_id: ready.source_id, revision_id: ready.revision_id }); } });
    const result = await pipeline.process({ attempt_id: "ready-runtime", notebook_id: notebook, source_id: source, revision_id: 1, media_type: "copied_text", content: "Evidence source text." });
    expect(result.status).toBe("Ready");
    await guideStarted;
  });
});
