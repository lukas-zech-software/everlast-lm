import type { ReportSuggestionsResult, StudioArtifact } from "@everlast/contracts";

export type ArtifactDto = StudioArtifact;

export interface CreateBody {
  plugin_type: "report";
  subtype: "briefing_doc" | "study_guide" | "faq" | "timeline" | "dynamic" | "custom";
  active_source_ids: string[];
  custom_prompt?: string;
  output_language?: string;
}

export interface StudioApi {
  list(): Promise<ArtifactDto[]>;
  get(id: string): Promise<{ artifact: ArtifactDto; unavailable?: { code: string; message: string } }>;
  create(body: CreateBody): Promise<ArtifactDto>;
  retry(id: string, activeSourceIds: string[]): Promise<ArtifactDto>;
  convert(id: string): Promise<{ source_id: string }>;
  remove(id: string): Promise<void>;
  suggestions(activeSourceIds: string[], outputLanguage?: string): Promise<ReportSuggestionsResult>;
}

export class StudioApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
}>;

/**
 * Studio HTTP client (FR-ST-10, FR-ST-11). `token` is optional: the workspace passes `authFetch`, which adds the
 * caller's bearer token itself. Every create, retry and suggestions call carries the caller's explicit scope.
 */
export function createStudioApi(opts: { notebookId: string; token?: string; fetch: FetchLike; baseUrl?: string }): StudioApi {
  const root = `${opts.baseUrl ?? ""}/api/notebooks/${encodeURIComponent(opts.notebookId)}/studio`;
  const call = async <T>(path: string, method = "GET", body?: unknown): Promise<T> => {
    const res = await opts.fetch(root + path, {
      method,
      headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } };
    if (!res.ok) throw new StudioApiError(res.status, data.error?.code ?? "Error", data.error?.message ?? "Request failed");
    return data as T;
  };
  const enc = encodeURIComponent;
  return {
    list: async () => (await call<{ artifacts: ArtifactDto[] }>("/artifacts")).artifacts,
    get: (id) => call(`/artifacts/${enc(id)}`),
    create: async (b) => (await call<{ artifact: ArtifactDto }>("/artifacts", "POST", b)).artifact,
    retry: async (id, ids) => (await call<{ artifact: ArtifactDto }>(`/artifacts/${enc(id)}/retry`, "POST", { active_source_ids: ids })).artifact,
    convert: (id) => call(`/artifacts/${enc(id)}/convert-to-source`, "POST", {}),
    remove: (id) => call(`/artifacts/${enc(id)}`, "DELETE"),
    suggestions: (ids, lang) =>
      call("/report-suggestions", "POST", { active_source_ids: ids, ...(lang ? { output_language: lang } : {}) }),
  };
}
