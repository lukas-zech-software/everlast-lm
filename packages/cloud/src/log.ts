/**
 * Structured failure log (grill F5, NFR-SEC-01). One JSON line on stderr that Cloud Logging parses by `severity`.
 * Context carries IDs, counts and enums only — never prompt, source, chunk or document content.
 */
export type FailureSeverity = "WARNING" | "ERROR";
export type FailureContext = Readonly<Record<string, string | number | boolean | null | undefined>>;

const MAX_MESSAGE = 500;
const MAX_STACK = 2000;

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  status?: unknown;
  code?: unknown;
  response?: unknown;
  cause?: unknown;
}

const asRecord = (value: unknown): ErrorLike | null =>
  typeof value === "object" && value !== null ? value : null;

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
    return String(value);
  if (value === undefined || value === null) return "";
  try {
    // JSON.stringify returns undefined for functions and symbols despite its lib typing.
    const json = JSON.stringify(value) as string | undefined;
    return json ?? "";
  } catch {
    return "";
  }
}

function upstreamStatus(err: ErrorLike): number | null {
  for (const value of [err.status, asRecord(err.response)?.status, err.code]) {
    if (typeof value === "number") return value;
  }
  return null;
}

/**
 * Which error messages may be logged. `all` (default) suits our own and upstream API errors; `internal` keeps
 * only engine errors (TypeError, RangeError, ReferenceError), whose messages describe code, not data — use it
 * where errors may quote model or source text; `none` logs names and status only (for example converter stderr).
 */
export type FailureMessagePolicy = "all" | "internal" | "none";
export interface FailureLogOptions {
  readonly messages?: FailureMessagePolicy;
}

const ENGINE_ERRORS = new Set(["TypeError", "RangeError", "ReferenceError"]);

function messageOf(name: string, text: string, policy: FailureMessagePolicy): string | null {
  if (policy === "none" || (policy === "internal" && !ENGINE_ERRORS.has(name))) return null;
  return text.slice(0, MAX_MESSAGE);
}

/** Stack frames only: V8 stacks start with `name: message`, which would bypass the message cap and policy. */
function framesOf(stack: unknown): string | null {
  if (typeof stack !== "string") return null;
  const start = stack.indexOf("\n    at ");
  return start === -1 ? null : stack.slice(start + 1, start + 1 + MAX_STACK);
}

export function logFailure(
  scope: string,
  context: FailureContext,
  err: unknown,
  severity: FailureSeverity = "ERROR",
  options: FailureLogOptions = {},
): void {
  const policy = options.messages ?? "all";
  const e = asRecord(err);
  const cause = asRecord(e?.cause);
  const errorName = typeof e?.name === "string" ? e.name : "NonError";
  const causeName = typeof cause?.name === "string" ? cause.name : null;
  console.error(
    JSON.stringify({
      ...context,
      severity,
      message: `${scope} failed`,
      scope,
      error_name: errorName,
      error_message: messageOf(errorName, e ? asText(e.message) : asText(err), policy),
      upstream_status: e ? upstreamStatus(e) : null,
      cause_name: causeName,
      cause_message: cause
        ? messageOf(causeName ?? "NonError", asText(cause.message), policy)
        : null,
      stack: framesOf(e?.stack),
    }),
  );
}
