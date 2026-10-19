import { describe, expect, it, vi } from "vitest";
import { copyResponse, renderSavedResponseNote } from "../src/chat-control.js";
import { setupMockDOM } from "./mock-dom.js";

const note = { id: "33333333-3333-4333-8333-333333333333", notebook_id: "11111111-1111-4111-8111-111111111111", source_message_id: "44444444-4444-4444-8444-444444444444", title: "Policy answer", content_md: "Claim [1]", citations_json: [{ badge_number: 1, source_id: "22222222-2222-4222-8222-222222222222", source_title: "Brief", chunk_id: "018f6b40-0001-7000-8000-000000000001", snippet: "Claim", locator: { page_number: 4, start_offset: 2, end_offset: 7 } }], origin_type: "saved_response" as const, read_only: true as const, created_at: "2026-10-19T00:00:00.000Z" };

describe("saved response Studio rendering (FR-GC-09, FR-NM-02)", () => {
  it("renders title, full content and citation links and replaces duplicate idempotent saves", () => {
    const dom = setupMockDOM(1440);
    const studio = dom.document.createElement("section");
    const onCitation = vi.fn();
    renderSavedResponseNote(studio as any, note, onCitation);
    renderSavedResponseNote(studio as any, note, onCitation);
    expect(studio.querySelectorAll("[data-saved-note-id]")).toHaveLength(1);
    expect(studio.textContent).toContain("Policy answer");
    expect(studio.textContent).toContain("Claim [1]");
    expect(studio.textContent).toContain("Brief · page 4");
    const empty = { ...note, id: "55555555-5555-4555-8555-555555555555", title: "No citations", citations_json: [] };
    renderSavedResponseNote(studio as any, empty, onCitation);
    expect(studio.querySelectorAll("[data-citation-chunk]")).toHaveLength(1);
    expect(studio.textContent).toContain("No citations");
  });

  it("keeps local copy and note rendering within deterministic UI budgets", async () => {
    const dom = setupMockDOM(1440);
    const studio = dom.document.createElement("section");
    const writeText = vi.fn(async () => undefined);
    let start = performance.now();
    await copyResponse("Claim [1]", [{ badge_number: 1 }], false, { writeText });
    expect(performance.now() - start).toBeLessThan(200);
    start = performance.now();
    renderSavedResponseNote(studio as any, note);
    expect(performance.now() - start).toBeLessThan(300);
  });
});
