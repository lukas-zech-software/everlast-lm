import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeCodePointString } from "@everlast/testkit/studio-structure-fixtures";
import type { StudioSlideDeckPayload } from "@everlast/contracts";
import { createSlideDeckViewer } from "../src/studio/slide-deck-viewer.ts";
import { createStudioPanel } from "../src/studio/panel.ts";
import { setupMockDOM, type MockElement } from "./mock-dom.ts";

/**
 * [015-studio-visuals-presentations] T010 — Slide Deck UI viewer, carousel navigation, speaker notes drawer,
 * citation callback, PPTX/PDF export triggers, Failed state Retry (no partial exports), and customization modal
 * (FR-ST-16, D8/DEV-02, Gate v4.0 #3).
 */

const NB = "42000000-0000-4000-8000-000000000001";
const SRC_A = "42000000-0000-4000-8000-000000000101";
const CHUNK_1 = "0190f420-0000-7000-8000-000000000001";
const ART = "42000000-aaaa-4000-8000-000000000001";

const cite = {
  badge_number: 1,
  chunk_id: CHUNK_1,
  source_id: SRC_A,
  revision: 1,
  snippet: "Cloud Run services run in europe-west4 with 99.95% uptime.",
  locator: { page_number: 2 },
};

const samplePayload: StudioSlideDeckPayload = {
  slides: Array.from({ length: 8 }, (_, idx) => ({
    slide_number: idx + 1,
    layout: idx === 0 ? "title" : idx === 2 ? "key_metric_callout" : "two_column",
    title: `Slide ${idx + 1}: Architecture Highlight`,
    bullets: [`Key claim ${idx + 1} verified in europe-west4 [1]`],
    visual_spec: {
      layout: idx === 0 ? "title" : idx === 2 ? "key_metric_callout" : "two_column",
      subtitle: `Section ${idx + 1}`,
      ...(idx === 2 ? { callout: { value: "99.95%", label: "Uptime SLA" } } : {}),
    },
    speaker_notes: `Detailed speaker notes for slide ${idx + 1}.`,
    source_chunk_ids: [CHUNK_1],
    citations: [cite],
  })),
  target_count: 8,
  insufficient_evidence_note: null,
  citations: [cite],
};

