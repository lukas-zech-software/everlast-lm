import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportSuggestionsResult } from "@everlast/contracts";
import { createStudioPanel, type StudioPanel } from "../src/studio/panel.ts";
import { setupMockDOM, type MockElement } from "./mock-dom.ts";

/**
 * [008-studio-text-reports] T048 — Studio Right Panel (FR-ST-10, FR-ST-11, FR-001, FR-006, FR-008..FR-012, FR-018,
 * US1/AC3–AC4, US2/AC1–AC7). Reports tile → Create report modal (Create Your Own, four templates, Suggested Format
 * cards with loading/unavailable states), artifact list with generating/failed rows, and the report viewer with
 * citation badges, Copy, Delete (confirmation) and Convert to source. Every request carries the explicit current
 * selection (C-02, no all-sources fallback). v2 has no cancel action (card FR-ST-10).
 */

const NB = "11111111-1111-4111-8111-111111111111";
const SRC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SRC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CHUNK_1 = "01890000-0000-7000-8000-000000000001";
const CHUNK_2 = "01890000-0000-7000-8000-000000000002";
const TITLES: Record<string, string> = {
  briefing_doc: "Briefing doc",
  study_guide: "Study guide",
  faq: "FAQ",
  timeline: "Timeline",
  dynamic: "Custom report",
  custom: "Custom report",
};

interface Row {
  id: string;
  subtype: string;
  status: "Queued" | "Running" | "Completed" | "Failed" | "Cancelled";
  title: string;
  failure: { code: string; message: string } | null;
  payload_json: unknown;
  unavailable?: { code: string; message: string };
}
interface Call {
  method: string;
  path: string;
  body: any;
}

const json = (body: unknown, status = 200) =>
  status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const COMPLETED_PAYLOAD = {
  content_md: [
    "# Briefing doc",
    "",
    "## Executive summary",
    "",
    "- The treaty was signed in 1648. [1]",
    "",
    "## Quotes",
    "",
    "> <script>alert(1)</script> **bold** [2]",
    "",
  ].join("\n"),
  citations: [
    { badge_number: 1, chunk_id: CHUNK_1, source_id: SRC_A, revision: 1, snippet: "The treaty was signed in 1648." },
    { badge_number: 2, chunk_id: CHUNK_2, source_id: SRC_B, revision: 1, snippet: "quote" },
  ],
  sections: [
    { key: "executive_summary", heading: "Executive summary" },
    { key: "quotes", heading: "Quotes" },
  ],
};

