import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  countNoteWords,
  type NoteSourceIngestor,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";
import {
  countSourcesForNotebook,
  createPocNotebook,
  resetChatStore,
  resetNoteStore,
  resetPocBridge,
  resetSourceRegistry,
} from "@everlast/db";
import { SourceQuotaExceededError } from "@everlast/contracts";
import { handleNotesRoute } from "../src/routes/notes.ts";
import { NotesService, type NotesServiceDeps } from "../src/notes/service.ts";

export const USER = "usr_alice";

export function uuidv7(): string {
  const h = randomUUID().replace(/-/g, "");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function stubIngestor(mode: "ok" | "failed" | "throws" = "ok") {
  const calls: { markdown: string; title: string }[] = [];
  const ingestor: NoteSourceIngestor = {
    async ingest(input) {
      calls.push({ markdown: input.markdown, title: input.title });
      if (mode === "throws") throw new Error("boom");
      if (mode === "failed") {
        return { status: "Failed", byte_size: 0, word_count: 0, chunks: [], error_message: "parse error" };
      }
      const chunk: UnifiedDocumentChunk = {
        chunk_id: uuidv7(),
        source_id: input.source_id,
        revision: input.revision_id,
        locator: { selector: "body", start_offset: 0, end_offset: input.markdown.length },
        token_count: countNoteWords(input.markdown),
        text: input.markdown,
      };
      return {
        status: "Ready",
        byte_size: Buffer.byteLength(input.markdown, "utf8"),
        word_count: countNoteWords(input.markdown),
        chunks: [chunk],
      };
    },
  };
  return { ingestor, calls };
}

/** Uploaded sources already occupying slots, per notebook (stands in for the PostgreSQL count). */
export const seededSlots = new Map<string, number>();
export const occupiedSlots = (notebookId: string) => (seededSlots.get(notebookId) ?? 0) + countSourcesForNotebook(notebookId);
const SOURCE_LIMIT = 50;

export function resetAll(): void {
  seededSlots.clear();
  resetPocBridge();
  resetChatStore();
  resetNoteStore();
  resetSourceRegistry();
}

export async function newNotebook(): Promise<string> {
  return createPocNotebook(USER, "NB").id;
}

export async function startApi(deps: NotesServiceDeps & { verifyOwnership?: NotesServiceDeps["verifyOwnership"] }) {
  const service = new NotesService({
    reserveSlot: async (notebookId) => {
      if (occupiedSlots(notebookId) >= SOURCE_LIMIT) throw new SourceQuotaExceededError("Source limit reached");
    },
    ...deps,
  });
  const server: Server = createServer((req, res) => {
    handleNotesRoute(req, res, { service, ...(deps.verifyOwnership ? { verifyOwnership: deps.verifyOwnership } : {}) }, USER)
      .then((handled) => {
        if (!handled) {
          res.writeHead(404);
          res.end();
        }
      })
      .catch(() => {
        res.writeHead(500);
        res.end();
      });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
    });
    const text = await r.text();
    return { status: r.status, json: text ? (JSON.parse(text) as any) : null };
  };
  return { call, service, close: () => new Promise<void>((r) => server.close(() => r())) };
}
