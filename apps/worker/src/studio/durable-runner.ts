import { InvalidScopeError } from "@everlast/contracts";
import {
  captureScopeSnapshot,
  getNotebookOwner,
  listAllSnapshotChunks,
  PostgresStudioArtifactRepository,
  touchNotebookModified,
  verifyScopeSnapshot,
  type Pool,
  type StudioArtifactRecord,
} from "@everlast/db";
import { createStudioPluginRegistry, type StudioRegistryOptions } from "./registry.ts";
import { StudioJobRunner } from "./runner.ts";

/**
 * [011-studio-mindmaps-data-tables] PR #161 review — the worker's own consumer of the durable `studio` outbox
 * (FR-ST-08/18, C-02/C-03; FR-017, SC-011). Same repository, registry, C-02 reads and snapshot fence as the API's
 * inline runner, so a mindmap/data_table attempt whose API process died is recovered on the same attempt.
 * Runs inside `runWithV2Persistence(pool, …)` (the outbox handler binds it), which `getNotebookOwner` needs.
 */
export function createDurableStudioRunner(pool: Pool, options: StudioRegistryOptions = {}): { run(id: string): Promise<StudioArtifactRecord> } {
  const runner = new StudioJobRunner({
    repo: new PostgresStudioArtifactRepository(pool),
    registry: createStudioPluginRegistry(options),
    scopedContext: {
      async getScopedContext(notebookId, activeSourceIds, ownerId) {
        const owner = ownerId ?? (await getNotebookOwner(notebookId));
        if (!owner) throw new InvalidScopeError("Notebook is not available");
        return listAllSnapshotChunks(pool, await captureScopeSnapshot(pool, owner, notebookId, activeSourceIds));
      },
    },
    access: {
      async verifySnapshot(ownerId, notebookId, snapshot) {
        await verifyScopeSnapshot(pool, { notebook_id: notebookId, owner_id: ownerId, sources: snapshot });
      },
    },
  });
  return {
    async run(id: string) {
      const row = await runner.run(id);
      await touchNotebookModified(row.notebook_id).catch(() => undefined);
      return row;
    },
  };
}
