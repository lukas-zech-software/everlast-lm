import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { logRenderFailure } from "../src/main.ts";

/** Grill F5 + final review, NFR-SEC-01: converter stderr (file metadata, names) never reaches the logs. */
describe("NFR-SEC-01 render failure log", () => {
  let spy: MockInstance<typeof console.error>;
  beforeEach(() => {
    spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => spy.mockRestore());

  it("LOG-RENDER-01 logs exit code, signal and IDs but no converter output", () => {
    const err = Object.assign(
      new Error("Command failed: ffmpeg -i in.m4a\nMetadata:\n  title: SECRET-DOC-TITLE"),
      { code: 1, signal: null, killed: false, stderr: "title: SECRET-DOC-TITLE" },
    );
    logRenderFailure({ operationId: "op-1", command: "audio-to-flac" }, err);
    const raw = String(spy.mock.calls[0]?.[0]);
    expect(raw).not.toContain("SECRET-DOC-TITLE");
    expect(JSON.parse(raw)).toMatchObject({
      scope: "render.execution",
      operation_id: "op-1",
      command: "audio-to-flac",
      exit_code: 1,
      killed: false,
      error_name: "Error",
      error_message: null,
    });
  });
});
