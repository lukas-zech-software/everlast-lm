import type {
  DataTableExportFormat,
  DataTableSchemaId,
  MindmapExportFormat,
  ReportSuggestionsResult,
  StudioArtifact,
  StudioDrilldownResponse,
  StudioMindmapExportScene,
} from "@everlast/contracts";

export type ArtifactDto = StudioArtifact;

export type CreateBody =
  | {
      plugin_type: "report";
      subtype: "briefing_doc" | "study_guide" | "faq" | "timeline" | "dynamic" | "custom";
      active_source_ids: string[];
      custom_prompt?: string;
      output_language?: string;
    }
  | {
      plugin_type: "mindmap";
      subtype: "default";
      active_source_ids: string[];
      output_language?: string;
    }
  | {
      plugin_type: "data_table";
      subtype: "default";
      active_source_ids: string[];
      focus_prompt?: string;
      schema_id?: DataTableSchemaId;
      output_language?: string;
    };

export interface StudioApi {
  list(): Promise<ArtifactDto[]>;
  get(id: string): Promise<{ artifact: ArtifactDto; unavailable?: { code: string; message: string } }>;
  create(body: CreateBody): Promise<ArtifactDto>;
  cancel?(id: string): Promise<ArtifactDto>;
  retry(id: string, activeSourceIds: string[]): Promise<ArtifactDto>;
  convert(id: string): Promise<{ source_id: string }>;
  remove(id: string): Promise<void>;
  suggestions(activeSourceIds: string[], outputLanguage?: string): Promise<ReportSuggestionsResult>;
  exportMindmap?(id: string, body: { format: MindmapExportFormat; expanded_node_ids: string[] }): Promise<StudioMindmapExportScene>;
  drilldownMindmap?(id: string, body: { node_id: string; active_source_ids: string[] }): Promise<StudioDrilldownResponse>;
  exportDataTable?(id: string, body: { format: DataTableExportFormat; ordered_row_ids: string[] }): Promise<{
    bytes: Uint8Array;
    contentType: string;
    filename: string;
  }>;
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
  headers?: { get?(name: string): string | null };
  json(): Promise<unknown>;
  arrayBuffer?(): Promise<ArrayBuffer>;
  text?(): Promise<string>;
}>;

/**
 * Studio HTTP client (FR-ST-08/09/10/11/18). `token` is optional: the workspace passes `authFetch`, which adds the
 * caller's bearer token itself. Every create, retry, drilldown and suggestions call carries the caller's explicit scope.
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
    cancel: async (id) => (await call<{ artifact: ArtifactDto }>(`/artifacts/${enc(id)}/cancel`, "POST", {})).artifact,
    retry: async (id, ids) => (await call<{ artifact: ArtifactDto }>(`/artifacts/${enc(id)}/retry`, "POST", { active_source_ids: ids })).artifact,
    convert: (id) => call(`/artifacts/${enc(id)}/convert-to-source`, "POST", {}),
    remove: (id) => call(`/artifacts/${enc(id)}`, "DELETE"),
    suggestions: (ids, lang) =>
      call("/report-suggestions", "POST", { active_source_ids: ids, ...(lang ? { output_language: lang } : {}) }),
    exportMindmap: (id, body) => call(`/artifacts/${enc(id)}/export`, "POST", body),
    drilldownMindmap: (id, body) => call(`/artifacts/${enc(id)}/drilldown`, "POST", body),
    exportDataTable: async (id, body) => {
      const res = await opts.fetch(root + `/artifacts/${enc(id)}/export`, {
        method: "POST",
        headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } };
        throw new StudioApiError(res.status, data.error?.code ?? "Error", data.error?.message ?? "Export failed");
      }
      const contentType = res.headers?.get?.("content-type") ?? (body.format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      const disposition = res.headers?.get?.("content-disposition") ?? "";
      const filenameMatch = /filename="?([^";]+)"?/i.exec(disposition);
      const filename = filenameMatch?.[1] ?? `data-table.${body.format}`;
      let bytes: Uint8Array;
      if (typeof res.arrayBuffer === "function") {
        bytes = new Uint8Array(await res.arrayBuffer());
      } else if (typeof res.text === "function") {
        bytes = new TextEncoder().encode(await res.text());
      } else {
        bytes = new Uint8Array();
      }
      return { bytes, contentType, filename };
    },
  };
}