function createFakeStudioApi() {
  const rows: Row[] = [];
  const calls: Call[] = [];
  const state = {
    suggestions: [{ state: "SuggestionsUnavailable", reason: "x" }] as (ReportSuggestionsResult | number)[],
    /** Queued → Running → Completed after this many list reads (a background job). */
    stepsToComplete: 2,
    reads: new Map<string, number>(),
  };
  const add = (fields: Partial<Row> & { subtype: string }): Row => {
    const row: Row = { id: randomUUID(), status: "Queued", title: TITLES[fields.subtype] ?? "Report", failure: null, payload_json: null, ...fields };
    rows.push(row);
    return row;
  };
  const dto = (r: Row) => ({
    id: r.id,
    notebook_id: NB,
    plugin_type: "report",
    subtype: r.subtype,
    status: r.status,
    title: r.title,
    params_json: {},
    payload_json: r.status === "Completed" && !r.unavailable ? r.payload_json : null,
    active_source_ids_snapshot: [{ source_id: SRC_A, revision: 1 }],
    output_language: "en-US",
    progress: null,
    failure: r.failure,
    attempt: 1,
    retry_of: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const advance = (r: Row) => {
    if (r.status !== "Queued" && r.status !== "Running") return;
    const n = (state.reads.get(r.id) ?? 0) + 1;
    state.reads.set(r.id, n);
    if (n >= state.stepsToComplete) {
      r.status = "Completed";
      r.payload_json = COMPLETED_PAYLOAD;
    } else r.status = "Running";
  };
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://local");
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname, body });
    const base = `/api/notebooks/${NB}/studio`;
    if (!url.pathname.startsWith(base)) return json({ error: { code: "NotFound", message: "not found" } }, 404);
    const rest = url.pathname.slice(base.length).split("/").filter(Boolean);
    if (rest[0] === "report-suggestions" && method === "POST") {
      const next = state.suggestions.length > 1 ? state.suggestions.shift()! : state.suggestions[0]!;
      if (typeof next === "number") return json({ error: { code: "Unavailable", message: "Generation is not configured." } }, next);
      return json(next);
    }
    if (rest[0] !== "artifacts") return json({ error: { code: "NotFound", message: "not found" } }, 404);
    if (rest.length === 1 && method === "GET") {
      rows.forEach(advance);
      return json({ artifacts: [...rows].reverse().map(dto) });
    }
    if (rest.length === 1 && method === "POST") {
      if (!Array.isArray(body?.active_source_ids) || body.active_source_ids.length === 0) {
        return json({ error: { code: "EmptyScopeError", message: "active_source_ids must contain at least one source UUID." } }, 400);
      }
      return json({ artifact: dto(add({ subtype: body.subtype })) }, 202);
    }
    const row = rows.find((r) => r.id === rest[1]);
    if (!row) return json({ error: { code: "NotFound", message: "Artifact not found." } }, 404);
    if (rest[2] === "retry" && method === "POST") return json({ artifact: dto(add({ subtype: row.subtype })) }, 202);
    if (rest[2] === "convert-to-source" && method === "POST") return json({ source_id: "new-source-id" }, 201);
    if (method === "GET") return json({ artifact: dto(row), ...(row.unavailable ? { unavailable: row.unavailable } : {}) });
    if (method === "DELETE") {
      rows.splice(rows.indexOf(row), 1);
      return json(null, 204);
    }
    return json({ error: { code: "NotFound", message: "not found" } }, 404);
  }) as typeof fetch;
  return { fetcher, rows, calls, state, add };
}

const READY: ReportSuggestionsResult = {
  state: "SuggestionsReady",
  suggestions: [
    { title: "Vendor comparison", description: "Compare the three vendor proposals.", prompt_template: "Compare the vendor proposals on cost and risk." },
    { title: "Risk overview", description: "Summarise the main risks.", prompt_template: "Summarise the main risks of each vendor." },
    { title: "Decision brief", description: "Brief a decision maker.", prompt_template: "Write a decision brief about the vendors." },
  ],
};

let dom: ReturnType<typeof setupMockDOM>;
let api: ReturnType<typeof createFakeStudioApi>;
let panel: StudioPanel;
let selection: string[];
let opened: [string, string][];
let created: string[];
let copied: string[];
let confirmAnswer: boolean;
let confirms: number;

const body = () => dom.document.body as unknown as MockElement;
const q = (sel: string, root: MockElement = body()) => root.querySelector(sel);
const qa = (sel: string, root: MockElement = body()) => root.querySelectorAll(sel);
const tid = (id: string, root?: MockElement) => q(`[data-testid=${id}]`, root);
const tids = (id: string, root?: MockElement) => qa(`[data-testid=${id}]`, root);
const type = (el: MockElement | null, value: string) => {
  el!.value = value;
  el!.dispatchEvent({ type: "input", target: el });
};
const posts = () => api.calls.filter((c) => c.method === "POST" && c.path.endsWith("/artifacts"));
const rowsEl = () => tids("studio-artifact-row");
const template = (subtype: string) => tids("report-template").find((b) => b.getAttribute("data-subtype") === subtype)!;

