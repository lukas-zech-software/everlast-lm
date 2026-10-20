import { beforeEach, describe, expect, it } from "vitest";
import { ASSISTANT_DISCLOSURE } from "../src/notes/assistant.ts";
import { createNotesPanel, type NotesPanel } from "../src/notes/panel.ts";
import { renderAnswerContent } from "../src/chat/panel.ts";
import type { ChatMessage } from "../src/lib/types.ts";
import { setupMockDOM, type MockElement } from "./mock-dom.ts";
import { createFakeNotesApi, flush, NOTEBOOK } from "./notes-fake-api.ts";

/**
 * [007-notes-pinboard-lifecycle] T036 — Note Assistant bar (FR-NM-04 FR-014..FR-017, US4/AC1..AC4, FR-019 phases).
 */

let dom: ReturnType<typeof setupMockDOM>;
let api: ReturnType<typeof createFakeNotesApi>;
let panel: NotesPanel;
let selectedSources: string[];
let appended: ChatMessage[][];
let created: string[];

const testid = (id: string) => (panel.element as unknown as MockElement).querySelector(`[data-testid=${id}]`);
const cards = () => (panel.element as unknown as MockElement).querySelectorAll("[data-testid=note-card]");
const action = (name: string) =>
  (panel.element as unknown as MockElement).querySelectorAll("[data-testid=assistant-action]").find((b) => b.getAttribute("data-action") === name)!;
const check = (i: number) => {
  const box = cards()[i]!.querySelector("[data-testid=note-checkbox]")!;
  box.checked = !box.checked;
  box.dispatchEvent({ type: "change" });
};

const NOTE_SOURCE = "99999999-9999-4999-8999-999999999999";
const EXT = "88888888-8888-4888-8888-888888888888";
const message = (id: string, role: "user" | "assistant", content: string, citations: ChatMessage["citations"] = []): ChatMessage => ({
  id, turn_id: "t1", role, kind: role === "user" ? "question" : "answer", content, unavailable_reason: null, citations, created_at: "2026-10-20T00:00:00.000Z",
});

beforeEach(async () => {
  dom = setupMockDOM(1440);
  api = createFakeNotesApi();
  selectedSources = [];
  appended = [];
  created = [];
  panel = createNotesPanel({
    notebookId: NOTEBOOK,
    fetcher: api.fetcher,
    openCitation: () => undefined,
    onSourceCreated: (id) => void created.push(id),
    selectedSourceIds: () => selectedSources,
    onAssistantMessages: (messages) => void appended.push(messages as ChatMessage[]),
    confirm: async () => true,
    notify: () => undefined,
  });
  dom.document.body.append(panel.element as any);
  for (let i = 0; i < 3; i++) api.add({ title: `N${i + 1}`, content_md: `Idea ${i + 1}` });
  await panel.refresh();
});

