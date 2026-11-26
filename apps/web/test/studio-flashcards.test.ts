import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningProgressDto, StudioFlashcardsPayload } from "@everlast/contracts";
import { createFlashcardsViewer } from "../src/studio/flashcards-viewer.ts";
import { createStudioPanel } from "../src/studio/panel.ts";
import { requestUrl, setupMockDOM, type MockElement } from "./mock-dom.ts";

/**
 * [014-studio-active-learning-suite] T009, T021 — Flashcards UI viewer, Spacebar/click 3D flip,
 * self-assessment progress, Review missed filtering, Reset progress, and Explain trigger (FR-ST-13, FR-ST-15).
 */

const SRC_A = "41000000-0000-4000-8000-000000000101";
const CHUNK_1 = "0190f410-0000-7000-8000-000000000001";
const CARD_1 = "41000000-bbbb-4000-8000-000000000001";
const CARD_2 = "41000000-bbbb-4000-8000-000000000002";
const NB = "41000000-0000-4000-8000-000000000001";
const ART = "41000000-aaaa-4000-8000-000000000001";

const cite = {
  badge_number: 1,
  chunk_id: CHUNK_1,
  source_id: SRC_A,
  revision: 1,
  snippet: "Maximum payload size is 200 megabytes.",
};

const samplePayload: StudioFlashcardsPayload = {
  cards: [
    {
      id: CARD_1,
      front_text: "Card 1 Front?",
      back_text: "Card 1 Back: 200 MB.",
      source_chunk_ids: [CHUNK_1],
      citations: [cite],
    },
    {
      id: CARD_2,
      front_text: "Card 2 Front?",
      back_text: "Card 2 Back: 500k words.",
      source_chunk_ids: [CHUNK_1],
      citations: [cite],
    },
  ],
  difficulty: "medium",
  target_count: 10,
  insufficient_evidence_note: "Brief source yielded 2 cards.",
  citations: [cite],
};

describe("[014-studio-active-learning-suite] T009/T021: Flashcards viewer & Studio panel admission", () => {
  let dom: ReturnType<typeof setupMockDOM>;

  beforeEach(() => {
    dom = setupMockDOM(1440);
  });

  const body = () => dom.document.body;
  const tid = (id: string, root: MockElement = body()) => root.querySelector(`[data-testid=${id}]`);

  it("renders single-card 3D flip deck, handles Spacebar/click flip, records progress, filters Review missed, and resets progress", async () => {
    const progress: LearningProgressDto = {
      user_id: "41000000-0000-4000-8000-000000000002",
      artifact_id: ART,
      notebook_id: NB,
      item_states_json: {
        [CARD_1]: { status: "mastered", attempts: 1, last_reviewed_at: new Date().toISOString() },
        [CARD_2]: {
          status: "needs_review",
          attempts: 1,
          last_reviewed_at: new Date().toISOString(),
        },
      },
      updated_at: new Date().toISOString(),
    };
    const recorded: Array<{ itemId: string; outcome: string }> = [];
    const explained: string[] = [];

    const viewer = createFlashcardsViewer({
      artifactId: ART,
      title: "Flashcards",
      payload: samplePayload,
      progress,
      onRecordProgress: (itemId, outcome) => {
        recorded.push({ itemId, outcome });
        return Promise.resolve({
          ...progress,
          item_states_json: {
            ...progress.item_states_json,
            [itemId]: { status: outcome, attempts: 2, last_reviewed_at: new Date().toISOString() },
          },
        });
      },
      onResetProgress: () => Promise.resolve({ ...progress, item_states_json: {} }),
      onExplain: (itemId) => {
        explained.push(itemId);
        return Promise.resolve();
      },
      confirmReset: () => Promise.resolve(true),
    });
    body().append(viewer.element as unknown as MockElement);

    expect(tid("flashcards-counter")!.textContent).toBe("Card 1 of 2");
    expect(tid("flashcards-mastery")!.textContent).toContain("1/2 mastered");
    const cardEl = tid("flashcard-stage")!;
    expect(cardEl.getAttribute("data-side")).toBe("front");

    // Click flips to back
    cardEl.click();
    expect(cardEl.getAttribute("data-side")).toBe("back");
    expect(cardEl.classList.contains("flipped")).toBe(true);

    // Spacebar flips back to front
    cardEl.dispatchEvent({ type: "keydown", key: " ", preventDefault: () => undefined });
    expect(cardEl.getAttribute("data-side")).toBe("front");

    // Flip again and click Explain
    cardEl.click();
    tid("flashcard-explain")!.click();
    expect(explained).toEqual([CARD_1]);

    // Review missed filters strictly to CARD_2
    tid("flashcards-review-missed")!.click();
    expect(tid("flashcards-counter")!.textContent).toBe("Card 1 of 1");
    expect(tid("flashcard-front-text")!.textContent).toContain("Card 2 Front?");

    // Mark Card 2 mastered -> 2/2 mastered, Review missed disabled -> Practice all again available
    tid("flashcard-got-it")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(recorded).toContainEqual({ itemId: CARD_2, outcome: "mastered" });
    expect(tid("flashcards-review-missed")!.disabled).toBe(true);
    expect(tid("flashcards-practice-all")).not.toBeNull();

    // Reset progress clears state
    tid("flashcards-reset-progress")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(tid("flashcards-mastery")!.textContent).toContain("0/2 mastered");
  });

  it("renders Flashcards tile in Studio panel disabled on empty scope and submits difficulty/card_count/focus_prompt", async () => {
    let selection = [SRC_A];
    const posts: Array<Record<string, unknown>> = [];
    const fetcher = ((input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(requestUrl(input), "http://local");
      const method = (init.method ?? "GET").toUpperCase();
      if (url.pathname.endsWith("/artifacts") && method === "GET") {
        return Promise.resolve(new Response(JSON.stringify({ artifacts: [] }), { status: 200 }));
      }
      if (url.pathname.endsWith("/artifacts") && method === "POST") {
        const parsed =
          typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
        posts.push(parsed);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              artifact: {
                id: ART,
                notebook_id: NB,
                plugin_type: parsed.plugin_type,
                subtype: "default",
                status: "Queued",
                title: "Flashcards",
                params_json: parsed,
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

    const tile = tid("studio-flashcards-tile")!;
    expect(tile.disabled).toBe(false);
    selection = [];
    panel.updateSourceSelection();
    expect(tile.disabled).toBe(true);

    selection = [SRC_A];
    panel.updateSourceSelection();
    tile.click();
    const modal = tid("flashcards-modal")!;
    expect(modal).not.toBeNull();
    tid("flashcards-difficulty-select", modal)!.value = "hard";
    tid("flashcards-count-select", modal)!.value = "fewer";
    tid("flashcards-focus-prompt", modal)!.value = "Quotas";
    tid("flashcards-generate", modal)!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(posts[0]).toMatchObject({
      plugin_type: "flashcards",
      subtype: "default",
      difficulty: "hard",
      card_count: "fewer",
      focus_prompt: "Quotas",
      active_source_ids: [SRC_A],
    });
  });
});