async function mount(options: { suggestions?: (ReportSuggestionsResult | number)[] } = {}) {
  api = createFakeStudioApi();
  if (options.suggestions) api.state.suggestions = options.suggestions;
  opened = [];
  created = [];
  copied = [];
  confirmAnswer = true;
  confirms = 0;
  panel = createStudioPanel({
    notebookId: NB,
    fetcher: api.fetcher,
    selectedSourceIds: () => [...selection],
    openCitation: (sourceId, chunkId) => void opened.push([sourceId, chunkId]),
    onSourceCreated: (sourceId) => void created.push(sourceId),
    confirm: async () => (confirms++, confirmAnswer),
    notify: () => undefined,
    clipboard: { writeText: async (text) => void copied.push(text) },
    pollMs: 5,
    suggestionPollMs: 5,
    maxSuggestionPolls: 3,
  });
  body().append(panel.element as unknown as MockElement);
  await panel.refresh();
  return panel;
}

async function openModal() {
  tid("studio-reports-tile")!.click();
  await vi.waitFor(() => expect(tid("reports-modal")).not.toBeNull());
}

beforeEach(() => {
  dom = setupMockDOM(1440);
  selection = [SRC_A, SRC_B];
});

describe("T048 FR-001 / FR-012: Reports tile and Create report modal", () => {
  it("the Reports tile opens Create report with Create Your Own and the four templates", async () => {
    await mount();
    expect(tid("studio-panel")).not.toBeNull();
    expect(tid("studio-placeholder")).toBeNull();
    expect(tid("studio-reports-tile")!.textContent).toContain("Reports");
    await openModal();
    expect(tid("reports-modal")!.textContent).toContain("Create report");
    expect(tid("report-create-own")!.textContent).toContain("Create Your Own");
    expect(tids("report-template").map((b) => b.textContent)).toEqual(["Briefing doc", "Study guide", "FAQ", "Timeline"]);
    expect(tids("report-template").map((b) => b.getAttribute("data-subtype"))).toEqual(["briefing_doc", "study_guide", "faq", "timeline"]);
    for (const b of tids("report-template")) expect(b.disabled).toBe(false);
    expect(tid("report-create-own")!.disabled).toBe(false);
  });

  it("with an empty selection every template and Create Your Own is disabled and nothing is sent", async () => {
    selection = [];
    await mount();
    await openModal();
    for (const b of tids("report-template")) expect(b.disabled).toBe(true);
    expect(tid("report-create-own")!.disabled).toBe(true);
    expect(tid("report-scope-hint")!.hidden).toBe(false);
    template("faq").click();
    await new Promise((r) => setTimeout(r, 10));
    expect(posts()).toHaveLength(0);
    // No suggestions request without an explicit scope either (C-02, no all-sources fallback).
    expect(api.calls.some((c) => c.path.endsWith("/report-suggestions"))).toBe(false);
  });

  it("a template sends its subtype with the current selection, closes the modal and lists a generating row", async () => {
    await mount();
    await openModal();
    selection = [SRC_B]; // the selection at click time is what is sent, never a stored or default scope
    panel.updateSourceSelection();
    template("briefing_doc").click();
    await vi.waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toEqual({ plugin_type: "report", subtype: "briefing_doc", active_source_ids: [SRC_B] });
    await vi.waitFor(() => expect(tid("reports-modal")).toBeNull());
    await vi.waitFor(() => expect(rowsEl()).toHaveLength(1));
  });
});

