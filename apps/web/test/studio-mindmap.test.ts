import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStudioPanel, type StudioPanel } from "../src/studio/panel.ts";
import { renderNotebookOverview } from "../src/chat-control.ts";
import { setupMockDOM, type MockElement } from "./mock-dom.ts";

/**
 * [011-studio-mindmaps-data-tables] T015 — Mindmap admission, list, cancel, initial canvas (depth 2),
 * unavailable metadata and accessible AI-generated label (FR-ST-08, FR-SI-03, C-03, NFR-SEC-02;
 * FR-001, FR-002, FR-010, FR-014, FR-017, SC-001, SC-008, SC-011).
 */

const NB = "11111111-1111-4111-8111-111111111111";
const SRC_A = "01965b10-0000-7000-8000-000000000301";
const SRC_B = "01965b10-0000-7000-8000-000000000302";
const CHUNK_1 = "01965b10-0000-7000-8000-000000001301";

function buildValidMindmapPayload() {
  const ref = {
    badge_number: 1,
    chunk_id: CHUNK_1,
    source_id: SRC_A,
    revision: 1,
    snippet: "Project Vortex architecture overview.",
    locator: { page_number: 1 },
  };
  return {
    root_node: {
      id: "root",
      label: "Project Vortex Architecture",
      summary: "Grounded overview of the system.",
      evidence: [ref],
      summary_evidence: [ref],
      children: [
        {
          id: "branch-1",
          label: "Ingestion Pipeline",
          summary: "Multimodal normalization.",
          evidence: [ref],
          summary_evidence: [ref],
          children: [
            {
              id: "depth-2-node",
              label: "PDF & Audio Chunks",
              summary: null,
              evidence: [ref],
              summary_evidence: [],
              children: [
                {
                  id: "depth-3-hidden",
                  label: "Deep Leaf Node",
                  summary: null,
                  evidence: [ref],
                  summary_evidence: [],
                  children: [],
                },
              ],
            },
          ],
        },
        {
          id: "branch-2",
          label: "Grounded Studio",
          summary: "Mindmaps and Data Tables.",
          evidence: [ref],
          summary_evidence: [ref],
          children: Array.from({ length: 12 }, (_, idx) => ({
            id: `b2-child-${idx + 1}`,
            label: `Studio Feature ${idx + 1}`,
            summary: null,
            evidence: [ref],
            summary_evidence: [],
            children: [],
          })),
        },
      ],
    },
    node_count: 17,
    max_depth: 4,
    ai_generated_label: "AI-generated from selected sources",
  };
}