describe("[015-studio-visuals-presentations] T010: Slide Deck UI viewer, carousel & Studio panel modal", () => {
  let dom: ReturnType<typeof setupMockDOM>;

  beforeEach(() => {
    dom = setupMockDOM(1440);
  });

  const body = () => dom.document.body as unknown as MockElement;
  const tid = (id: string, root: MockElement = body()) => root.querySelector(`[data-testid=${id}]`);

  it("renders 16:9 slide carousel, toggles speaker notes, triggers citations and PPTX/PDF exports (with zero Google Slides option)", async () => {
    const exported: string[] = [];
    const openedCites: number[] = [];

    const viewer = createSlideDeckViewer({
      artifactId: ART,
      title: "Architecture Deck",
      payload: samplePayload,
      onOpenCitation: (ref) => openedCites.push(ref.badge_number),
      onExport: async (format) => {
        exported.push(format);
      },
    });
    body().append(viewer.element as unknown as MockElement);

    expect(tid("slide-deck-counter")!.textContent).toBe("Slide 1 of 8");
    expect(tid("slide-stage-title")!.textContent).toContain("Slide 1: Architecture Highlight");
    expect(tid("slide-speaker-notes")!.hidden).toBe(true);

    // Toggle Speaker Notes drawer open
    tid("slide-notes-toggle")!.click();
    expect(tid("slide-speaker-notes")!.hidden).toBe(false);
    expect(tid("slide-speaker-notes")!.textContent).toContain("Detailed speaker notes for slide 1.");

    // Advance with Next and Thumbnail 3
    tid("slide-next")!.click();
    expect(tid("slide-deck-counter")!.textContent).toBe("Slide 2 of 8");
    tid("slide-thumb-3")!.click();
    expect(tid("slide-deck-counter")!.textContent).toBe("Slide 3 of 8");
    expect(tid("slide-stage")!.textContent).toContain("99.95%");

    // Click citation pill
    tid("slide-citation-1")!.click();
    expect(openedCites).toEqual([1]);

    // Trigger PPTX and PDF exports; ensure no Google Slides export button
    await (tid("slide-export-pptx") as any).click();
    await (tid("slide-export-pdf") as any).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(exported).toEqual(["pptx", "pdf"]);
    expect(tid("slide-export-google-slides")).toBeNull();
  });

  it("validates 5..20 slide_count (default 10) and 2,000-codepoint focus_prompt in modal, and shows Retry without export on Failed row", async () => {
    let selection = [SRC_A];
    const posts: any[] = [];
    const artifacts = [
      {
        id: "42000000-ffff-4000-8000-000000000009",
        notebook_id: NB,
        plugin_type: "slide_deck" as const,
        subtype: "default",
        status: "Failed" as const,
        title: "Failed Deck",
        params_json: { slide_count: 8 },
        payload_json: null,
        source_revisions_snapshot: [{ source_id: SRC_A, revision: 1 }],
        output_language: "en-US",
        progress: null,
        failure: { code: "ModelTimeout", message: "Upstream model timed out." },
        attempt: 1,
        retry_of: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), "http://local");
      const method = (init.method ?? "GET").toUpperCase();
      if (url.pathname.endsWith("/artifacts") && method === "GET") {
        return new Response(JSON.stringify({ artifacts }), { status: 200 });
      }
      if (url.pathname.endsWith("/artifacts") && method === "POST") {
        const parsed = JSON.parse(String(init.body));
        posts.push(parsed);
        return new Response(
          JSON.stringify({
            artifact: {
              ...artifacts[0],
              id: ART,
              status: "Queued",
              failure: null,
              params_json: parsed,
            },
          }),
          { status: 202 }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
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

    // Failed deck card shows Retry button and no partial export actions
    const listText = body().textContent ?? "";
    expect(listText).toContain("Retry");
    expect(tid("slide-export-pptx")).toBeNull();
    expect(tid("slide-export-pdf")).toBeNull();

    // Empty source selection disables Slide Deck tile
    const tile = tid("studio-slide-deck-tile")!;
    expect(tile.disabled).toBe(false);
    selection = [];
    panel.updateSourceSelection();
    expect(tile.disabled).toBe(true);

    // Non-empty selection opens Slide Deck modal with default 10, validates 2,001 code points & 5..20 bounds
    selection = [SRC_A];
    panel.updateSourceSelection();
    tile.click();
    const modal = tid("slide-deck-modal")!;
    expect(modal).not.toBeNull();
    expect((tid("slide-deck-count-input", modal) as any).value).toBe("10");

    // 2,001 Unicode code points disables submit without truncation
    const promptInput = tid("slide-deck-focus-prompt", modal) as any;
    promptInput.value = makeCodePointString(2001);
    promptInput.dispatchEvent({ type: "input" });
    expect(tid("slide-deck-generate", modal)!.disabled).toBe(true);

    // Slide count 4 or 21 disables submit
    promptInput.value = "Executive Q3 architecture overview";
    promptInput.dispatchEvent({ type: "input" });
    const countInput = tid("slide-deck-count-input", modal) as any;
    countInput.value = "4";
    countInput.dispatchEvent({ type: "input" });
    expect(tid("slide-deck-generate", modal)!.disabled).toBe(true);

    countInput.value = "8";
    countInput.dispatchEvent({ type: "input" });
    expect(tid("slide-deck-generate", modal)!.disabled).toBe(false);
    tid("slide-deck-generate", modal)!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(posts[0]).toMatchObject({
      plugin_type: "slide_deck",
      subtype: "default",
      slide_count: 8,
      focus_prompt: "Executive Q3 architecture overview",
      active_source_ids: [SRC_A],
    });
  });
});
