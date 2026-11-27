import type { ServerResponse } from "node:http";
import { AppError } from "@everlast/contracts";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { sendError } from "../src/http.ts";

/** Grill F5, NFR-SEC-01: 5xx AppErrors leave a cause-bearing log line; 4xx stay quiet. */
describe("NFR-SEC-01 sendError logging", () => {
  let spy: MockInstance<typeof console.error>;
  const fakeResponse = () =>
    ({ headersSent: false, writeHead: vi.fn(), end: vi.fn() }) as unknown as ServerResponse & {
      writeHead: ReturnType<typeof vi.fn>;
    };

  beforeEach(() => {
    spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => spy.mockRestore());

  it("HTTP-LOG-01 a 5xx AppError is logged with request_id and cause", () => {
    const res = fakeResponse();
    sendError(
      res,
      new AppError("RetryableFailure", 503, "m", { cause: new Error("Vertex 403") }),
      "req-1",
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toMatchObject({
      request_id: "req-1",
      severity: "WARNING",
      cause_message: "Vertex 403",
    });
    expect(res.writeHead.mock.calls[0]?.[0]).toBe(503);
  });

  it("HTTP-LOG-02 a 4xx AppError is not logged", () => {
    sendError(fakeResponse(), new AppError("NotFound", 404, "Resource not found"), "req-2");
    expect(spy).not.toHaveBeenCalled();
  });
});
