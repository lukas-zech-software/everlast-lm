import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createPocNotebook, resetChatStore, resetNoteStore, resetPocBridge } from "@everlast/db";
import { handleNotesRoute } from "../src/routes/notes.ts";
import { NotesService, type NotesServiceDeps } from "../src/notes/service.ts";

/** TEST-ONLY: the notes routes over the in-memory note repository (FR-NM-01 CRUD; no sources involved). */

export const USER = "usr_alice";

export function uuidv7(): string {
  const h = randomUUID().replace(/-/g, "");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function resetAll(): void {
  resetPocBridge();
  resetChatStore();
  resetNoteStore();
}

export async function newNotebook(): Promise<string> {
  return createPocNotebook(USER, "NB").id;
}

export async function startApi(deps: NotesServiceDeps) {
  const service = new NotesService(deps);
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
