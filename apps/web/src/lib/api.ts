/**
 * Authenticated API client (FR-WM-04). Every /api call carries `Authorization: Bearer <ID token>`; a 401 sends
 * the user to sign-in. Errors surface the server's stable `{error:{code,message}}` envelope.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export interface TokenProvider {
  getIdToken(): Promise<string | null>;
  onUnauthenticated(): void;
}

let tokens: TokenProvider | null = null;

export function setTokenProvider(provider: TokenProvider): void {
  tokens = provider;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await tokens?.getIdToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    return new ApiError(res.status, body.error?.code ?? "Error", body.error?.message ?? res.statusText);
  } catch {
    return new ApiError(res.status, "Error", res.statusText);
  }
}

export async function api<T>(path: string, init: { method?: string; json?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(await authHeaders()), ...init.headers };
  let body: string | undefined;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { method: init.method ?? "GET", headers, ...(body !== undefined ? { body } : {}) });
  if (res.status === 401) {
    tokens?.onUnauthenticated();
    throw await toError(res);
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** `fetch` with the caller's bearer token, for controllers that take a fetcher (release v2 UI). */
export const authFetch: typeof fetch = async (input, init = {}) => {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(await authHeaders())) headers.set(name, value);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) tokens?.onUnauthenticated();
  return res;
};

export interface SseEvent {
  event: string;
  data: unknown;
}

/** POSTs JSON and yields Server-Sent Events (used for chat turns). */
export async function* postEventStream(path: string, json: unknown, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const res = await fetch(path, {
    method: "POST",
    headers: { ...(await authHeaders()), "content-type": "application/json" },
    body: JSON.stringify(json),
    ...(signal ? { signal } : {}),
  });
  if (res.status === 401) tokens?.onUnauthenticated();
  if (!res.ok) throw await toError(res);
  if (!res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let index;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (event && data) yield { event, data: JSON.parse(data) };
    }
  }
}
