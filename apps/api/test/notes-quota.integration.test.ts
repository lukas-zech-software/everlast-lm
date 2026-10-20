import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startNotesApi, type NotesApi } from "./notes-pg-support.ts";

/**
 * [007-notes-pinboard-lifecycle] T032 — one source admission for uploads and note-sources (Constitution VI,
 * FR-WM-07, FR-NM-03 FR-012, SC-004; owner decision 2026-10-20: note-sources are v1 PostgreSQL sources).
 * Real PostgreSQL via TEST_DATABASE_URL (UNAVAILABLE without it).
 */

let n: NotesApi;
const OWNER = "quota-owner";

beforeAll(async () => {
  n = await startNotesApi({ sourceLimit: 50 });
});
afterAll(async () => {
  await n?.close();
});

async function note(nb: string, title: string, content: string): Promise<string> {
  return (await n.call(OWNER, "POST", `/api/notebooks/${nb}/notes`, { title, content_md: content })).json.note.id;
}
const convert = (nb: string, ids: string[]) => n.call(OWNER, "POST", `/api/notebooks/${nb}/notes/convert-to-source`, { note_ids: ids });
const slots = async (nb: string) => (await n.call(OWNER, "GET", `/api/notebooks/${nb}/notes`)).json.source_slots;
const occupied = async (nb: string) =>
  (await n.api.db.pool.query("SELECT count(*)::int AS c FROM sources WHERE notebook_id = $1 AND status IN ('Uploading','Processing','Ready')", [nb])).rows[0].c as number;

describe("FR-WM-07, FR-NM-03: note-sources share the v1 source slots", () => {
  it("two concurrent conversions at 49/50 create exactly one source and one 409 SourceLimitReached", async () => {
    const nb = await n.notebook(OWNER);
    await n.seedSources(OWNER, nb, 49);
    const a = await note(nb, "A", "Alpha finding");
    const b = await note(nb, "B", "Beta finding");
    const results = await Promise.all([convert(nb, [a]), convert(nb, [b])]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    const rejected = results.find((r) => r.status === 409)!;
    expect(rejected.json.error).toEqual({ code: "SourceLimitReached", message: "Source limit reached" });
    expect(await occupied(nb)).toBe(50);
    const listed = (await n.call(OWNER, "GET", `/api/notebooks/${nb}/sources`)).json.sources;
    expect(listed.filter((s: any) => s.media_type === "note_markdown")).toHaveLength(1);
  });

  it("an in-flight conversion already holds its slot while ingestion is still running", async () => {
    const nb = await n.notebook(OWNER);
    await n.seedSources(OWNER, nb, 48);
    const a = await note(nb, "A", "Alpha finding");
    const b = await note(nb, "B", "Beta finding");
    n.embedder.hold();
    const pending = convert(nb, [a]);
    for (let i = 0; i < 100 && (await occupied(nb)) < 49; i++) await new Promise((r) => setTimeout(r, 10));
    expect(await occupied(nb)).toBe(49);
    expect(await slots(nb)).toEqual({ used: 49, limit: 50 });
    // The last free slot goes to an upload; the next conversion is rejected while the first one still runs.
    const upload = await n.call(OWNER, "POST", `/api/notebooks/${nb}/sources/uploads`, {
      files: [{ attempt_id: randomUUID(), file_name: "late.txt", declared_bytes: 10 }],
    });
    expect(upload.json.items[0].admitted).toBe(true);
    const second = await convert(nb, [b]);
    expect(second.status).toBe(409);
    expect(second.json.error.code).toBe("SourceLimitReached");
    n.embedder.open();
    const first = await pending;
    expect(first.status).toBe(201);
    expect(first.json.source.status).toBe("Ready");
    expect(await occupied(nb)).toBe(50);
  });

  it("at the limit, v1 upload and copied-text admission reject with SourceQuotaExceeded and conversion is rejected too", async () => {
    const nb = await n.notebook(OWNER);
    await n.seedSources(OWNER, nb, 49);
    const a = await note(nb, "A", "Alpha finding");
    expect((await convert(nb, [a])).status).toBe(201);
    expect(await slots(nb)).toEqual({ used: 50, limit: 50 });

    const upload = await n.call(OWNER, "POST", `/api/notebooks/${nb}/sources/uploads`, {
      files: [{ attempt_id: randomUUID(), file_name: "more.txt", declared_bytes: 10 }],
    });
    expect(upload.json.items[0]).toMatchObject({ admitted: false, error: { code: "SourceQuotaExceeded" } });
    const text = await n.call(OWNER, "POST", `/api/notebooks/${nb}/sources/text`, { attempt_id: randomUUID(), text: "more text" });
    expect(text.status).toBe(409);
    expect(text.json.error.code).toBe("SourceQuotaExceeded");
    const again = await convert(nb, [a]);
    expect(again.status).toBe(409);
    expect(again.json.error).toEqual({ code: "SourceLimitReached", message: "Source limit reached" });
  });

  it("a failed ingestion releases its slot and never returns upstream error text", async () => {
    const nb = await n.notebook(OWNER);
    const a = await note(nb, "A", "Alpha finding");
    n.embedder.failDocuments = true;
    try {
      const r = await convert(nb, [a]);
      expect(r.status).toBe(502);
      expect(r.json.error.code).toBe("IngestionFailed");
      expect(JSON.stringify(r.json)).not.toContain("secret upstream detail");
    } finally {
      n.embedder.failDocuments = false;
    }
    expect(await occupied(nb)).toBe(0);
    expect(await slots(nb)).toEqual({ used: 0, limit: 50 });
    const failed = (await n.call(OWNER, "GET", `/api/notebooks/${nb}/sources`)).json.sources;
    expect(failed.every((s: any) => s.status === "Failed")).toBe(true);
    expect(JSON.stringify(failed)).not.toContain("secret upstream detail");
    // The note is unchanged and can be converted once ingestion works again.
    expect((await convert(nb, [a])).status).toBe(201);
  });

  it("GET /notes source_slots.used equals uploads plus note-sources plus in-flight reservations", async () => {
    const nb = await n.notebook(OWNER);
    await n.addText(OWNER, nb, "An uploaded text source about apples.");
    const a = await note(nb, "A", "Alpha finding");
    expect((await convert(nb, [a])).status).toBe(201);
    await n.call(OWNER, "POST", `/api/notebooks/${nb}/sources/uploads`, {
      files: [{ attempt_id: randomUUID(), file_name: "pending.txt", declared_bytes: 10 }],
    });
    expect(await slots(nb)).toEqual({ used: 3, limit: 50 });
    const quota = (await n.call(OWNER, "GET", `/api/notebooks/${nb}/quota`)).json;
    expect(quota.sources_used).toBe(3);
  });
});
