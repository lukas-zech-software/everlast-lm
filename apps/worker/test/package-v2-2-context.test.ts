import { describe, expect, it, vi } from "vitest";
import { type ScopedContextProvider, type ScopedContextEnvelope, type SourceRevisionPair } from "@everlast/contracts";
import { createC02PackageV22SourceReader } from "../src/package-v2-2.ts";

const notebook = "11111111-1111-4111-8111-111111111111";
const source = "22222222-2222-4222-8222-222222222222";
const chunkId = "018f6b40-0001-7000-8000-000000000001";
const snapshot: SourceRevisionPair[] = [{ source_id: source, revision: 7 }];

describe("Package 2.2 C-02 source-reader adapter (C-02, NFR-EVAL-04)", () => {
  it("validates owner/snapshot and reads text only through the shared ScopedContextProvider", async () => {
    const provider: ScopedContextProvider = { getScopedContext: vi.fn(async () => [{ chunk_id: chunkId, source_id: source, revision: 7, token_count: 4, text: "Scoped source words", locator: { page_number: 1, start_offset: 0, end_offset: 19 } }]) };
    const validateScope = vi.fn(async (_userId: string, request: ScopedContextEnvelope) => ({ snapshot: request.source_revisions ?? [] }));
    const reader = createC02PackageV22SourceReader({
      provider, validateScope,
      getSourceMetadata: async () => [{ source_id: source, revision: 7, title: "Brief", word_count: 3 }],
    });
    const sources = await reader.readReadySources({ notebook_id: notebook, user_id: "owner", source_revisions: snapshot });
    expect(provider.getScopedContext).toHaveBeenCalledWith(notebook, [source]);
    expect(validateScope).toHaveBeenCalledTimes(2);
    expect(validateScope.mock.calls[0]![1].source_revisions).toEqual(snapshot);
    expect(validateScope.mock.calls[0]![1].principal.subject).toBe("owner");
    expect(sources[0]?.chunks[0]?.text).toBe("Scoped source words");
  });

  it("rejects revision replacement between pre-read authorization and post-read publication check", async () => {
    const provider: ScopedContextProvider = { getScopedContext: vi.fn(async () => [{ chunk_id: chunkId, source_id: source, revision: 7, token_count: 2, text: "Current content", locator: { page_number: 1, start_offset: 0, end_offset: 15 } }]) };
    let checks = 0;
    const reader = createC02PackageV22SourceReader({
      provider,
      validateScope: async () => ({ snapshot: [{ source_id: source, revision: ++checks === 1 ? 7 : 8 }] }),
      getSourceMetadata: async () => [{ source_id: source, revision: 7, title: "Brief", word_count: 3 }],
    });
    await expect(reader.readReadySources({ notebook_id: notebook, user_id: "owner", source_revisions: snapshot })).rejects.toThrow(/stale or unauthorized/);
  });

  it("rejects mismatched authorization/revision snapshots and out-of-scope chunks", async () => {
    const provider: ScopedContextProvider = { getScopedContext: vi.fn(async () => [{ chunk_id: chunkId, source_id: source, revision: 6, token_count: 2, text: "Old content", locator: { page_number: 1, start_offset: 0, end_offset: 12 } }]) };
    const reader = createC02PackageV22SourceReader({
      provider,
      validateScope: async (_userId: string, request: ScopedContextEnvelope) => ({ snapshot: request.source_revisions ?? [] }),
      getSourceMetadata: async () => [{ source_id: source, revision: 7, title: "Brief", word_count: 3 }],
    });
    await expect(reader.readReadySources({ notebook_id: notebook, user_id: "owner", source_revisions: snapshot })).rejects.toThrow(/outside the requested scope/);
  });
});
