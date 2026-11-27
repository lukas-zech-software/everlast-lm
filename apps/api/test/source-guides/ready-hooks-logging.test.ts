import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createReadySourceDispatcher } from "../../src/source-guides/ready-hooks.ts";

/** Grill F5, FR-SI-02: a failing Ready hook (Source Guide, topic icon) is logged, never silently swallowed. */
describe("FR-SI-02 Ready hook failures", () => {
  let spy: MockInstance<typeof console.error>;
  beforeEach(() => {
    spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => spy.mockRestore());

  it("LOG-HOOK-01 a failing Ready hook is logged, not swallowed", async () => {
    const dispatch = createReadySourceDispatcher([
      async () => {
        await Promise.resolve();
        throw new Error("guide 429");
      },
    ]);
    await expect(
      dispatch({ notebook_id: "n", source_id: "s", revision_id: 1, title: "t", media_type: "pdf" }),
    ).resolves.toBeUndefined();
    const lines = spy.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);
    expect(lines).toContainEqual(
      expect.objectContaining({ scope: "ready_hook", source_id: "s", error_message: "guide 429" }),
    );
  });
});
