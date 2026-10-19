import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AppError, type ChunkLocator, type SourceRevisionPair } from "@everlast/contracts";
import { toIso, withTransaction, type Queryable } from "./transaction.ts";
import { requireOwnedNotebook } from "./notebooks.ts";
import { verifyScopeSnapshot, type ScopeSnapshot } from "./scope-guard.ts";

/**
 * Persistent single thread per (notebook, user) with complete provenance (FR-GC-06, FR-GC-01, NFR-EVAL-04).
 * Messages store the full submission snapshot as provenance and citation references only; snippets, titles and
 * locators are resolved at read time from current authorized chunks, so deleted sources never leak.
 */

export interface StoredCitation {
  badge_number: number;
  source_id: string;
  chunk_id: string;
  revision: number;
}

export interface ChatThreadRecord {
  id: string;
  notebook_id: string;
  user_id: string;
  generation_epoch: number;
}

export interface StoredMessage {
  id: string;
  seq: number;
  turn_id: string;
  request_id: string;
  role: "user" | "assistant";
  kind: "question" | "answer" | "refusal";
  content: string;
  provenance: SourceRevisionPair[];
  citations: StoredCitation[];
  created_at: string;
}

export interface HydratedCitation {
  badge_number: number;
  source_id: string;
  chunk_id: string;
  status: "available" | "deleted";
  source_title: string | null;
  snippet: string | null;
  locator: ChunkLocator | null;
}

export interface VisibleMessage {
  id: string;
  turn_id: string;
  role: "user" | "assistant";
  kind: "question" | "answer" | "refusal";
  /** null when the generated content depends on a deleted/revoked source (hidden, not cached). */
  content: string | null;
  unavailable_reason: "source_deleted" | null;
  citations: HydratedCitation[];
  created_at: string;
}

export class GenerationCancelledError extends AppError {
  constructor(message = "The chat was cleared or the request was cancelled") {
    super("GenerationCancelled", 409, message);
    this.name = "GenerationCancelledError";
  }
}

interface MessageRow extends Omit<StoredMessage, "created_at" | "seq"> {
  seq: string | number;
  created_at: Date;
}

const MESSAGE_COLUMNS = "id, seq, turn_id, request_id, role, kind, content, provenance, citations, created_at";

function toStored(row: MessageRow): StoredMessage {
  return { ...row, seq: Number(row.seq), created_at: toIso(row.created_at) };
}

export async function getOrCreateThread(db: Queryable, ownerId: string, notebookId: string): Promise<ChatThreadRecord> {
  await requireOwnedNotebook(db, ownerId, notebookId);
  const result = await db.query<ChatThreadRecord>(
    `INSERT INTO chat_threads (id, notebook_id, user_id) VALUES ($1, $2, $3)
     ON CONFLICT (notebook_id, user_id) DO UPDATE SET updated_at = chat_threads.updated_at
     RETURNING id, notebook_id, user_id, generation_epoch`,
    [randomUUID(), notebookId, ownerId]
  );
  return result.rows[0]!;
}

export async function listThreadMessages(db: Queryable, threadId: string): Promise<StoredMessage[]> {
  const result = await db.query<MessageRow>(
    `SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE thread_id = $1 ORDER BY seq`,
    [threadId]
  );
  return result.rows.map(toStored);
}

export async function findTurnByRequest(db: Queryable, threadId: string, requestId: string): Promise<StoredMessage[]> {
  const result = await db.query<MessageRow>(
    `SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE thread_id = $1 AND request_id = $2 ORDER BY seq`,
    [threadId, requestId]
  );
  return result.rows.map(toStored);
}

export interface PublishTurnInput {
  thread: ChatThreadRecord;
  snapshot: ScopeSnapshot;
  requestId: string;
  question: string;
  answer: { kind: "answer" | "refusal"; content: string; citations: StoredCitation[] };
}

/**
 * Atomic publication under the shared fence (D13, C-02): re-verifies notebook ownership and the exact captured
 * revisions with share locks, re-checks the thread epoch (a clear in between cancels), then stores question and
 * answer together. A replayed request returns the already-published turn.
 */
export async function publishTurn(pool: Pool, input: PublishTurnInput): Promise<StoredMessage[]> {
  return withTransaction(pool, async (tx) => {
    await verifyScopeSnapshot(tx, input.snapshot, { lock: "share" });
    const thread = await tx.query<{ generation_epoch: number }>(
      "SELECT generation_epoch FROM chat_threads WHERE id = $1 FOR SHARE",
      [input.thread.id]
    );
    if (!thread.rows[0] || thread.rows[0].generation_epoch !== input.thread.generation_epoch) {
      throw new GenerationCancelledError();
    }
    const existing = await findTurnByRequest(tx, input.thread.id, input.requestId);
    if (existing.length > 0) return existing;

    const turnId = randomUUID();
    const provenance = JSON.stringify(input.snapshot.sources);
    const insert = async (role: "user" | "assistant", kind: string, content: string, citations: StoredCitation[]) => {
      const row = await tx.query<MessageRow>(
        `INSERT INTO chat_messages (id, thread_id, notebook_id, user_id, turn_id, request_id, role, kind, content, provenance, citations, generation_epoch)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING ${MESSAGE_COLUMNS}`,
        [
          randomUUID(),
          input.thread.id,
          input.thread.notebook_id,
          input.thread.user_id,
          turnId,
          input.requestId,
          role,
          kind,
          content,
          provenance,
          JSON.stringify(citations),
          input.thread.generation_epoch,
        ]
      );
      return toStored(row.rows[0]!);
    };
    const question = await insert("user", "question", input.question, []);
    const answer = await insert("assistant", input.answer.kind, input.answer.content, input.answer.citations);
    await tx.query("UPDATE chat_threads SET updated_at = now() WHERE id = $1", [input.thread.id]);
    return [question, answer];
  });
}

