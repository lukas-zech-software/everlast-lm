import { describe, it, expect, beforeEach } from "vitest";
import {
  StudioPluginRegistry,
  type StudioGenerationContext,
  type StudioGenerationOutcome,
  type StudioGeneratorPlugin,
} from "@everlast/contracts";
import { InMemoryStudioArtifactRepository } from "@everlast/db";
import { StudioJobRunner } from "../src/studio/runner.ts";
import {
  FakeAccess,
  FakeScopedContext,
  NB,
  OWNER,
  SRC_HISTORY,
  SRC_UNSELECTED,
  SRC_TECH,
  historyChunks,
  techChunks,
  unselectedChunks,
} from "./studio-fixtures.ts";

function fixture(generate: (ctx: StudioGenerationContext) => Promise<StudioGenerationOutcome>) {
  const repo = new InMemoryStudioArtifactRepository();
  const registry = new StudioPluginRegistry();
  const plugin: StudioGeneratorPlugin = {
    manifest: { plugin_type: "report", display_name: "Reports", subtypes: ["briefing_doc"] },
    triggerJob: () => ({ title: "Briefing doc", params_json: {} }),
    generate,
  };
  registry.register(plugin);
  const chunks = [...historyChunks(), ...techChunks(), ...unselectedChunks()];
  const scoped = new FakeScopedContext(chunks);
  const access = new FakeAccess(new Map([[SRC_HISTORY, 1], [SRC_TECH, 1], [SRC_UNSELECTED, 1]]));
  const runner = new StudioJobRunner({ repo, registry, scopedContext: scoped, access });
  const queue = (ids = [SRC_HISTORY, SRC_TECH]) =>
    repo.createQueued({
      notebook_id: NB,
      owner_id: OWNER,
      subtype: "briefing_doc",
      title: "Briefing doc",
      params_json: {},
      snapshot: ids.map((source_id) => ({ source_id, revision: 1 })),
    });
  return { repo, runner, scoped, access, queue, chunks };
}

const BRIEFING_KEYS = ["executive_summary", "core_themes", "key_takeaways", "quotes"];
const goodOutcome = (ctx: StudioGenerationContext) => {
  const c = ctx.chunks[0]!;
  return {
    status: "completed" as const,
    payload: {
      content_md: ["# Briefing", ...BRIEFING_KEYS.map((key) => `## ${key}\n\n- A supported point. [1]`)].join("\n\n"),
      citations: [{ badge_number: 1, chunk_id: c.chunk_id, source_id: c.source_id, revision: c.revision, snippet: c.text.slice(0, 20) }],
      sections: BRIEFING_KEYS.map((key) => ({ key, heading: key })),
    },
  };
};