describe("[011-studio-mindmaps-data-tables] T015 — Studio mindmap UI admission, list, cancel & initial depth-2 canvas", () => {
  let dom: ReturnType<typeof setupMockDOM>;
  let selection: string[];

  beforeEach(() => {
    dom = setupMockDOM(1440);
    selection = [SRC_A, SRC_B];
  });

  const body = () => dom.document.body as unknown as MockElement;
  const q = (sel: string, root: MockElement = body()) => root.querySelector(sel);
  const qa = (sel: string, root: MockElement = body()) => root.querySelectorAll(sel);
  const tid = (id: string, root?: MockElement) => q(`[data-testid=${id}]`, root);
  const tids = (id: string, root?: MockElement) => qa(`[data-testid=${id}]`, root);

  it("renders Mindmap tile in Studio panel and Generate Mindmap button in Notebook Overview; disables both when selection is empty", async () => {
    const calls: { method: string; path: string; body: any }[] = [];
    const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), "http://local");
      const method = (init.method ?? "GET").toUpperCase();
      const reqBody = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: url.pathname, body: reqBody });
      if (url.pathname.endsWith("/artifacts") && method === "GET") {
        return new Response(JSON.stringify({ artifacts: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.pathname.endsWith("/artifacts") && method === "POST") {
        return new Response(
          JSON.stringify({
            artifact: {
              id: randomUUID(),
              notebook_id: NB,
              plugin_type: reqBody.plugin_type,
              subtype: reqBody.subtype,
              status: "Queued",
              title: "Mindmap",
              params_json: {},
              payload_json: null,
              source_revisions_snapshot: [{ source_id: SRC_A, revision: 1 }],
              output_language: "en-US",
              progress: null,
              failure: null,
              attempt: 1,
              retry_of: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          }),
          { status: 202, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    const panel: StudioPanel = createStudioPanel({
      notebookId: NB,
      fetcher,
      selectedSourceIds: () => [...selection],
      openCitation: () => undefined,
      onSourceCreated: () => undefined,
      pollMs: 50,
    });
    body().append(panel.element as unknown as MockElement);
    await panel.refresh();

    const mindmapTile = tid("studio-mindmap-tile");
    expect(mindmapTile).not.toBeNull();
    expect(mindmapTile!.disabled).toBe(false);

    // Empty selection disables mindmap tile
    selection = [];
    panel.updateSourceSelection();
    expect(mindmapTile!.disabled).toBe(true);
    mindmapTile!.click();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);

    // Selecting sources enables mindmap tile and posts plugin_type: "mindmap", subtype: "default"
    selection = [SRC_A, SRC_B];
    panel.updateSourceSelection();
    expect(mindmapTile!.disabled).toBe(false);
    mindmapTile!.click();
    await vi.waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({
      plugin_type: "mindmap",
      subtype: "default",
      active_source_ids: [SRC_A, SRC_B],
    });

    // Overview Generate Mindmap trigger
    const overviewHost = dom.document.createElement("div") as unknown as HTMLElement;
    body().append(overviewHost as unknown as MockElement);
    let overviewMindmapTriggered = 0;
    renderNotebookOverview(overviewHost, {
      notebookTitle: "Vortex Notebook",
      sourceCount: 2,
      overview: "Summary of Vortex.",
      starterPrompts: ["What is Vortex?"],
      onPrompt: () => undefined,
      onGenerateMindmap: () => {
        overviewMindmapTriggered += 1;
      },
    });
    const overviewBtn = tid("overview-generate-mindmap", overviewHost as unknown as MockElement);
    expect(overviewBtn).not.toBeNull();
    overviewBtn!.click();
    expect(overviewMindmapTriggered).toBe(1);
    panel.destroy();
  });

  it("shows Cancel button for Queued/Running mindmaps (not reports), opens Completed mindmaps expanded to depth 2 with AI-generated badge, and shows unavailable state when sources changed", async () => {
    const mindmapId = randomUUID();
    const reportId = randomUUID();
    let mindmapStatus: "Queued" | "Running" | "Completed" | "Cancelled" = "Running";
    let mindmapUnavailable = false;
    const cancelCalls: string[] = [];

    const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), "http://local");
      const method = (init.method ?? "GET").toUpperCase();
      const mindmapDto = {
        id: mindmapId,
        notebook_id: NB,
        plugin_type: "mindmap",
        subtype: "default",
        status: mindmapStatus,
        title: mindmapUnavailable ? "Mindmap" : "Project Vortex Architecture",
        params_json: {},
        payload_json: mindmapStatus === "Completed" && !mindmapUnavailable ? buildValidMindmapPayload() : null,
        source_revisions_snapshot: [{ source_id: SRC_A, revision: 1 }],
        output_language: "en-US",
        progress: null,
        failure: mindmapStatus === "Cancelled" ? { code: "CancelledError", message: "Generation was cancelled." } : null,
        attempt: 1,
        retry_of: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const reportDto = {
        id: reportId,
        notebook_id: NB,
        plugin_type: "report",
        subtype: "briefing_doc",
        status: "Running",
        title: "Briefing doc",
        params_json: {},
        payload_json: null,
        source_revisions_snapshot: [{ source_id: SRC_A, revision: 1 }],
        output_language: "en-US",
        progress: null,
        failure: null,
        attempt: 1,
        retry_of: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (url.pathname.endsWith("/artifacts") && method === "GET") {
        return new Response(JSON.stringify({ artifacts: [mindmapDto, reportDto] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.pathname.endsWith(`/artifacts/${mindmapId}/cancel`) && method === "POST") {
        cancelCalls.push(mindmapId);
        mindmapStatus = "Cancelled";
        return new Response(
          JSON.stringify({
            artifact: {
              ...mindmapDto,
              status: "Cancelled",
              failure: { code: "CancelledError", message: "Generation was cancelled." },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.pathname.endsWith(`/artifacts/${mindmapId}`) && method === "GET") {
        return new Response(
          JSON.stringify({
            artifact: mindmapDto,
            ...(mindmapUnavailable
              ? { unavailable: { code: "ArtifactSourceDeleted", message: "A source used by this artifact was deleted." } }
              : {}),
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    const panel = createStudioPanel({
      notebookId: NB,
      fetcher,
      selectedSourceIds: () => [...selection],
      openCitation: () => undefined,
      onSourceCreated: () => undefined,
      pollMs: 1000,
    });
    body().append(panel.element as unknown as MockElement);
    await panel.refresh();

    const rows = tids("studio-artifact-row");
    expect(rows).toHaveLength(2);
    const mindmapRow = rows.find((r) => r.getAttribute("data-artifact-id") === mindmapId)!;
    const reportRow = rows.find((r) => r.getAttribute("data-artifact-id") === reportId)!;

    // Cancel button is present on active mindmap row, absent on report row (FR-017)
    expect(tid("studio-cancel", mindmapRow)).not.toBeNull();
    expect(tid("studio-cancel", reportRow)).toBeNull();

    // Now transition mindmap to Completed and refresh
    mindmapStatus = "Completed";
    await panel.refresh();
    const completedRow = tids("studio-artifact-row").find((r) => r.getAttribute("data-artifact-id") === mindmapId)!;
    tid("studio-artifact-open", completedRow)!.click();

    await vi.waitFor(() => expect(tid("studio-ai-generated-badge")).not.toBeNull());
    const viewer = tid("studio-mindmap-viewer")!;

    // AI-generated badge is rendered and accessible (FR-013)
    expect(tid("studio-ai-generated-badge", viewer)?.textContent).toContain("AI-generated");
    // Convert to source is report-only and MUST NOT appear on mindmap viewer (FR-017)
    expect(tid("studio-convert", viewer)).toBeNull();

    // Initial expansion is depth 2: root (depth 0), branch-1 (depth 1), depth-2-node (depth 2) visible; depth-3-hidden (depth 3) not visible
    const visibleNodeIds = tids("mindmap-node", viewer).map((el) => el.getAttribute("data-node-id"));
    expect(visibleNodeIds).toContain("root");
    expect(visibleNodeIds).toContain("branch-1");
    expect(visibleNodeIds).toContain("depth-2-node");
    expect(visibleNodeIds).not.toContain("depth-3-hidden");

    // Unavailable state when a captured source was deleted
    tid("studio-viewer-close", viewer)!.click();
    mindmapUnavailable = true;
    await panel.refresh();
    const unavailableRow = tids("studio-artifact-row").find((r) => r.getAttribute("data-artifact-id") === mindmapId)!;
    tid("studio-artifact-open", unavailableRow)!.click();
    await vi.waitFor(() => expect(tid("studio-artifact-unavailable")).not.toBeNull());
    expect(tid("studio-artifact-unavailable")!.textContent).toContain("deleted");

    panel.destroy();
  });
});