describe("T036 FR-NM-04: contextual action bar", () => {
  it("appears for 1–50 selected notes (or one open note) with four actions labelled as creating a source snapshot", async () => {
    expect(testid("assistant-bar")!.hidden).toBe(true);
    check(0);
    expect(testid("assistant-bar")!.hidden).toBe(false);
    const labels = (panel.element as unknown as MockElement).querySelectorAll("[data-testid=assistant-action]").map((b) => b.textContent);
    expect(labels).toEqual(["Summarize", "Create outline", "Suggest related ideas", "Critique"]);
    for (const b of (panel.element as unknown as MockElement).querySelectorAll("[data-testid=assistant-action]")) expect(b.title).toBe(ASSISTANT_DISCLOSURE);
    expect(testid("assistant-disclosure")!.textContent).toBe(ASSISTANT_DISCLOSURE);
    check(0);
    expect(testid("assistant-bar")!.hidden).toBe(true);

    cards()[1]!.querySelector("[data-testid=note-open]")!.click();
    await flush();
    expect(testid("assistant-bar")!.hidden).toBe(false);
  });

  it("caps the selection at 50 notes", async () => {
    for (let i = 0; i < 50; i++) api.add({ title: `M${i}`, content_md: "x" });
    await panel.refresh();
    for (let i = 0; i < 53; i++) check(i);
    const boxes = cards().map((c) => c.querySelector("[data-testid=note-checkbox]")!);
    expect(boxes.filter((b) => b.checked)).toHaveLength(50);
    expect(boxes.filter((b) => !b.checked).every((b) => b.disabled)).toBe(true);
  });

  it("Related ideas and Critique without a selected source show 'Select a comparison source first' and send nothing", async () => {
    check(0);
    for (const name of ["related_ideas", "critique"]) {
      action(name).click();
      await flush();
      expect(testid("assistant-hint")!.textContent).toBe("Select a comparison source first");
      expect(testid("assistant-hint")!.hidden).toBe(false);
    }
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("shows conversion and synthesis as separate phases and appends the validated ChatMessage to the chat", async () => {
    const answer = message("a1", "assistant", "Idea one is key.[[1]]", [
      { badge_number: 1, source_id: NOTE_SOURCE, chunk_id: "c1", status: "available", source_title: "Combined notes", source_media_type: "note_markdown", snippet: "Idea 1", locator: { page_number: 1, start_offset: 0, end_offset: 6 } },
    ]);
    api.state.assistantResult = {
      message: answer, messages: [message("q1", "user", "Summarize the selected notes."), answer], note_source: { id: NOTE_SOURCE }, reused: false,
      snapshot: [{ source_id: NOTE_SOURCE, revision: 1 }], note_assertion_source_ids: [NOTE_SOURCE], citation_kinds: { c1: "note_assertion" },
    };
    let release!: () => void;
    api.state.hold = new Promise((r) => (release = r));
    check(0);
    check(2);
    action("summarize").click();
    await flush();
    expect(testid("assistant-progress")!.textContent).toBe("Creating a source snapshot from 2 notes…");
    const pending = release;
    api.state.hold = new Promise((r) => (release = r));
    pending();
    await flush();
    expect(testid("assistant-progress")!.textContent).toBe("Synthesizing: Summarize…");
    release();
    api.state.hold = null;
    await flush();
    const posts = api.calls.filter((c) => c.method === "POST");
    expect(posts[0]!.path.endsWith("/convert-to-source")).toBe(true);
    expect(posts[0]!.body).toMatchObject({ reuse: true });
    expect(posts[1]!.path.endsWith("/assistant")).toBe(true);
    expect(posts[1]!.body).toEqual({ action_type: "summarize", selected_note_ids: posts[0]!.body.note_ids, selected_source_ids: [] });
    expect(created).toHaveLength(1);
    expect(appended).toHaveLength(1);
    expect(appended[0]!.map((m) => m.id)).toEqual(["q1", "a1"]);
    expect(testid("assistant-progress")!.hidden).toBe(true);
  });

  it("sends the Left Panel selection as comparison sources for Critique", async () => {
    selectedSources = [EXT];
    panel.updateSourceSelection();
    api.state.assistantResult = { message: message("a1", "assistant", "x"), messages: [message("q1", "user", "q"), message("a1", "assistant", "x")], note_source: { id: NOTE_SOURCE } };
    check(1);
    action("critique").click();
    await flush();
    const post = api.calls.find((c) => c.path.endsWith("/assistant"))!;
    expect(post.body).toMatchObject({ action_type: "critique", selected_source_ids: [EXT] });
  });

  it("shows an error when the action fails", async () => {
    check(0);
    action("summarize").click();
    await flush();
    expect(testid("assistant-error")!.textContent).toBe("The note assistant model is not configured");
    expect(appended).toHaveLength(0);
  });
});

describe("T036 FR-NM-04 FR-017: Note label on note-source citations", () => {
  it("labels citations to note-sources with Note and leaves other sources unlabelled", () => {
    const content = renderAnswerContent(
      message("a1", "assistant", "Claim.[[1]] Fact.[[2]]", [
        { badge_number: 1, source_id: NOTE_SOURCE, chunk_id: "c1", status: "available", source_title: "Combined notes", source_media_type: "note_markdown", snippet: "s", locator: null },
        { badge_number: 2, source_id: EXT, chunk_id: "c2", status: "available", source_title: "Spec.pdf", source_media_type: "application/pdf", snippet: "s", locator: null },
      ]),
      () => undefined
    ) as unknown as MockElement;
    const badges = content.querySelectorAll("[data-testid=citation-badge]");
    expect(badges[0]!.querySelector("[data-testid=citation-note-label]")!.textContent).toBe("Note");
    expect(badges[0]!.getAttribute("aria-label")).toBe("Citation 1: Note · Combined notes");
    expect(badges[1]!.querySelector("[data-testid=citation-note-label]")).toBeNull();
  });
});
