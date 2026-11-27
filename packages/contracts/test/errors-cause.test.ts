import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.ts";

/** Grill F5, NFR-SEC-01: the client body stays generic while logs keep the upstream reason. */
describe("NFR-SEC-01 AppError cause", () => {
  it("AppError keeps its cause", () => {
    const inner = new Error("Vertex 403");
    expect(new AppError("RetryableFailure", 503, "m", { cause: inner }).cause).toBe(inner);
  });
});
