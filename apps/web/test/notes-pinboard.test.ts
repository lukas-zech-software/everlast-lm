import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMarkdownFormat, createNotesPanel, localDraftStore, type NotesPanel } from "../src/notes/panel.ts";
import { setupMockDOM, type MockElement } from "./mock-dom.ts";
import { createFakeNotesApi, flush, NOTEBOOK } from "./notes-fake-api.ts";

/**
 * [007-notes-pinboard-lifecycle] T034, T035 — Right Panel notes pinboard (FR-NM-01 FR-001..FR-005, FR-NM-02
 * FR-006..FR-009, FR-NM-03 FR-010..FR-013, US1/AC1..AC4, US2/AC1..AC5, US3/AC2..AC5, SC-001, SC-002).
 */

let dom: ReturnType<typeof setupMockDOM>;
let api: ReturnType<typeof createFakeNotesApi>;
let panel: NotesPanel;
let created: string[];
let opened: [string, string][];
let confirmAnswer: boolean;

const q = (sel: string, root: MockElement = panel.element as unknown as MockElement) => root.querySelector(sel);
const qa = (sel: string, root: MockElement = panel.element as unknown as MockElement) => root.querySelectorAll(sel);
const testid = (id: string) => q(`[data-testid=${id}]`);
const type = (el: MockElement | null, value: string) => {
  el!.value = value;
  el!.dispatchEvent({ type: "input", target: el });
};
const cards = () => qa("[data-testid=note-card]");

function mount(slots?: { used: number; limit: number }) {
  api = createFakeNotesApi(slots ? { slots } : {});
  created = [];
  opened = [];
  confirmAnswer = true;
  panel = createNotesPanel({
    notebookId: NOTEBOOK,
    fetcher: api.fetcher,
    openCitation: (sourceId, chunkId) => void opened.push([sourceId, chunkId]),
    onSourceCreated: (sourceId) => void created.push(sourceId),
    selectedSourceIds: () => [],
    onAssistantMessages: () => undefined,
    confirm: async () => confirmAnswer,
    notify: () => undefined,
    drafts: localDraftStore(NOTEBOOK),
  });
  dom.document.body.append(panel.element as any);
  return panel;
}