describe("T048 FR-006 / US1/AC3: artifact list lifecycle", () => {
  it("shows 'Generating Briefing doc...' with a generating indicator and refreshes until Completed", async () => {
    await mount();
    api.state.stepsToComplete = Number.POSITIVE_INFINITY; // the job stays Queued/Running until released below
    await openModal();
    template("briefing_doc").click();
    await vi.waitFor(() => expect(rowsEl()).toHaveLength(1));
    const row = rowsEl()[0]!;
    expect(["Queued", "Running"]).toContain(row.getAttribute("data-status"));
    expect(tid("studio-artifact-label", row)!.textContent).toBe("Generating Briefing doc...");
    expect(tid("studio-generating", row)).not.toBeNull();
    await vi.waitFor(() => expect(rowsEl()[0]!.getAttribute("data-status")).toBe("Running"));
    api.state.stepsToComplete = 0;
    await vi.waitFor(() => expect(rowsEl()[0]!.getAttribute("data-status")).toBe("Completed"));
    const done = rowsEl()[0]!;
    expect(tid("studio-artifact-label", done)!.textContent).toBe("Briefing doc");
    expect(tid("studio-generating", done)).toBeNull();
    // v2 has no cancel action (card FR-ST-10).
    expect(tid("studio-cancel")).toBeNull();
    const reads = api.calls.filter((c) => c.method === "GET" && c.path.endsWith("/artifacts")).length;
    await new Promise((r) => setTimeout(r, 30));
    expect(api.calls.filter((c) => c.method === "GET" && c.path.endsWith("/artifacts")).length).toBe(reads); // polling stops at terminal
    panel.destroy();
  });

  it("Failed rows show their explanation and Retry sends the current selection", async () => {
    await mount();
    api.add({ subtype: "timeline", status: "Failed", failure: { code: "SourceChanged", message: "A captured source was deleted." } });
    await panel.refresh();
    const row = rowsEl()[0]!;
    expect(row.getAttribute("data-status")).toBe("Failed");
    expect(tid("studio-artifact-failure", row)!.textContent).toContain("A captured source was deleted.");
    selection = [SRC_A];
    tid("studio-retry", row)!.click();
    await vi.waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/retry"))).toBe(true));
    expect(api.calls.find((c) => c.path.endsWith("/retry"))!.body).toEqual({ active_source_ids: [SRC_A] });
    await vi.waitFor(() => expect(rowsEl()).toHaveLength(2));
    panel.destroy();
  });

  it("Retry is disabled while the selection is empty", async () => {
    await mount();
    api.add({ subtype: "faq", status: "Failed", failure: { code: "InsufficientEvidence", message: "Not enough evidence." } });
    selection = [];
    await panel.refresh();
    expect(tid("studio-retry")!.disabled).toBe(true);
    selection = [SRC_A];
    panel.updateSourceSelection();
    expect(tid("studio-retry")!.disabled).toBe(false);
  });
});

