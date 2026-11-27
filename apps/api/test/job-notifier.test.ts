import { describe, expect, it } from "vitest";
import { createJobNotifier } from "../src/server.ts";

/** Grill F22, FR-SI-01: a Cloud Run API without a worker URL fails at startup instead of never ingesting. */
describe("FR-SI-01 job notifier configuration", () => {
  it("CFG-01 createJobNotifier throws on Cloud Run without a worker URL", () => {
    expect(() => createJobNotifier({ K_SERVICE: "everlast-dev-api" })).toThrow(/WORKER_URL/);
  });

  it("CFG-02 createJobNotifier stays a no-op locally", () => {
    const notify = createJobNotifier({});
    expect(() => notify()).not.toThrow();
  });
});