beforeEach(() => {
  dom = setupMockDOM(1440);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("T034 FR-NM-01: create, auto-save, close, delete", () => {
  it("+ Add note opens the Note Editor titled New note with the content area focused", async () => {
    mount();
    await panel.refresh();
    (testid("add-note") as MockElement).click();
    await flush();
    expect(api.calls.find((c) => c.method === "POST" && c.path.endsWith("/notes"))).toBeTruthy();
    expect(testid("note-editor")).not.toBeNull();
    expect((testid("note-title") as MockElement).value).toBe("New note");
    expect((dom.document as any).activeElement).toBe(testid("note-content"));
  });

  it("toolbar buttons insert Markdown for H1, H2, bold, italic, lists and links", () => {
    expect(applyMarkdownFormat("Title", 0, 5, "h1").value).toBe("# Title");
    expect(applyMarkdownFormat("Title", 0, 5, "h2").value).toBe("## Title");
    expect(applyMarkdownFormat("a word b", 2, 6, "bold").value).toBe("a **word** b");
    expect(applyMarkdownFormat("a word b", 2, 6, "italic").value).toBe("a _word_ b");
    expect(applyMarkdownFormat("one\ntwo", 0, 7, "bullets").value).toBe("- one\n- two");
    expect(applyMarkdownFormat("one\ntwo", 0, 7, "numbers").value).toBe("1. one\n2. two");
    expect(applyMarkdownFormat("see docs", 4, 8, "link").value).toBe("see [docs](https://)");
    expect(applyMarkdownFormat("", 0, 0, "bold").value).toBe("**bold text**");
  });

  it("toolbar clicks change the content and schedule a save", async () => {
    mount();
    await panel.refresh();
    (testid("add-note") as MockElement).click();
    await flush();
    type(testid("note-content") as MockElement, "Risk 1");
    q("[data-format=h2]")!.click();
    expect((testid("note-content") as MockElement).value).toContain("## ");
    expect((testid("note-save-status") as MockElement).textContent).toBe("Unsaved changes");
  });

  it("a typing pause saves within 1.0 s, closing flushes first and the list shows the note in display order", async () => {
    mount();
    api.add({ title: "Earlier", content_md: "x" });
    await panel.refresh();
    (testid("add-note") as MockElement).click();
    await flush();
    const started = performance.now();
    type(testid("note-title") as MockElement, "Key Audit Findings");
    type(testid("note-content") as MockElement, "## Risk 1\nMissing mTLS on port 8080");
    for (let i = 0; i < 100 && !api.calls.some((c) => c.method === "PATCH"); i++) await new Promise((r) => setTimeout(r, 20));
    const patch = api.calls.find((c) => c.method === "PATCH")!;
    expect(patch.at - started).toBeLessThan(1000);
    await flush();
    expect((testid("note-save-status") as MockElement).textContent).toBe("Saved");

    type(testid("note-content") as MockElement, "## Risk 1\nMissing mTLS on port 8080 and 8443");
    (testid("note-close") as MockElement).click();
    await flush();
    const patches = api.calls.filter((c) => c.method === "PATCH");
    expect(patches.at(-1)!.body.content_md).toBe("## Risk 1\nMissing mTLS on port 8080 and 8443");
    expect(testid("note-editor")).toBeNull();
    expect(cards().map((c) => c.querySelector("[data-testid=note-open]")!.textContent)).toEqual(["📝 Earlier", "📝 Key Audit Findings"]);

    // Reopening shows the saved Markdown.
    cards()[1]!.querySelector("[data-testid=note-open]")!.click();
    await flush();
    expect((testid("note-content") as MockElement).value).toBe("## Risk 1\nMissing mTLS on port 8080 and 8443");
  });

  it("offline saves keep a local draft, show the error status, never 'Saved', and recover on reopening", async () => {
    mount();
    const note = api.add({ title: "Draft me", content_md: "start" });
    await panel.refresh();
    cards()[0]!.querySelector("[data-testid=note-open]")!.click();
    await flush();
    api.state.offline = true;
    type(testid("note-content") as MockElement, "unsaved words");
    (testid("note-close") as MockElement).click();
    await flush();
    expect(testid("notes-status")!.textContent).toBe("Not saved — your changes are kept on this device");
    expect(testid("notes-status")!.textContent).not.toContain("Saved to");
    expect(JSON.parse(dom.localStorage.getItem(`everlast.note-draft.${NOTEBOOK}.${note.id}`)!)).toEqual({ content_md: "unsaved words" });
    expect(cards()[0]!.querySelector("[data-testid=note-draft-flag]")).not.toBeNull();

    // A fresh panel (reload) recovers the draft and saves it once online again.
    api.state.offline = false;
    const revisionBefore = note.revision;
    cards()[0]!.querySelector("[data-testid=note-open]")!.click();
    await flush();
    expect((testid("note-content") as MockElement).value).toBe("unsaved words");
    expect((testid("note-save-status") as MockElement).textContent).toBe("Draft recovered — not saved yet");
    (testid("note-close") as MockElement).click();
    await flush();
    expect(note.content_md).toBe("unsaved words");
    expect(note.revision).toBe(revisionBefore + 1);
    expect(dom.localStorage.getItem(`everlast.note-draft.${NOTEBOOK}.${note.id}`)).toBeNull();
  });

  it("Delete asks for confirmation and then removes the note permanently", async () => {
    mount();
    api.add({ title: "Keep", content_md: "a" });
    const doomed = api.add({ title: "Remove", content_md: "b" });
    await panel.refresh();
    confirmAnswer = false;
    cards()[1]!.querySelector("[data-testid=note-delete]")!.click();
    await flush();
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
    confirmAnswer = true;
    cards()[1]!.querySelector("[data-testid=note-delete]")!.click();
    await flush();
    expect(api.calls.find((c) => c.method === "DELETE")!.path).toBe(`/api/notebooks/${NOTEBOOK}/notes/${doomed.id}?confirm=true`);
    expect(cards()).toHaveLength(1);
  });
});

describe("T035 FR-NM-02, FR-NM-03: saved responses and conversion", () => {
  const spec = "22222222-2222-4222-8222-222222222222";
  const chunk = "018f6b40-0001-7000-8000-000000000001";
  const savedDto = (id = "33333333-3333-4333-8333-333333333333") => ({
    id, notebook_id: NOTEBOOK, source_message_id: "44444444-4444-4444-8444-444444444444", title: "Which port needs mTLS?",
    content_md: "Port 8080 requires mTLS.[[1]]", citations_json: [{ badge_number: 1, source_id: spec, source_title: "Spec.pdf", chunk_id: chunk, snippet: "Port 8080", locator: { page_number: 1, start_offset: 0, end_offset: 9 } }],
    origin_type: "saved_response" as const, read_only: true as const, created_at: "2026-10-20T00:00:00.000Z",
  });

  it("Save to note inserts the saved response into the pinboard within 300 ms and shows Saved to notes", async () => {
    mount();
    await panel.refresh();
    const started = performance.now();
    panel.showSavedNote(savedDto());
    expect(performance.now() - started).toBeLessThan(300);
    expect(cards()).toHaveLength(1);
    expect(cards()[0]!.getAttribute("data-origin")).toBe("saved_response");
    expect(testid("notes-status")!.textContent).toBe("Saved to notes");
  });

  it("the saved-response viewer is read-only and its [n] badges open the Source Inspector", async () => {
    mount();
    const dto = savedDto();
    api.add({ ...dto, owner_id: "owner", origin_note_id: null, revision: 1, display_order: 1, updated_at: dto.created_at });
    await panel.refresh();
    cards()[0]!.querySelector("[data-testid=note-open]")!.click();
    await flush();
    expect(testid("saved-response-viewer")).not.toBeNull();
    expect(testid("note-content")).toBeNull();
    expect(testid("saved-response-content")!.textContent).toContain("Port 8080 requires mTLS.");
    expect(testid("saved-response-content")!.textContent).not.toContain("[[1]]");
    const badge = q("[data-testid=saved-citation]")!;
    expect(badge.getAttribute("data-badge")).toBe("1");
    badge.click();
    expect(opened).toEqual([[spec, chunk]]);
  });

  it("Convert to editable opens the manual copy without badges", async () => {
    mount();
    const dto = savedDto();
    api.add({ ...dto, owner_id: "owner", origin_note_id: null, revision: 1, display_order: 1, updated_at: dto.created_at });
    await panel.refresh();
    cards()[0]!.querySelector("[data-testid=note-open]")!.click();
    await flush();
    (testid("convert-to-editable") as MockElement).click();
    await flush();
    expect(testid("note-editor")).not.toBeNull();
    expect((testid("note-content") as MockElement).value).toBe("Port 8080 requires mTLS.");
    expect(api.notes).toHaveLength(2);
    expect(api.notes[0]!.content_md).toContain("[[1]]");
  });

  it("convert actions are disabled with 'Source limit reached' at the limit and for empty bodies", async () => {
    mount({ used: 50, limit: 50 });
    api.add({ title: "A", content_md: "content" });
    await panel.refresh();
    for (const id of ["convert-all", "convert-selected"]) {
      expect((testid(id) as MockElement).disabled).toBe(true);
    }
    expect((testid("convert-all") as MockElement).title).toBe("Source limit reached");
    cards()[0]!.querySelector("[data-testid=note-open]")!.click();
    await flush();
    expect((testid("convert-note") as MockElement).disabled).toBe(true);
    expect((testid("convert-note") as MockElement).title).toBe("Source limit reached");

    mount();
    api.add({ title: "Blank", content_md: "   " });
    await panel.refresh();
    expect((testid("convert-all") as MockElement).disabled).toBe(true);
    expect((testid("convert-all") as MockElement).title).toBe("Add note content to convert");
  });

  it("Convert to source, selected and all create one source each, add it to this browser's selection and keep the notes", async () => {
    mount();
    const a = api.add({ title: "A", content_md: "one" });
    const b = api.add({ title: "B", content_md: "two" });
    await panel.refresh();
    expect((testid("convert-selected") as MockElement).disabled).toBe(true);

    cards()[1]!.querySelector("[data-testid=note-checkbox]")!.checked = true;
    cards()[1]!.querySelector("[data-testid=note-checkbox]")!.dispatchEvent({ type: "change" });
    cards()[0]!.querySelector("[data-testid=note-checkbox]")!.checked = true;
    cards()[0]!.querySelector("[data-testid=note-checkbox]")!.dispatchEvent({ type: "change" });
    expect((testid("convert-selected") as MockElement).disabled).toBe(false);
    (testid("convert-selected") as MockElement).click();
    await flush();
    const selected = api.calls.filter((c) => c.path.endsWith("/convert-to-source")).at(-1)!;
    expect(new Set(selected.body.note_ids)).toEqual(new Set([a.id, b.id]));
    expect(created).toHaveLength(1);

    (testid("convert-all") as MockElement).click();
    await flush();
    expect(api.calls.filter((c) => c.path.endsWith("/convert-to-source")).at(-1)!.body).toEqual({ all: true });
    expect(created).toHaveLength(2);

    cards()[0]!.querySelector("[data-testid=note-open]")!.click();
    await flush();
    (testid("convert-note") as MockElement).click();
    await flush();
    expect(api.calls.filter((c) => c.path.endsWith("/convert-to-source")).at(-1)!.body).toEqual({ note_ids: [a.id] });
    expect(created).toHaveLength(3);
    expect(api.notes).toHaveLength(2);
    expect(testid("notes-status")!.textContent).toBe("Source created: A");
    expect(testid("source-slots")!.textContent).toBe("3 / 50 sources");
  });

  it("shows Source limit reached when the server rejects a conversion at the limit", async () => {
    mount();
    api.add({ title: "A", content_md: "one" });
    await panel.refresh();
    api.state.convertStatus = 409;
    (testid("convert-all") as MockElement).click();
    await flush();
    expect(testid("notes-status")!.textContent).toBe("Source limit reached");
    expect(created).toHaveLength(0);
  });
});
