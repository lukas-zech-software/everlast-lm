import type { IncomingMessage, ServerResponse } from "node:http";
import { AppError } from "@everlast/contracts";

/**
 * Native Node HTTP helpers (FR-WM-01, FR-WM-04). Error bodies follow the workspace API contract:
 * `{error:{code,message}, request_id}` with stable codes and no internal details or source content.
 */

export const DEFAULT_JSON_LIMIT = 1_000_000;

export async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > maxBytes) throw new AppError("PayloadTooLarge", 413, `Request body exceeds ${maxBytes} bytes`);
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    received += (chunk as Buffer).length;
    if (received > maxBytes) throw new AppError("PayloadTooLarge", 413, `Request body exceeds ${maxBytes} bytes`);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req: IncomingMessage, maxBytes = DEFAULT_JSON_LIMIT): Promise<unknown> {
  const contentType = req.headers["content-type"] ?? "";
  const body = await readBody(req, maxBytes);
  if (body.length === 0) return {};
  if (!/^application\/json\b/i.test(contentType)) {
    throw new AppError("ValidationFailed", 415, "Content-Type must be application/json");
  }
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new AppError("ValidationFailed", 400, "Malformed JSON body");
  }
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const json = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "Cache-Control": "no-store",
  });
  res.end(json);
}

export function sendNoContent(res: ServerResponse): void {
  res.writeHead(204, { "Cache-Control": "no-store" });
  res.end();
}

export function sendError(res: ServerResponse, err: unknown, requestId: string): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (err instanceof AppError) {
    sendJson(res, err.status, { error: { code: err.code, message: err.message }, request_id: requestId });
    return;
  }
  console.error(JSON.stringify({ severity: "ERROR", request_id: requestId, message: (err as Error)?.stack ?? String(err) }));
  sendJson(res, 500, { error: { code: "InternalError", message: "Internal server error" }, request_id: requestId });
}

export function validationError(message: string): AppError {
  return new AppError("ValidationFailed", 422, message);
}
