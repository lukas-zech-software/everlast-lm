import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { logFailure } from "../src/log.ts";

/** Grill F5, NFR-SEC-01: one structured, cause-bearing line per failure; IDs only in context. */
describe("NFR-SEC-01 logFailure", () => {
  let spy: MockInstance<typeof console.error>;
  const line = (call = 0): Record<string, unknown> =>
    JSON.parse(String(spy.mock.calls[call]?.[0])) as Record<string, unknown>;

  beforeEach(() => {
    spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => spy.mockRestore());

  it("LOG-01 emits one JSON line with scope, context, error name and message", () => {
    logFailure("studio.run", { artifact_id: "a1" }, new TypeError("boom"));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(line()).toMatchObject({
      severity: "ERROR",
      message: "studio.run failed",
      scope: "studio.run",
      artifact_id: "a1",
      error_name: "TypeError",
      error_message: "boom",
    });
    expect(typeof line().stack).toBe("string");
  });

  it("LOG-02 caps error_message at 500 characters and stack at 2000", () => {
    logFailure("x", {}, new Error("x".repeat(600)));
    expect(String(line().error_message)).toHaveLength(500);
    expect(String(line().stack).length).toBeLessThanOrEqual(2000);
  });

  it("LOG-03 reads upstream_status from status, response.status or a numeric code", () => {
    logFailure("x", {}, Object.assign(new Error("q"), { status: 429 }));
    logFailure("x", {}, Object.assign(new Error("q"), { response: { status: 503 } }));
    logFailure("x", {}, Object.assign(new Error("q"), { code: 14 }));
    logFailure("x", {}, Object.assign(new Error("q"), { code: "ECONNRESET" }));
    expect([0, 1, 2, 3].map((i) => line(i).upstream_status)).toEqual([429, 503, 14, null]);
  });

  it("LOG-04 includes the cause", () => {
    logFailure("x", {}, new Error("outer", { cause: new Error("pg timeout") }));
    expect(line()).toMatchObject({ cause_name: "Error", cause_message: "pg timeout" });
  });

  it("LOG-05 accepts non-Error values", () => {
    logFailure("x", {}, "plain");
    expect(line()).toMatchObject({ error_name: "NonError", error_message: "plain", stack: null });
  });

  it("LOG-06 passes WARNING through", () => {
    logFailure("x", {}, new Error("w"), "WARNING");
    expect(line().severity).toBe("WARNING");
  });

  it("LOG-08 the stack carries frames only, never the message", () => {
    logFailure("x", {}, new Error(`SECRET-DOC-TITLE ${"x".repeat(600)}`));
    expect(String(line().stack)).not.toContain("SECRET-DOC-TITLE");
    expect(String(line().stack)).toMatch(/^\s+at /);
  });

  it("LOG-09 messages: 'none' also drops the cause message", () => {
    logFailure("x", {}, new TypeError("outer", { cause: new Error("quoted content") }), "ERROR", {
      messages: "none",
    });
    expect(line()).toMatchObject({
      error_name: "TypeError",
      error_message: null,
      cause_name: "Error",
      cause_message: null,
    });
  });

  it("LOG-11 a message that imitates stack frames never leaks into the stack", () => {
    const err = new Error("lead\n    at SECRET-FRAME (doc.txt:1:1)\ntail SECRET-TAIL");
    logFailure("x", {}, err, "ERROR", { messages: "none" });
    const stack = String(line().stack);
    expect(stack).not.toContain("SECRET");
    expect(stack).toMatch(/^\s+at /);
  });

  it("LOG-12 a stack whose header does not match the error is dropped", () => {
    const err = new Error("visible");
    err.stack = "Forged: SECRET-HEADER\n    at f (x.ts:1:1)";
    logFailure("x", {}, err);
    expect(line().stack).toBeNull();
  });

  it("LOG-10 messages: 'none' logs names and status only", () => {
    logFailure(
      "x",
      {},
      Object.assign(new Error("Command failed: ffmpeg\nMetadata: title=SECRET"), { status: 1 }),
      "ERROR",
      { messages: "none" },
    );
    expect(line()).toMatchObject({ error_name: "Error", error_message: null, upstream_status: 1 });
    expect(JSON.stringify(line())).not.toContain("SECRET");
  });

  it("LOG-07 context cannot override reserved fields", () => {
    logFailure("x", { severity: "INFO", scope: "evil" }, new Error("r"));
    expect(line()).toMatchObject({ severity: "ERROR", scope: "x" });
  });
});