describe("C-03 StudioJobRunner lifecycle (FR-ST-10)", () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => {
    f = fixture(async (ctx) => goodOutcome(ctx));
  });

  it("runs Queued → Running → Completed reading only via C-02 with explicit IDs", async () => {
    const a = await f.queue();
    const done = await f.runner.run(a.id);
    expect(done.status).toBe("Completed");
    expect(done.payload_json?.citations).toHaveLength(1);
    expect(f.scoped.calls).toEqual([{ notebook_id: NB, ids: [SRC_HISTORY, SRC_TECH] }]);
  });

  it("re-verifies access before reading and again before publishing", async () => {
    const a = await f.queue();
    await f.runner.run(a.id);
    expect(f.access.verifyCalls).toHaveLength(2);
  });

  it("fails with a source-changed explanation and publishes nothing when a revision is replaced", async () => {
    const a = await f.queue();
    f.access.revisions.set(SRC_HISTORY, 2);
    const failed = await f.runner.run(a.id);
    expect(failed.status).toBe("Failed");
    expect(failed.failure?.code).toBe("SourceChanged");
    expect(failed.failure?.message).toMatch(/replaced/);
    expect(failed.payload_json).toBeNull();
  });

  it("fails when the source is replaced between reading and publishing", async () => {
    const a = await f.queue();
    f.access.onVerify = (call) => {
      if (call === 1) f.access.revisions.set(SRC_TECH, 2);
    };
    // First verification passes (set after), second sees revision 2.
    const failed = await f.runner.run(a.id);
    expect(failed.status).toBe("Failed");
    expect(failed.failure?.code).toBe("SourceChanged");
    expect(failed.payload_json).toBeNull();
  });

  it("fails with Unauthorized when access is revoked", async () => {
    const a = await f.queue();
    f.access.revoked = true;
    const failed = await f.runner.run(a.id);
    expect(failed.failure?.code).toBe("Unauthorized");
  });

  it("fails if the scoped context returns a chunk at a different revision than the snapshot", async () => {
    const a = await f.queue();
    f.scoped.chunks = f.scoped.chunks.map((c) => (c.source_id === SRC_TECH ? { ...c, revision: 2 } : c));
    const failed = await f.runner.run(a.id);
    expect(failed.failure?.code).toBe("SourceChanged");
  });

  it("fails if a chunk from an unselected source leaks into the context (NFR-EVAL-04)", async () => {
    const a = await f.queue();
    f.scoped.getScopedContext = async () => f.chunks;
    const failed = await f.runner.run(a.id);
    expect(failed.status).toBe("Failed");
    expect(failed.failure?.code).toBe("CitationValidationFailed");
  });

  it("fails with a refusal when a citation does not resolve to a scoped chunk and publishes no draft", async () => {
    const g = fixture(async (ctx) => {
      const out = goodOutcome(ctx);
      if (out.status === "completed") out.payload.citations[0]!.chunk_id = "01890000-0000-7000-8000-999999999999";
      return out;
    });
    const a = await g.queue();
    const failed = await g.runner.run(a.id);
    expect(failed.status).toBe("Failed");
    expect(failed.failure?.code).toBe("CitationValidationFailed");
    expect(failed.payload_json).toBeNull();
  });

  it("rejects payloads whose citation belongs to an unselected source", async () => {
    const g = fixture(async (ctx) => {
      const leaked = g.chunks.find((c) => c.source_id === SRC_UNSELECTED)!;
      const out = goodOutcome(ctx);
      if (out.status === "completed") {
        out.payload.citations[0] = { badge_number: 1, chunk_id: leaked.chunk_id, source_id: leaked.source_id, revision: 1, snippet: "The Zorblax" };
      }
      return out;
    });
    const a = await g.queue();
    expect((await g.runner.run(a.id)).failure?.code).toBe("CitationValidationFailed");
  });

  it("rejects markdown with dangling or missing citation markers", async () => {
    const g = fixture(async (ctx) => {
      const out = goodOutcome(ctx);
      if (out.status === "completed") out.payload.content_md = "# Briefing without markers";
      return out;
    });
    const a = await g.queue();
    expect((await g.runner.run(a.id)).failure?.code).toBe("CitationValidationFailed");
  });

  it("maps plugin refusals to Failed with the plugin's code and no payload", async () => {
    const g = fixture(async () => ({ status: "refused", code: "InsufficientEvidence", message: "No supported content." }));
    const a = await g.queue();
    const failed = await g.runner.run(a.id);
    expect(failed.failure).toEqual({ code: "InsufficientEvidence", message: "No supported content." });
  });

  it("maps plugin crashes to GenerationError without leaking internals", async () => {
    const g = fixture(async () => {
      throw new Error("secret stack detail");
    });
    const a = await g.queue();
    const failed = await g.runner.run(a.id);
    expect(failed.failure?.code).toBe("GenerationError");
    expect(failed.failure?.message).not.toMatch(/secret/);
  });

  it("does not publish after cancellation while running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const g = fixture(async (ctx) => {
      await gate;
      return goodOutcome(ctx);
    });
    const a = await g.queue();
    const running = g.runner.run(a.id);
    await new Promise((r) => setTimeout(r, 5));
    await g.runner.cancel(a.id);
    release();
    const result = await running;
    expect(result.status).toBe("Cancelled");
    expect(result.payload_json).toBeNull();
  });

  it("cancels a queued job and never runs it", async () => {
    const a = await f.queue();
    await f.runner.cancel(a.id);
    const result = await f.runner.run(a.id);
    expect(result.status).toBe("Cancelled");
    expect(f.scoped.calls).toHaveLength(0);
  });
});
