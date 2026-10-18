import type { PoolClient, Pool } from "pg";
import {
  type SourceAdmissionAttempt,
  SourceQuotaExceededError,
  SourceOversizedBytesError,
  SourceOversizedWordsError,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_WORDS,
  DEFAULT_MAX_SOURCES_PER_NOTEBOOK,
  InvalidScopeError,
} from "@everlast/contracts";
import { getNotebookRaw } from "./notebooks.js";

export { SourceQuotaExceededError, SourceOversizedBytesError, SourceOversizedWordsError, InvalidScopeError };

export interface AdmissionResult {
  admitted: boolean;
  reason?: string | undefined;
  attempt_id?: string | undefined;
  notebook_id?: string | undefined;
}

export interface SourceSlotRecord {
  attempt_id: string;
  notebook_id: string;
  status: "Uploading" | "Processing" | "Ready" | "Failed";
  declared_byte_size: number;
  actual_byte_size?: number | undefined;
  word_count?: number | undefined;
  file_name: string;
  mime_type?: string | undefined;
  error_message?: string | undefined;
  created_at: string;
  updated_at: string;
}

// In-memory ledger of source slots per notebook
const notebookSources = new Map<string, Map<string, SourceSlotRecord>>();

function getOrCreateNotebookMap(notebookId: string): Map<string, SourceSlotRecord> {
  let m = notebookSources.get(notebookId);
  if (!m) {
    m = new Map<string, SourceSlotRecord>();
    notebookSources.set(notebookId, m);
  }
  return m;
}

/**
 * Resets or clears in-memory quota ledger (for tests).
 */
export function resetQuotaStore(): void {
  notebookSources.clear();
}

/**
 * Deletes all source slots for a notebook (e.g. upon notebook deletion).
 */
export function deleteSourceSlotsForNotebook(notebookId: string): void {
  notebookSources.delete(notebookId);
}

/**
 * Seeds pre-existing source slots in a notebook (for tests).
 */