describe("T048 FR-008 / US1/AC4: report viewer", () => {
  async function openCompleted() {
    await mount();
    api.add({ subtype: "briefing_doc", status: "Completed", payload_json: COMPLETED_PAYLOAD });
    await panel.refresh();
    tid("studio-artifact-open", rowsEl()[0]!)!.click();
    await vi.waitFor(() => expect(tid("studio-report-content")).not.toBeNull());
    return tid("studio-report-viewer")!;
  }

  it("renders the section model with stable keys, escaped Markdown and badges that open the Source Inspector", async () => {
    const viewer = await openCompleted();
    expect(tid("studio-report-title", viewer)!.textContent).toBe("Briefing doc");
    const content = tid("studio-report-content", viewer)!;
    const headings = qa("h2", content);
    expect(headings.map((h) => h.getAttribute("data-section-key"))).toEqual(["executive_summary", "quotes"]);
    expect(headings.map((h) => h.textContent)).toEqual(["Executive summary", "Quotes"]);
    expect(qa("script", content)).toHaveLength(0);
    expect(content.textContent).toContain("<script>alert(1)</script>");
    expect(qa("strong", content).map((s) => s.textContent)).toContain("bold");
    const badges = tids("report-citation", content);
    expect(badges.map((b) => b.getAttribute("data-badge"))).toEqual(["1", "2"]);
    badges[1]!.click();
    expect(opened).toEqual([[SRC_B, CHUNK_2]]);
  });

  it("Copy writes the report Markdown to the clipboard", async () => {
    const viewer = await openCompleted();
    tid("studio-copy", viewer)!.click();
    await vi.waitFor(() => expect(copied).toEqual([COMPLETED_PAYLOAD.content_md]));
  });

  it("Delete asks for confirmation: cancel keeps the report, confirm deletes it", async () => {
    const viewer = await openCompleted();
    confirmAnswer = false;
    tid("studio-delete", viewer)!.click();
    await vi.waitFor(() => expect(confirms).toBe(1));
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
    confirmAnswer = true;
    tid("studio-delete", tid("studio-report-viewer")!)!.click();
    await vi.waitFor(() => expect(api.calls.some((c) => c.method === "DELETE")).toBe(true));
    await vi.waitFor(() => expect(tid("studio-report-viewer")).toBeNull());
    expect(rowsEl()).toHaveLength(0);
  });

  it("Convert to source adds the new source to this browser's selection through onSourceCreated", async () => {
    const viewer = await openCompleted();
    tid("studio-convert", viewer)!.click();
    await vi.waitFor(() => expect(created).toEqual(["new-source-id"]));
    expect(api.calls.some((c) => c.path.endsWith("/convert-to-source"))).toBe(true);
    expect(tid("studio-status")!.textContent).toContain("Source created: Briefing doc");
  });

  it("an unavailable report shows the placeholder instead of content", async () => {
    await mount();
    api.add({
      subtype: "faq",
      status: "Completed",
      payload_json: COMPLETED_PAYLOAD,
      unavailable: { code: "SourceChanged", message: "This report is unavailable because its sources changed or are no longer accessible." },
    });
    await panel.refresh();
    tid("studio-artifact-open")!.click();
    await vi.waitFor(() => expect(tid("studio-report-unavailable")).not.toBeNull());
    expect(tid("studio-report-unavailable")!.textContent).toContain("sources changed");
    expect(tid("studio-report-content")).toBeNull();
    expect(tid("studio-convert")).toBeNull();
  });
});

