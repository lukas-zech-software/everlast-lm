import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Native Node HTTP request adapter helpers.
 * Interface stub for test compilation before T020 implementation.
 */

export interface JsonRequestOptions {
  maxBytes?: number;
}

export async function parseJsonBody<T>(
  req: IncomingMessage,
  options?: JsonRequestOptions
): Promise<T> {
  const maxBytes = options?.maxBytes ?? 1_000_000;
  return new Promise<T>((resolve, reject) => {
    let bytesReceived = 0;
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => {
      bytesReceived += chunk.length;
      if (bytesReceived > maxBytes) {
        req.destroy();
        reject(new Error(`Request body exceeded maxBytes limit of ${maxBytes}`));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const bodyStr = Buffer.concat(chunks).toString("utf8").trim();
      if (!bodyStr) {
        resolve({} as T);
        return;
      }
      try {
        const parsed = JSON.parse(bodyStr);
        resolve(parsed);
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", (err) => {
      reject(err);
    });
  });
}

export function sendJson(
  res: ServerResponse,
  statusCode: number,
  data: unknown
): void {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}