export async function seedSourceSlots(
  notebookId: string,
  count: number,
  status: "Uploading" | "Processing" | "Ready" | "Failed" = "Ready"
): Promise<void> {
  const m = getOrCreateNotebookMap(notebookId);
  m.clear();
  for (let i = 0; i < count; i++) {
    const attemptId = `seed-${notebookId.slice(0, 8)}-${String(i + 1).padStart(6, "0")}`;
    m.set(attemptId, {
      attempt_id: attemptId,
      notebook_id: notebookId,
      status,
      declared_byte_size: 1024,
      file_name: `seeded_${i + 1}.pdf`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
}

/**
 * Counts occupied source slots in a notebook.
 * States Uploading, Processing, and Ready consume slots. Failed does not.
 */
export async function getOccupiedSourceCount(notebookId: string): Promise<number> {
  const m = notebookSources.get(notebookId);
  if (!m) return 0;
  let occupied = 0;
  for (const record of m.values()) {
    if (record.status === "Uploading" || record.status === "Processing" || record.status === "Ready") {
      occupied++;
    }
  }
  return occupied;
}

export interface ReserveSlotOptions {
  maxSources?: number;
}

const notebookLocks = new Map<string, Promise<void>>();

async function withNotebookLock<T>(notebookId: string, fn: () => Promise<T>): Promise<T> {
  const prevLock = notebookLocks.get(notebookId) ?? Promise.resolve();
  let release: () => void;
  const currentLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  notebookLocks.set(notebookId, currentLock);

  try {
    await prevLock;
    return await fn();
  } finally {
    release!();
    if (notebookLocks.get(notebookId) === currentLock) {
      notebookLocks.delete(notebookId);
    }
  }
}

/**
 * Atomically reserves a source slot for a single upload attempt.
 */
export async function reserveSourceSlot(
  client: PoolClient | Pool | undefined,
  attempt: SourceAdmissionAttempt,
  options?: ReserveSlotOptions
): Promise<AdmissionResult> {
  return withNotebookLock(attempt.notebook_id, async () => {
    const { notebook_id, attempt_id, declared_byte_size, file_name, mime_type } = attempt;

    // 1. Verify notebook existence
    const rawNb = getNotebookRaw(notebook_id);
    if (!rawNb || rawNb.archived_at) {
      throw new InvalidScopeError(`Notebook ${notebook_id} not found or deleted`);
    }

    // 2. Validate declared size limit
    if (declared_byte_size > MAX_SOURCE_BYTES) {
      throw new SourceOversizedBytesError(`Source exceeds ${MAX_SOURCE_BYTES} bytes limit`);
    }

    const m = getOrCreateNotebookMap(notebook_id);

    // 3. Idempotency replay check
    const existing = m.get(attempt_id);
    if (existing) {
      return {
        admitted: existing.status !== "Failed",
        attempt_id,
        notebook_id,
        reason: existing.status === "Failed" ? existing.error_message : undefined,
      };
    }

    // 4. Authoritative occupancy check under notebook lock
    const maxSources = options?.maxSources ?? DEFAULT_MAX_SOURCES_PER_NOTEBOOK;
    const currentCount = await getOccupiedSourceCount(notebook_id);

    if (currentCount >= maxSources) {
      throw new SourceQuotaExceededError(
        `Notebook has reached maximum limit of ${maxSources} sources`
      );
    }

    // 5. Admit attempt in Uploading state
    m.set(attempt_id, {
      attempt_id,
      notebook_id,
      status: "Uploading",
      declared_byte_size,
      file_name,
      mime_type,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    return {
      admitted: true,
      attempt_id,
      notebook_id,
    };
  });
}

/**
 * Atomically reserves source slots for a batch of upload attempts.
 * Returns results in exact entry order; first fitting entries admitted, overflow rejected.
 */
export async function reserveSources(
  client: PoolClient | Pool | undefined,
  notebookId: string,
  entries: {
    attempt_id: string;
    declared_byte_size: number;
    file_name: string;
    mime_type?: string;
  }[],
  options?: ReserveSlotOptions
): Promise<AdmissionResult[]> {
  const rawNb = getNotebookRaw(notebookId);
  if (!rawNb || rawNb.archived_at) {
    throw new InvalidScopeError(`Notebook ${notebookId} not found or deleted`);
  }

  const m = getOrCreateNotebookMap(notebookId);
  const maxSources = options?.maxSources ?? DEFAULT_MAX_SOURCES_PER_NOTEBOOK;
  let currentCount = await getOccupiedSourceCount(notebookId);

  const results: AdmissionResult[] = [];

  for (const entry of entries) {
    if (entry.declared_byte_size > MAX_SOURCE_BYTES) {
      results.push({
        admitted: false,
        attempt_id: entry.attempt_id,
        notebook_id: notebookId,
        reason: `Source exceeds ${MAX_SOURCE_BYTES} bytes limit`,
      });
      continue;
    }

    // Existing idempotent record check
    const existing = m.get(entry.attempt_id);
    if (existing) {
      results.push({
        admitted: existing.status !== "Failed",
        attempt_id: entry.attempt_id,
        notebook_id: notebookId,
        reason: existing.status === "Failed" ? existing.error_message : undefined,
      });
      continue;
    }

    if (currentCount < maxSources) {
      m.set(entry.attempt_id, {
        attempt_id: entry.attempt_id,
        notebook_id: notebookId,
        status: "Uploading",
        declared_byte_size: entry.declared_byte_size,
        file_name: entry.file_name,
        mime_type: entry.mime_type,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      currentCount++;
      results.push({
        admitted: true,
        attempt_id: entry.attempt_id,
        notebook_id: notebookId,
      });
    } else {
      results.push({
        admitted: false,
        attempt_id: entry.attempt_id,
        notebook_id: notebookId,
        reason: `SourceQuotaExceeded: notebook limit of ${maxSources} sources reached`,
      });
    }
  }

  return results;
}

/**
 * Transitions a source attempt to Failed status, releasing its quota slot immediately.
 * Retains error metadata row. Replaying failure on already failed record does not double-release.
 */
export async function failSource(
  client: PoolClient | Pool | undefined,
  notebookId: string,
  attemptId: string,
  reason: string = "Processing error"
): Promise<void> {
  const m = notebookSources.get(notebookId);
  if (!m) return;
  const existing = m.get(attemptId);
  if (existing) {
    existing.status = "Failed";
    existing.error_message = reason;
    existing.updated_at = new Date().toISOString();
  }
}

/**
 * Dismisses a source error record from the notebook.
 * Removes error row without decrementing occupancy.
 */
export async function dismissSourceError(
  client: PoolClient | Pool | undefined,
  notebookId: string,
  attemptId: string
): Promise<void> {
  const m = notebookSources.get(notebookId);
  if (m) {
    m.delete(attemptId);
  }
}

/**
 * Transitions source status between states.
 */
export async function transitionSourceStatus(
  client: PoolClient | Pool | undefined,
  notebookId: string,
  attemptId: string,
  toStatus: "Uploading" | "Processing" | "Ready" | "Failed"
): Promise<void> {
  const m = notebookSources.get(notebookId);
  if (!m) return;
  const existing = m.get(attemptId);
  if (existing) {
    existing.status = toStatus;
    existing.updated_at = new Date().toISOString();
  }
}

/**
 * Releases source slot unconditionally.
 */
export async function releaseSourceSlot(
  client: PoolClient | Pool | undefined,
  notebookId: string,
  attemptId: string
): Promise<void> {
  await failSource(client, notebookId, attemptId, "Slot released");
}
