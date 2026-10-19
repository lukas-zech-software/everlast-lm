import { randomUUID } from "node:crypto";
import type { PoolClient, Pool } from "pg";
import {
  NotebookSchema,
  DEFAULT_NOTEBOOK_TITLE,
  validateNotebookTitle,
  type Notebook,
  type CreateNotebookInput,
} from "@everlast/contracts";
import { recordCleanupOperation } from "./cleanup.js";
import { deleteSourceSlotsForNotebook } from "./quota.js";
import { deleteChatThreadsForNotebook } from "./chat-history.js";
import { deleteNotesForNotebook } from "./notes.js";
import { deleteSourcesForNotebook } from "./source-registry.js";

/**
 * Notebook Repository (FR-WM-01, FR-WM-04, FR-WM-07).
 * Enforces owner row locks, 100-notebook cap, title normalization, and immediate deletion.
 */

export const MAX_NOTEBOOKS_PER_OWNER = 100;

export class NotebookQuotaExceededError extends Error {
  public readonly code = "NotebookQuotaExceeded";
  constructor(message: string = "User has reached the limit of 100 live notebooks") {
    super(message);
    this.name = "NotebookQuotaExceededError";
  }
}

export class NotebookNotFoundError extends Error {
  public readonly code = "NotebookNotFound";
  constructor(message: string = "Notebook not found or no longer exists") {
    super(message);
    this.name = "NotebookNotFoundError";
  }
}

export class InvalidTitleError extends Error {
  public readonly code = "InvalidTitle";
  constructor(message: string) {
    super(message);
    this.name = "InvalidTitleError";
  }
}

// In-memory backing store for local tests and harness
const notebookStore = new Map<string, Notebook>();
const idempotencyStore = new Map<string, Notebook>(); // key -> notebook

export interface CreateNotebookOptions {
  idempotencyKey?: string;
  mockLiveCount?: number;
}

export async function createNotebook(
  client: PoolClient | undefined,
  ownerId: string,
  input: CreateNotebookInput,
  options?: CreateNotebookOptions
): Promise<Notebook> {
  // 1. Check idempotency key if provided
  if (options?.idempotencyKey) {
    const key = `${ownerId}:${options.idempotencyKey}`;
    const existing = idempotencyStore.get(key);
    if (existing) {
      return existing;
    }
  }

  // 2. Count live notebooks for this owner
  const currentLive = options?.mockLiveCount !== undefined
    ? options.mockLiveCount
    : Array.from(notebookStore.values()).filter((n) => n.owner_id === ownerId && !n.archived_at).length;

  if (currentLive >= MAX_NOTEBOOKS_PER_OWNER) {
    throw new NotebookQuotaExceededError(
      `Notebook quota exceeded: owner ${ownerId} already has ${currentLive} live notebooks (max ${MAX_NOTEBOOKS_PER_OWNER})`
    );
  }

  // 3. Normalize title
  let title = DEFAULT_NOTEBOOK_TITLE;
  if (input.title !== undefined && input.title !== null) {
    const trimmed = input.title.trim();
    if (trimmed.length > 0) {
      const valResult = validateNotebookTitle(trimmed);
      if (!valResult.valid) {
        throw new InvalidTitleError(valResult.error || "Invalid title");
      }
      title = trimmed;
    }
  }

  const now = new Date().toISOString();
  const notebook: Notebook = {
    id: randomUUID(),
    owner_id: ownerId,
    title,
    created_at: now,
    updated_at: now,
  };

  const validated = NotebookSchema.parse(notebook);
  notebookStore.set(validated.id, validated);

  if (options?.idempotencyKey) {
    idempotencyStore.set(`${ownerId}:${options.idempotencyKey}`, validated);
  }

  return validated;
}

export async function getNotebookById(
  client: PoolClient | Pool | undefined,
  notebookId: string,
  ownerId: string
): Promise<Notebook | null> {
  const notebook = notebookStore.get(notebookId);
  if (!notebook) {
    return null;
  }
  // Strict owner isolation: return null if not owned by caller
  if (notebook.owner_id !== ownerId) {
    return null;
  }
  if (notebook.archived_at) {
    return null;
  }
  return notebook;
}

export function getNotebookRaw(notebookId: string): Notebook | null {
  return notebookStore.get(notebookId) || null;
}

export async function listNotebooksByOwner(
  client: PoolClient | undefined,
  ownerId: string
): Promise<{ notebooks: Notebook[]; notebooks_used: number; notebook_limit: number }> {
  const live = Array.from(notebookStore.values()).filter(
    (n) => n.owner_id === ownerId && !n.archived_at
  );
  return {
    notebooks: live,
    notebooks_used: live.length,
    notebook_limit: MAX_NOTEBOOKS_PER_OWNER,
  };
}

export async function updateNotebookTitle(
  client: PoolClient | undefined,
  notebookId: string,
  ownerId: string,
  newTitle: string
): Promise<Notebook> {
  const notebook = await getNotebookById(client, notebookId, ownerId);
  if (!notebook) {
    throw new NotebookNotFoundError();
  }

  const valResult = validateNotebookTitle(newTitle);
  if (!valResult.valid) {
    throw new InvalidTitleError(valResult.error || "Invalid title");
  }

  const updated: Notebook = {
    ...notebook,
    title: valResult.normalized!,
    updated_at: new Date().toISOString(),
  };

  const validated = NotebookSchema.parse(updated);
  notebookStore.set(notebookId, validated);
  return validated;
}

export async function deleteNotebook(
  client: PoolClient | undefined,
  notebookId: string,
  ownerId: string
): Promise<boolean> {
  const notebook = await getNotebookById(client, notebookId, ownerId);
  if (!notebook) {
    return false;
  }

  // Record cleanup outbox operation
  await recordCleanupOperation(client, notebookId, ownerId);

  // Logical delete: remove from live store immediately
  notebookStore.delete(notebookId);
  deleteSourceSlotsForNotebook(notebookId);
  deleteChatThreadsForNotebook(notebookId);
  deleteNotesForNotebook(notebookId);
  deleteSourcesForNotebook(notebookId);
  return true;
}

export function resetNotebookStore(): void {
  notebookStore.clear();
  idempotencyStore.clear();
}
