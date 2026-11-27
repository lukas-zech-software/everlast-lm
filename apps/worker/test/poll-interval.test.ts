import { describe, expect, it } from "vitest";
import { readPollIntervalMs } from "../src/server.ts";

/** Grill F22, FR-SI-01: a typo in WORKER_POLL_MS must not turn the outbox poll into a 1 ms loop. */
describe("FR-SI-01 worker poll interval", () => {
  it("CFG-05 readPollIntervalMs validates WORKER_POLL_MS", () => {
    expect(readPollIntervalMs({})).toBe(5000);
    expect(readPollIntervalMs({ WORKER_POLL_MS: "250" })).toBe(250);
    for (const bad of ["abc", "0", "1.5"])
      expect(() => readPollIntervalMs({ WORKER_POLL_MS: bad })).toThrow(/positive integer/);
  });
});