/** Clear chat (FR-GC-06): advances the epoch (fencing late generations) and deletes this thread's messages only. */
export async function clearThread(pool: Pool, ownerId: string, notebookId: string): Promise<{ generation_epoch: number }> {
  return withTransaction(pool, async (tx) => {
    const thread = await getOrCreateThread(tx, ownerId, notebookId);
    const updated = await tx.query<{ generation_epoch: number }>(
      "UPDATE chat_threads SET generation_epoch = generation_epoch + 1, updated_at = now() WHERE id = $1 RETURNING generation_epoch",
      [thread.id]
    );
    await tx.query("DELETE FROM chat_messages WHERE thread_id = $1", [thread.id]);
    return updated.rows[0]!;
  });
}

interface CurrentSourceRow {
  id: string;
  title: string;
  status: string;
  active_revision: number | null;
}

/**
 * Projects stored messages for display with current authorization: citations to sources that no longer exist
 * at the cited revision become "Source deleted" without snippet; assistant content whose provenance includes a
 * deleted source is hidden. Mere deselection does not hide anything.
 */
export async function projectVisibleMessages(
  db: Queryable,
  notebookId: string,
  messages: StoredMessage[]
): Promise<VisibleMessage[]> {
  const sourceIds = new Set<string>();
  const chunkIds = new Set<string>();
  for (const m of messages) {
    m.provenance.forEach((p) => sourceIds.add(p.source_id));
    m.citations.forEach((c) => {
      sourceIds.add(c.source_id);
      chunkIds.add(c.chunk_id);
    });
  }
  const sources = new Map<string, CurrentSourceRow>();
  if (sourceIds.size > 0) {
    const rows = await db.query<CurrentSourceRow>(
      "SELECT id, title, status, active_revision FROM sources WHERE notebook_id = $1 AND id = ANY($2::uuid[])",
      [notebookId, [...sourceIds]]
    );
    rows.rows.forEach((r) => sources.set(r.id, r));
  }
  const chunks = new Map<string, { text: string; locator: ChunkLocator; revision: number; source_id: string }>();
  if (chunkIds.size > 0) {
    const rows = await db.query<{ chunk_id: string; text: string; locator: ChunkLocator; revision: number; source_id: string }>(
      "SELECT chunk_id, text, locator, revision, source_id FROM chunks WHERE notebook_id = $1 AND chunk_id = ANY($2::uuid[])",
      [notebookId, [...chunkIds]]
    );
    rows.rows.forEach((r) => chunks.set(r.chunk_id, r));
  }
  const available = (sourceId: string, revision: number) => {
    const s = sources.get(sourceId);
    return Boolean(s && s.status === "Ready" && s.active_revision === revision);
  };

  return messages.map((m) => {
    const dependsOnDeleted = m.role === "assistant" && m.provenance.some((p) => !available(p.source_id, p.revision));
    const citations: HydratedCitation[] = m.citations.map((c) => {
      const chunk = chunks.get(c.chunk_id);
      const ok = !dependsOnDeleted && available(c.source_id, c.revision) && chunk && chunk.source_id === c.source_id && chunk.revision === c.revision;
      return ok
        ? {
            badge_number: c.badge_number,
            source_id: c.source_id,
            chunk_id: c.chunk_id,
            status: "available",
            source_title: sources.get(c.source_id)!.title,
            snippet: chunk!.text,
            locator: chunk!.locator,
          }
        : { badge_number: c.badge_number, source_id: c.source_id, chunk_id: c.chunk_id, status: "deleted", source_title: null, snippet: null, locator: null };
    });
    return {
      id: m.id,
      turn_id: m.turn_id,
      role: m.role,
      kind: m.kind,
      content: dependsOnDeleted ? null : m.content,
      unavailable_reason: dependsOnDeleted ? "source_deleted" : null,
      citations,
      created_at: m.created_at,
    };
  });
}

export async function loadVisibleThread(db: Queryable, ownerId: string, notebookId: string): Promise<VisibleMessage[]> {
  const thread = await getOrCreateThread(db, ownerId, notebookId);
  return projectVisibleMessages(db, notebookId, await listThreadMessages(db, thread.id));
}

/** Search within the caller's thread only; hidden (deleted-source) content never matches (FR-GC-06). */
export async function searchThread(
  db: Queryable,
  ownerId: string,
  notebookId: string,
  query: string
): Promise<{ message_id: string; role: string; excerpt: string }[]> {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  const visible = await loadVisibleThread(db, ownerId, notebookId);
  const results: { message_id: string; role: string; excerpt: string }[] = [];
  for (const m of visible) {
    if (m.content === null) continue;
    const index = m.content.toLowerCase().indexOf(term);
    if (index < 0) continue;
    const start = Math.max(0, index - 60);
    results.push({ message_id: m.id, role: m.role, excerpt: `${start > 0 ? "…" : ""}${m.content.slice(start, index + term.length + 60)}` });
  }
  return results;
}
