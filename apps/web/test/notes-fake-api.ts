import { randomUUID } from "node:crypto";

/**
 * TEST-ONLY in-memory stand-in for the Package 2.3 notes routes (FR-NM-01..04) used by the Right Panel DOM tests.
 * It mirrors the HTTP contract in specs/007 contracts/interfaces.md; the real routes are covered by the API suites.
 */

export const NOTEBOOK = "11111111-1111-4111-8111-111111111111";

export interface FakeNote {
  id: string;
  notebook_id: string;
  owner_id: string;
  title: string;
  content_md: string;
  origin_type: "manual" | "saved_response";
  source_message_id: string | null;
  citations_json: { badge_number: number; source_id: string; source_title: string; chunk_id: string; snippet: string; locator: unknown }[];
  origin_note_id: string | null;
  revision: number;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface FakeCall {
  method: string;
  path: string;
  body: any;
  at: number;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function createFakeNotesApi(options: { slots?: { used: number; limit: number } } = {}) {
  const notes: FakeNote[] = [];
  const calls: FakeCall[] = [];
  let order = 0;
  const state = {
    offline: false,
    slots: options.slots ?? { used: 0, limit: 50 },
    convertStatus: 201,
    assistantResult: null as unknown,
    /** Holds convert/assistant responses until released (progress phases). */
    hold: null as Promise<void> | null,
  };
  const now = () => new Date().toISOString();
  const add = (fields: Partial<FakeNote>): FakeNote => {
    const note: FakeNote = {
      id: randomUUID(), notebook_id: NOTEBOOK, owner_id: "owner", title: "New note", content_md: "", origin_type: "manual",
      source_message_id: null, citations_json: [], origin_note_id: null, revision: 1, display_order: ++order,
      created_at: now(), updated_at: now(), ...fields,
    };
    notes.push(note);
    return note;
  };

  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://local");
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname + url.search, body, at: performance.now() });
    const base = `/api/notebooks/${NOTEBOOK}/notes`;
    if (!url.pathname.startsWith(base)) return json({ error: { code: "NotFound", message: "not found" } }, 404);
    const rest = url.pathname.slice(base.length).split("/").filter(Boolean);
    if (rest.length === 0 && method === "GET") return json({ notes: [...notes].sort((a, b) => a.display_order - b.display_order), source_slots: state.slots });
    if (rest.length === 0 && method === "POST") return json({ note: add({ title: body?.title ?? "New note", content_md: body?.content_md ?? "" }) }, 201);
    if (rest[0] === "convert-to-source" && method === "POST") {
      if (state.hold) await state.hold;
      if (state.convertStatus === 409) return json({ error: { code: "SourceLimitReached", message: "Source limit reached" } }, 409);
      const ids: string[] = body.all ? notes.map((n) => n.id) : body.note_ids;
      const picked = notes.filter((n) => ids.includes(n.id));
      state.slots = { ...state.slots, used: state.slots.used + 1 };
      return json({ source: { id: randomUUID(), notebook_id: NOTEBOOK, title: picked.length === 1 ? picked[0]!.title : "Combined notes", media_type: "note_markdown", status: "Ready", revision_id: 1, byte_size: 1, word_count: 1, origin_notes: picked.map((n) => ({ note_id: n.id, revision: n.revision, title: n.title })), origin_citations: [], created_at: now() }, reused: false }, 201);
    }
    if (rest[0] === "assistant" && method === "POST") {
      if (state.hold) await state.hold;
      return state.assistantResult ? json(state.assistantResult) : json({ error: { code: "Unavailable", message: "The note assistant model is not configured" } }, 503);
    }
    const note = notes.find((n) => n.id === rest[0]);
    if (!note) return json({ error: { code: "NoteNotFound", message: "Note not found" } }, 404);
    if (rest[1] === "convert-to-editable" && method === "POST") {
      return json({ note: add({ title: note.title, content_md: note.content_md.replace(/ ?\[\[\d+\]\]/g, ""), origin_note_id: note.id }) }, 201);
    }
    if (method === "GET") return json({ note });
    if (method === "PATCH") {
      if (state.offline) throw new TypeError("Failed to fetch");
      if (note.origin_type === "saved_response") return json({ error: { code: "NoteReadOnly", message: "Saved responses cannot be edited" } }, 409);
      if (body.title !== undefined) note.title = body.title;
      if (body.content_md !== undefined) note.content_md = body.content_md;
      note.revision += 1;
      note.updated_at = now();
      return json({ note });
    }
    if (method === "DELETE") {
      if (url.searchParams.get("confirm") !== "true") return json({ error: { code: "ConfirmationRequired", message: "Deletion must be confirmed" } }, 400);
      notes.splice(notes.indexOf(note), 1);
      return json({ deleted: true });
    }
    return json({ error: { code: "NotFound", message: "not found" } }, 404);
  }) as typeof fetch;

  return { fetcher, notes, calls, state, add };
}

export const flush = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
