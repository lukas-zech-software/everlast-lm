import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSourceGuide, resetPackageV22Store } from "@everlast/db";
import { createPackageV22Runtime } from "../../src/source-guides/package-v2-2-runtime.ts";
import type { StructuredGenerationClient } from "../../src/source-guides/package-v2-2.ts";
import { createReadySourceDispatcher } from "../../src/source-guides/ready-hooks.ts";
import type { ScopedContextEnvelope, ScopedContextProvider } from "@everlast/contracts";
import { allowV2MemoryStores } from "@everlast/db";

// TEST-ONLY: this DB-free suite exercises the in-memory v2 double (D16, grill F8a).
allowV2MemoryStores();

const notebook = "11111111-1111-4111-8111-111111111111";
const source = "22222222-2222-4222-8222-222222222222";
const chunk = "018f6b40-0001-7000-8000-000000000001";
const provider: ScopedContextProvider = {
  getScopedContext: vi.fn(() =>
    Promise.resolve([
      {
        chunk_id: chunk,
        text: "Evidence",
        source_id: source,
        revision: 1,
        token_count: 2,
        locator: { page_number: 1, start_offset: 0, end_offset: 8 },
      },
    ]),
  ),
};
const validateScope = (_userId: string, request: ScopedContextEnvelope) =>
  Promise.resolve({ snapshot: request.source_revisions ?? [] });
const getSourceMetadata = () =>
  Promise.resolve([{ source_id: source, revision: 1, title: "Brief", word_count: 50 }]);
const model: StructuredGenerationClient = {
  generateSourceGuide: () =>
    Promise.resolve({
      summary_md: "Summary",
      key_topics: ["one", "two", "three", "four", "five"],
      supporting_chunk_ids: [chunk],
    }),
  generateOverview: () =>
    Promise.resolve({
      overview_md: "Overview",
      starter_prompts: ["one", "two", "three"],
      supporting_chunk_ids: [chunk],
    }),
  generateFollowUps: () =>
    Promise.resolve({
      suggested_followups: [{ text: "What evidence?", supporting_chunk_ids: [chunk] }],
    }),
};

describe("Package 2.2 runtime composition (FR-SI-02, FR-GC-04/05, C-02)", () => {
  it("exposes deterministic injected generation and fails closed when unconfigured", async () => {
    const unconfigured = createPackageV22Runtime({
      resolveOwner: () => Promise.resolve("owner"),
    });
    expect(() =>
      unconfigured.generateOverview({
        notebook_id: notebook,
        user_id: "owner",
        source_revisions: [{ source_id: source, revision: 1 }],
        output_language: "en-US",
      }),
    ).toThrow(/not configured/);
    const configured = createPackageV22Runtime({
      provider,
      validateScope,
      getSourceMetadata,
      model,
      resolveOwner: () => Promise.resolve("owner"),
    });
    await expect(
      configured.generateFollowUps({
        notebook_id: notebook,
        user_id: "owner",
        answer: "Answer",
        source_revisions: [{ source_id: source, revision: 1 }],
        output_language: "en-US",
      }),
    ).resolves.toMatchObject({ suggested_followups: [{ text: "What evidence?" }] });
    await expect(
      configured.onSourceReady({ notebook_id: notebook, source_id: source, revision_id: 1 }),
    ).resolves.toMatchObject({ status: "GuideReady" });
    const guideStarted = new Promise<void>((resolve) => {
      provider.getScopedContext = vi.fn(() => {
        resolve();
        return Promise.resolve([
          {
            chunk_id: chunk,
            text: "Evidence",
            source_id: source,
            revision: 1,
            token_count: 2,
            locator: { page_number: 1, start_offset: 0, end_offset: 8 },
          },
        ]);
      });
    });
    const dispatch = createReadySourceDispatcher([(ready) => configured.onSourceReady(ready)]);
    await dispatch({
      notebook_id: notebook,
      source_id: source,
      revision_id: 1,
      title: "Evidence",
      media_type: "copied_text",
    });
    await guideStarted;
  });
});

describe("Package 2.2 runtime output language (FR-SI-02, FR-GC-05, FR-UI-02)", () => {
  beforeEach(() => resetPackageV22Store());
  it("generates Ready-source guides and follow-ups in the notebook's effective output language, not en-US", async () => {
    const seen: string[] = [];
    const languageModel: StructuredGenerationClient = {
      ...model,
      generateSourceGuide: (input) => {
        seen.push(`guide:${input.output_language}`);
        return model.generateSourceGuide(input);
      },
      generateFollowUps: (input) => {
        seen.push(`followups:${input.output_language}`);
        return model.generateFollowUps(input);
      },
    };
    const resolveOutputLanguage = vi.fn(() => Promise.resolve("de-DE"));
    const runtime = createPackageV22Runtime({
      provider,
      validateScope,
      getSourceMetadata,
      model: languageModel,
      resolveOwner: () => Promise.resolve("owner"),
      resolveOutputLanguage,
    });
    const guide = await runtime.onSourceReady({
      notebook_id: notebook,
      source_id: source,
      revision_id: 1,
    });
    expect(guide.output_language).toBe("de-DE");
    expect(resolveOutputLanguage).toHaveBeenCalledWith(notebook, "owner");
    expect(await getSourceGuide(notebook, source, 1, "de-DE")).toMatchObject({
      status: "GuideReady",
    });
    expect(await getSourceGuide(notebook, source, 1, "en-US")).toBeNull();
    const followups = await runtime.generateFollowUps({
      notebook_id: notebook,
      user_id: "owner",
      answer: "Answer",
      source_revisions: [{ source_id: source, revision: 1 }],
    });
    expect(followups.output_language).toBe("de-DE");
    expect(seen).toEqual(["guide:de-DE", "followups:de-DE"]);
  });
});