describe("T048 FR-ST-11 / FR-009 / FR-018: Suggested Format", () => {
  it("shows 3–4 cards with title, description and an edit pencil that pre-fills the prompt; Generate sends dynamic", async () => {
    await mount({ suggestions: [READY] });
    await openModal();
    await vi.waitFor(() => expect(tids("report-suggestion")).toHaveLength(3));
    expect(tid("report-suggestions")!.getAttribute("data-state")).toBe("SuggestionsReady");
    const [first] = tids("report-suggestion");
    expect(tid("report-suggestion-title", first)!.textContent).toBe("Vendor comparison");
    expect(tid("report-suggestion-description", first)!.textContent).toBe("Compare the three vendor proposals.");
    expect(tid("report-suggestion-edit", first)).not.toBeNull();
    // The suggestions request carries the explicit selection.
    expect(api.calls.find((c) => c.path.endsWith("/report-suggestions"))!.body).toEqual({ active_source_ids: [SRC_A, SRC_B] });

    tid("report-suggestion-edit", tids("report-suggestion")[1]!)!.click();
    const prompt = tid("report-prompt")!;
    expect(prompt.value).toBe("Summarise the main risks of each vendor.");
    type(prompt, `${prompt.value} Include a risk matrix`);
    tid("report-generate")!.click();
    await vi.waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toEqual({
      plugin_type: "report",
      subtype: "dynamic",
      active_source_ids: [SRC_A, SRC_B],
      custom_prompt: "Summarise the main risks of each vendor. Include a risk matrix",
    });
  });

  it("using a card directly generates it as dynamic with its prompt", async () => {
    await mount({ suggestions: [READY] });
    await openModal();
    await vi.waitFor(() => expect(tids("report-suggestion")).toHaveLength(3));
    tid("report-suggestion-use", tids("report-suggestion")[2]!)!.click();
    await vi.waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ subtype: "dynamic", custom_prompt: "Write a decision brief about the vendors.", active_source_ids: [SRC_A, SRC_B] });
  });

  it("while Source Guides are pending shows a loading state, keeps templates usable, then shows the cards", async () => {
    await mount({ suggestions: [{ state: "SuggestionsLoading" }, { state: "SuggestionsLoading" }, READY] });
    await openModal();
    expect(tid("report-suggestions-loading")).not.toBeNull();
    for (const b of tids("report-template")) expect(b.disabled).toBe(false);
    expect(tid("report-create-own")!.disabled).toBe(false);
    await vi.waitFor(() => expect(tids("report-suggestion")).toHaveLength(3));
    expect(tid("report-suggestions-loading")).toBeNull();
  });

  it("never loads endlessly: still pending after the bounded polls becomes unavailable", async () => {
    await mount({ suggestions: [{ state: "SuggestionsLoading" }] });
    await openModal();
    await vi.waitFor(() => expect(tid("report-suggestions-unavailable")).not.toBeNull());
    const polls = api.calls.filter((c) => c.path.endsWith("/report-suggestions")).length;
    expect(polls).toBeLessThanOrEqual(3);
    await new Promise((r) => setTimeout(r, 30));
    expect(api.calls.filter((c) => c.path.endsWith("/report-suggestions")).length).toBe(polls);
  });

  it.each([
    ["failed guides (SuggestionsUnavailable)", [{ state: "SuggestionsUnavailable", reason: "Source Guide generation failed." } as ReportSuggestionsResult]],
    ["no generation client configured (503)", [503]],
  ])("explains that suggestions are unavailable for %s while templates and Create Your Own stay usable", async (_label, suggestions) => {
    await mount({ suggestions });
    await openModal();
    await vi.waitFor(() => expect(tid("report-suggestions-unavailable")).not.toBeNull());
    expect(tid("report-suggestions-unavailable")!.textContent).toContain("unavailable");
    expect(tids("report-suggestion")).toHaveLength(0);
    for (const b of tids("report-template")) expect(b.disabled).toBe(false);
    tid("report-create-own")!.click();
    type(tid("report-prompt"), "Write for executives.");
    expect(tid("report-generate")!.disabled).toBe(false);
  });
});

describe("T048 FR-010 / SC-004: Create Your Own", () => {
  it("Generate is enabled at one non-whitespace character and disabled at 0, whitespace-only and 5,001 code points", async () => {
    await mount();
    await openModal();
    tid("report-create-own")!.click();
    const prompt = tid("report-prompt")!;
    const generate = tid("report-generate")!;
    expect(generate.disabled).toBe(true);
    for (const [text, enabled] of [
      ["", false],
      ["   \n\t ", false],
      ["a", true],
      ["  b  ", true],
      ["😀".repeat(5000), true],
      ["😀".repeat(5001), false],
    ] as const) {
      type(prompt, text);
      expect(generate.disabled, JSON.stringify(text.slice(0, 8)) + text.length).toBe(!enabled);
    }
    expect(tid("report-prompt-count")!.textContent).toContain("5,001");
  });

  it("sends subtype custom with the current selection", async () => {
    await mount();
    await openModal();
    tid("report-create-own")!.click();
    type(tid("report-prompt"), "A one-page brief for new engineers, friendly tone.");
    selection = [SRC_A];
    panel.updateSourceSelection();
    tid("report-generate")!.click();
    await vi.waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toEqual({
      plugin_type: "report",
      subtype: "custom",
      active_source_ids: [SRC_A],
      custom_prompt: "A one-page brief for new engineers, friendly tone.",
    });
  });

  it("Generate is disabled again when the selection becomes empty (FR-012)", async () => {
    await mount();
    await openModal();
    tid("report-create-own")!.click();
    type(tid("report-prompt"), "brief");
    selection = [];
    panel.updateSourceSelection();
    expect(tid("report-generate")!.disabled).toBe(true);
  });
});
