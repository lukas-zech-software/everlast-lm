import type {
  DataTableExportFormat,
  DataTableSchemaId,
  FlashcardCountInput,
  GradeQuizQuestionResponse,
  InfographicExportFormat,
  InfographicStyle,
  LearningItemOutcome,
  LearningProgressDto,
  MindmapExportFormat,
  PedagogyDifficulty,
  ReportSuggestionsResult,
  SlideDeckExportFormat,
  StudioArtifact,
  StudioDrilldownResponse,
  StudioExplainResponse,
  StudioInfographicExportScene,
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
    }
  | {
      plugin_type: "flashcards";
      subtype: "default";
      active_source_ids: string[];
      difficulty?: PedagogyDifficulty;
      card_count?: FlashcardCountInput;
      focus_prompt?: string;
      output_language?: string;
    }
  | {
      plugin_type: "quiz";
      subtype: "default";
      active_source_ids: string[];
      question_count?: number;
      difficulty?: PedagogyDifficulty;
      focus_prompt?: string;
      output_language?: string;
    }
  | {
      plugin_type: "learning_overview";
      subtype: "default";
      active_source_ids: string[];
      section_count?: number;
      focus_prompt?: string;
      output_language?: string;
    }
  | {
      plugin_type: "slide_deck";
      subtype: "default";
      active_source_ids: string[];
      slide_count?: number;
      focus_prompt?: string;
      output_language?: string;
    }
  | {
      plugin_type: "infographic";
      subtype: "default";
      active_source_ids: string[];
      style?: InfographicStyle;
      focus_prompt?: string;
      output_language?: string;
    };

export interface BinaryExportResult {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}

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
  exportDataTable?(id: string, body: { format: DataTableExportFormat; ordered_row_ids: string[] }): Promise<BinaryExportResult>;
  exportSlideDeck?(id: string, body: { format: SlideDeckExportFormat }): Promise<BinaryExportResult>;
  exportInfographic?(id: string, body: { format: InfographicExportFormat }): Promise<StudioInfographicExportScene>;
  getProgress?(id: string): Promise<{ progress: LearningProgressDto }>;
  recordProgress?(id: string, body: { item_id: string; outcome: LearningItemOutcome }): Promise<{ progress: LearningProgressDto }>;
  resetProgress?(id: string): Promise<{ progress: LearningProgressDto }>;
  gradeQuiz?(id: string, body: { question_id: string; answer: string | string[] }): Promise<GradeQuizQuestionResponse>;
  explainItem?(
    id: string,
    body: { item_id: string; item_kind?: "flashcard" | "quiz_question"; active_source_ids: string[] }
  ): Promise<StudioExplainResponse>;
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
  const fetchBinaryExport = async (
    id: string,
    body: unknown,
    fallbackContentType: string,
    fallbackFilename: string
  ): Promise<BinaryExportResult> => {
    const res = await opts.fetch(root + `/artifacts/${enc(id)}/export`, {
      method: "POST",
      headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } };
      throw new StudioApiError(res.status, data.error?.code ?? "Error", data.error?.message ?? "Export failed");
    }
    const contentType = res.headers?.get?.("content-type") ?? fallbackContentType;
    const disposition = res.headers?.get?.("content-disposition") ?? "";
    const filenameMatch = /filename="?([^";]+)"?/i.exec(disposition);
    const filename = filenameMatch?.[1] ?? fallbackFilename;
    let bytes: Uint8Array;
    if (typeof res.arrayBuffer === "function") {
      bytes = new Uint8Array(await res.arrayBuffer());
    } else if (typeof res.text === "function") {
      bytes = new TextEncoder().encode(await res.text());
    } else {
      bytes = new Uint8Array();
    }
    return { bytes, contentType, filename };
  };
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
    exportInfographic: (id, body) => call(`/artifacts/${enc(id)}/export`, "POST", body),
    getProgress: (id) => call(`/artifacts/${enc(id)}/progress`),
    recordProgress: (id, body) => call(`/artifacts/${enc(id)}/progress`, "POST", body),
    resetProgress: (id) => call(`/artifacts/${enc(id)}/progress/reset`, "POST", { confirm: true }),
    gradeQuiz: (id, body) => call(`/artifacts/${enc(id)}/grade`, "POST", body),
    explainItem: (id, body) => call(`/artifacts/${enc(id)}/explain`, "POST", body),
    exportDataTable: (id, body) =>
      fetchBinaryExport(
        id,
        body,
        body.format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        `data-table.${body.format}`
      ),
    exportSlideDeck: (id, body) =>
      fetchBinaryExport(
        id,
        body,
        body.format === "pptx"
          ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
          : "application/pdf",
        `slide-deck.${body.format}`
      ),
  };
}
