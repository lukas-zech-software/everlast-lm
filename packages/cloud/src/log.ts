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
 * Which error messages may be logged. `all` (default) suits our own and upstream API errors. `none` logs names,
 * status and stack frames only; use it wherever an error may quote model, source or document text (an error's
 * name proves nothing about its message).
 */
export type FailureMessagePolicy = "all" | "none";
export interface FailureLogOptions {
  readonly messages?: FailureMessagePolicy;
}

const FRAME = /^ {4}at \S[^\n]*$/;

function messageOf(text: string, policy: FailureMessagePolicy): string | null {
  return policy === "none" ? null : text.slice(0, MAX_MESSAGE);
}

/**
 * Stack frames only. V8 formats `stack` as `name: message` followed by frame lines, so the exact header is
 * stripped by prefix (never by searching the text, which a message could imitate) and only consecutive
 * frame lines are kept. A stack whose header does not match the error is dropped.
 */
function framesOf(e: ErrorLike | null, name: string): string | null {
  if (typeof e?.stack !== "string") return null;
  const message = asText(e.message);
  const header = message ? `${name}: ${message}` : name;
  if (!e.stack.startsWith(`${header}\n`)) return null;
  const frames: string[] = [];
  for (const frameLine of e.stack.slice(header.length + 1).split("\n")) {
    if (!FRAME.test(frameLine)) break;
    frames.push(frameLine);
  }
  return frames.length > 0 ? frames.join("\n").slice(0, MAX_STACK) : null;
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
      error_message: messageOf(e ? asText(e.message) : asText(err), policy),
      upstream_status: e ? upstreamStatus(e) : null,
      cause_name: causeName,
      cause_message: cause ? messageOf(asText(cause.message), policy) : null,
      stack: framesOf(e, errorName),
    }),
  );
}
