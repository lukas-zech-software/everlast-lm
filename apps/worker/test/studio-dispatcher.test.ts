import { describe, it, expect } from "vitest";
import { InlineStudioDispatcher } from "../src/studio/dispatcher.js";

describe("InlineStudioDispatcher (FR-006, C-03)", () => {
  it("returns before generation finishes and contains runner errors", async () => {
    let finished = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const d = new InlineStudioDispatcher({ run: async () => (await gate, (finished = true), undefined as never) });
    await d.enqueue("a", "o");
    expect(finished).toBe(false);
    release();
    await d.idle();
    expect(finished).toBe(true);
    const bad = new InlineStudioDispatcher({ run: async () => { throw new Error("boom"); } });
    await expect(bad.enqueue("a", "o")).resolves.toBeUndefined();
    await expect(bad.idle()).resolves.toBeUndefined();
  });
});
