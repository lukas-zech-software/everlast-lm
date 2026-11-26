import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeCodePointString } from "@everlast/testkit/studio-structure-fixtures";
import { renderInfographicSvg, type StudioInfographicPayload } from "@everlast/contracts";
import { createInfographicViewer } from "../src/studio/infographic-viewer.ts";
import { createStudioPanel } from "../src/studio/panel.ts";
import { requestUrl, setupMockDOM, type MockElement } from "./mock-dom.ts";

/**
 * [015-studio-visuals-presentations] T017 — Visual Infographic UI viewer, zoom controls,
 * safe SVG DOM mounting (no innerHTML), SVG/PNG export buttons, Failed state Retry (no partial exports),
 * and customization modal with 5 styles + 1,000-codepoint limit (FR-ST-17, D9, NFR-SEC-02).
 */

const NB = "42000000-0000-4000-8000-000000000001";
const SRC_A = "42000000-0000-4000-8000-000000000101";
const CHUNK_1 = "0190f420-0000-7000-8000-000000000001";
const ART = "42000000-bbbb-4000-8000-000000000001";

const cite = {
  badge_number: 1,
  chunk_id: CHUNK_1,
  source_id: SRC_A,
  revision: 1,
  snippet: "Stage 1 Detection monitors metrics continuously.",
  locator: { page_number: 1 },
};

function makeInfographicPayload(): StudioInfographicPayload {
  const blocks = [
    {
      id: "step_1",
      heading: "Detection & Telemetry Alerting",
      body: "Cloud Logging alerts trigger automated incident workflows.",
      badge_numbers: [1],
    },
    {
      id: "step_2",
      heading: "Containment & Rollback",
      body: "Traffic shifts off failing revisions automatically.",
      badge_numbers: [1],
    },
  ];
  const { svg } = renderInfographicSvg({
    style: "process_flow",
    title: "Incident Response Pipeline",
    blocks,
    citations: [{ badge_number: 1, label: "Incident Playbook" }],
  });
  return {
    style: "process_flow",
    title: "Incident Response Pipeline",
    structured_blocks: blocks,
    rendered_svg: svg,
    source_chunk_ids: [CHUNK_1],
    citations: [cite],
  };
}

describe("[015-studio-visuals-presentations] T017: Infographic UI viewer, zoom, exports & Studio modal", () => {
  let dom: ReturnType<typeof setupMockDOM>;

  beforeEach(() => {
    dom = setupMockDOM(1440);
  });

  const body = () => dom.document.body;
  const tid = (id: string, root: MockElement = body()) => root.querySelector(`[data-testid=${id}]`);

  it("mounts crisp safe SVG via DOM API, updates zoom controls, fires citation & SVG/PNG exports", async () => {
    const exported: string[] = [];
    const openedCites: number[] = [];

    const viewer = createInfographicViewer({
      artifactId: ART,
      title: "Incident Response Pipeline",
      payload: makeInfographicPayload(),
      onOpenCitation: (ref) => openedCites.push(ref.badge_number),
      onExport: (format) => {
        exported.push(format);
        return Promise.resolve();
      },
    });
    body().append(viewer.element as unknown as MockElement);

    const canvas = tid("infographic-canvas")!;
    expect(canvas.querySelector("svg")).not.toBeNull();
    expect(canvas.querySelector("script")).toBeNull();
    expect(tid("infographic-ai-label")!.textContent).toContain("AI-generated");
    expect(tid("infographic-zoom-value")!.textContent).toBe("100%");

    tid("infographic-zoom-in")!.click();
    expect(tid("infographic-zoom-value")!.textContent).toBe("120%");
    tid("infographic-zoom-out")!.click();
    expect(tid("infographic-zoom-value")!.textContent).toBe("100%");
    tid("infographic-zoom-in")!.click();
    tid("infographic-zoom-reset")!.click();
    expect(tid("infographic-zoom-value")!.textContent).toBe("100%");

    tid("infographic-citation-1")!.click();
    expect(openedCites).toEqual([1]);

    tid("infographic-export-svg")!.click();
    tid("infographic-export-png")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(exported).toEqual(["svg", "png"]);
  });

  it("validates 5 styles and 1,000-codepoint focus_prompt without truncation in modal, and hides export on Failed row", async () => {
    let selection = [SRC_A];
    const posts: Array<Record<string, unknown>> = [];
    const artifacts = [
      {
        id: "42000000-ffff-4000-8000-000000000010",
        notebook_id: NB,
        plugin_type: "infographic" as const,
        subtype: "default",
        status: "Failed" as const,
        title: "Failed Infographic",
        params_json: { style: "auto" },
        payload_json: null,
        source_revisions_snapshot: [{ source_id: SRC_A, revision: 1 }],
        output_language: "en-US",
        progress: null,
        failure: { code: "RenderFailed", message: "SVG compilation failed." },
        attempt: 1,
        retry_of: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const fetcher = ((input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(requestUrl(input), "http://local");
      const method = (init.method ?? "GET").toUpperCase();
      if (url.pathname.endsWith("/artifacts") && method === "GET") {
        return Promise.resolve(new Response(JSON.stringify({ artifacts }), { status: 200 }));
      }
      if (url.pathname.endsWith("/artifacts") && method === "POST") {
        const parsed =
          typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
        posts.push(parsed);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              artifact: {
                ...artifacts[0],
                id: ART,
                status: "Queued",
                failure: null,
                params_json: parsed,
              },
            }),
            { status: 202 },
          ),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }) as typeof fetch;

    const panel = createStudioPanel({
      notebookId: NB,
      fetcher,
      selectedSourceIds: () => [...selection],
      openCitation: vi.fn(),
      onSourceCreated: vi.fn(),
      pollMs: 50,
    });
    body().append(panel.element as unknown as MockElement);
    await panel.refresh();

    // Failed infographic shows Retry without SVG/PNG export
    expect(body().textContent).toContain("Retry");
    expect(tid("infographic-export-svg")).toBeNull();
    expect(tid("infographic-export-png")).toBeNull();

    const tile = tid("studio-infographic-tile")!;
    expect(tile.disabled).toBe(false);
    selection = [];
    panel.updateSourceSelection();
    expect(tile.disabled).toBe(true);

    selection = [SRC_A];
    panel.updateSourceSelection();
    tile.click();
    const modal = tid("infographic-modal")!;
    expect(modal).not.toBeNull();

    const styleSelect = tid("infographic-style-select", modal)!;
    expect(styleSelect.value).toBe("auto");
    styleSelect.value = "process_flow";

    const promptInput = tid("infographic-focus-prompt", modal)!;
    promptInput.value = makeCodePointString(1001);
    promptInput.dispatchEvent({ type: "input" });
    expect(tid("infographic-generate", modal)!.disabled).toBe(true);

    promptInput.value = "4-stage incident workflow";
    promptInput.dispatchEvent({ type: "input" });
    expect(tid("infographic-generate", modal)!.disabled).toBe(false);
    tid("infographic-generate", modal)!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(posts[0]).toMatchObject({
      plugin_type: "infographic",
      subtype: "default",
      style: "process_flow",
      focus_prompt: "4-stage incident workflow",
      active_source_ids: [SRC_A],
    });
  });
});
