import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

/**
 * Deletion fences and durable cleanup outbox (FR-WM-01, FR-WM-04).
 * Stores payload-free deletion operations with owner-scoped status checks.
 */

export interface CleanupOperation {
  id: string;
  operation_id: string;
  notebook_id: string;
  owner_id: string;
  status: "Pending" | "Running" | "Purged" | "Failed";
  created_at: Date;
  updated_at: Date;
  last_error_code?: string;
}

const cleanupStore = new Map<string, CleanupOperation>(); // operation_id -> operation

export async function recordCleanupOperation(
  client: PoolClient | undefined,
  notebookId: string,
  ownerId: string
): Promise<string> {
  const operationId = randomUUID();
  const now = new Date();

  const op: CleanupOperation = {
    id: randomUUID(),
    operation_id: operationId,
    notebook_id: notebookId,
    owner_id: ownerId,
    status: "Pending",
    created_at: now,
    updated_at: now,
  };

  cleanupStore.set(operationId, op);
  return operationId;
}

export async function getCleanupStatus(
  client: PoolClient | undefined,
  operationId: string,
  ownerId: string
): Promise<CleanupOperation | null> {
  const op = cleanupStore.get(operationId);
  if (!op) {
    return null;
  }
  // Original owner only
  if (op.owner_id !== ownerId) {
    return null;
  }
  return op;
}

export function getCleanupOperationRaw(
  operationId: string
): CleanupOperation | null {
  return cleanupStore.get(operationId) || null;
}

export function getLatestCleanupOperationForNotebook(
  notebookId: string
): CleanupOperation | null {
  const all = Array.from(cleanupStore.values());
  for (let i = all.length - 1; i >= 0; i--) {
    const op = all[i]!;
    if (op.notebook_id === notebookId) {
      return op;
    }
  }
  return null;
}

export async function updateCleanupOperationStatus(
  operationId: string,
  status: "Pending" | "Running" | "Purged" | "Failed",
  lastErrorCode?: string
): Promise<void> {
  const op = cleanupStore.get(operationId);
  if (op) {
    op.status = status;
    op.updated_at = new Date();
    if (lastErrorCode) {
      op.last_error_code = lastErrorCode;
    }
  }
}

export function resetCleanupStore(): void {
  cleanupStore.clear();
}
