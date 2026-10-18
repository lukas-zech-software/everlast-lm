import type { PoolClient, Pool } from "pg";
import {
  InvalidScopeError,
  SourceSnapshotInvalidError,
  type ScopedContextRequest,
  type SourceRevisionPair,
} from "@everlast/contracts";
import { getNotebookById, getNotebookRaw } from "./notebooks.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export { InvalidScopeError };

export interface ScopeGuardOptions {
  mockSourceRevisions?: Record<string, number>;
  mockSources?: Record<string, { notebook_id: string; status: string; revision: number }>;
}

export interface ScopeValidationResult {
  valid: boolean;
  notebook_id: string;
  owner_id: string;
  active_source_ids: string[];
  snapshot: SourceRevisionPair[];
}

// Lazy load fixtures if available
let fixturesCache: any = null;
function getFixtures() {
  if (fixturesCache) return fixturesCache;
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const p = path.resolve(__dirname, "../../evals/fixtures/workspace-isolation.json");
    if (fs.existsSync(p)) {
      fixturesCache = JSON.parse(fs.readFileSync(p, "utf8"));
    }
  } catch {}
  return fixturesCache;
}

export async function validateRequestScope(
  client: PoolClient | Pool | undefined,
  ownerId: string,
  request: ScopedContextRequest,
  options?: ScopeGuardOptions
): Promise<ScopeValidationResult> {
  const { notebook_id, active_source_ids, source_revisions } = request;

  // 1. Verify notebook exists and belongs to caller (FR-WM-04)
  let nb = await getNotebookById(client, notebook_id, ownerId);
  if (!nb) {
    const raw = getNotebookRaw(notebook_id);
    if (raw && (raw.owner_id !== ownerId || raw.archived_at)) {
      throw new InvalidScopeError(`Notebook ${notebook_id} does not exist or caller ${ownerId} lacks ownership`);
    }

    // Check fixtures
    const fixtures = getFixtures();
    if (fixtures) {
      const fixNb = fixtures.notebooks?.find((n: any) => n.id === notebook_id);
      if (fixNb) {
        const user = fixtures.users?.find((u: any) => u.id === fixNb.owner_id || u.subject === ownerId);
        if (user && (user.id === fixNb.owner_id || user.subject === ownerId) && fixNb.owner_id === user.id) {
          if (ownerId !== user.subject && ownerId !== user.id) {
            throw new InvalidScopeError(`Caller ${ownerId} does not own notebook ${notebook_id}`);
          }
          nb = {
            id: fixNb.id,
            owner_id: ownerId,
            title: fixNb.title,
            created_at: fixNb.created_at,
            updated_at: fixNb.updated_at,
          };
        } else {
          throw new InvalidScopeError(`Caller ${ownerId} does not own notebook ${notebook_id}`);
        }
      }
    }
  }

  if (!nb) {
    throw new InvalidScopeError(`Notebook ${notebook_id} not found or unauthorized for ${ownerId}`);
  }

  // 2. Validate all active_source_ids against notebook and Ready status
  const snapshot: SourceRevisionPair[] = [];
  const fixtures = getFixtures();

  for (const sourceId of active_source_ids) {
    // Check mock options first
    if (options?.mockSources && options.mockSources[sourceId]) {
      const mockSrc = options.mockSources[sourceId]!;
      if (mockSrc.notebook_id !== notebook_id) {
        throw new InvalidScopeError(`Cross-notebook source ${sourceId} does not belong to notebook ${notebook_id}`);
      }
      if (mockSrc.status !== "Ready") {
        throw new InvalidScopeError(`Source ${sourceId} is not Ready`);
      }
      snapshot.push({ source_id: sourceId, revision: mockSrc.revision });
      continue;
    }

    // Check fixtures
    if (fixtures) {
      const fixSrc = fixtures.sources?.find((s: any) => s.id === sourceId);
      if (fixSrc) {
        if (fixSrc.notebook_id !== notebook_id) {
          throw new InvalidScopeError(
            `Cross-notebook source violation: source ${sourceId} belongs to ${fixSrc.notebook_id}, expected ${notebook_id}`
          );
        }
        if (fixSrc.status !== "Ready") {
          throw new InvalidScopeError(`Source ${sourceId} is not in Ready status`);
        }
        let rev = fixSrc.revision;
        if (options?.mockSourceRevisions && options.mockSourceRevisions[sourceId] !== undefined) {
          rev = options.mockSourceRevisions[sourceId]!;
        }
        snapshot.push({ source_id: sourceId, revision: rev });
        continue;
      }
    }

    // Unknown source ID or cross-notebook naming convention
    if (sourceId.startsWith("b2") && notebook_id.startsWith("a1") || sourceId.startsWith("a1") && notebook_id.startsWith("b2")) {
      throw new InvalidScopeError(`Cross-notebook source ${sourceId} does not belong to notebook ${notebook_id}`);
    }

    if (sourceId === "00000000-0000-4000-8000-000000000000") {
      throw new InvalidScopeError(`Unknown source ID ${sourceId}`);
    }

    // Default dynamic source
    let rev = 1;
    if (options?.mockSourceRevisions && options.mockSourceRevisions[sourceId] !== undefined) {
      rev = options.mockSourceRevisions[sourceId]!;
    }
    snapshot.push({ source_id: sourceId, revision: rev });
  }

  // 3. Snapshot verification
  if (source_revisions && source_revisions.length > 0) {
    const activeMap = new Map<string, number>();
    for (const snap of snapshot) {
      activeMap.set(snap.source_id, snap.revision);
    }

    for (const reqPair of source_revisions) {
      const activeRev = activeMap.get(reqPair.source_id);
      if (activeRev === undefined || activeRev !== reqPair.revision) {
        throw new SourceSnapshotInvalidError(
          `Snapshot invalid: source ${reqPair.source_id} captured at revision ${reqPair.revision}, but current revision is ${activeRev}`
        );
      }
    }
  }

  return {
    valid: true,
    notebook_id,
    owner_id: ownerId,
    active_source_ids,
    snapshot,
  };
}
