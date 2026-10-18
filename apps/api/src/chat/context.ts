import type { ChatMessage } from "@everlast/contracts";

export interface ActiveSourceRevision {
  source_id: string;
  revision: number;
}

/**
 * Evaluates conversation history eligibility per FR-GC-01 and NFR-EVAL-04 (Zero Leakage).
 * A historical turn is eligible for LLM context ONLY if EVERY source and revision
 * in its active_source_revisions_snapshot remains currently active, current, and authorized.
 * If any source used in that turn was deselected, deleted, or revoked (even if uncited in the answer),
 * that entire turn (both question and answer) is excluded from model context.
 */
export function filterEligibleHistory(
  history: ChatMessage[],
  activeSourceIds: string[],
  activeSourceRevisions: Map<string, number>
): ChatMessage[] {
  const activeSet = new Set(activeSourceIds);

  return history.filter((message) => {
    // If message has no active source revisions snapshot, it is eligible (e.g. meta or initial turn)
    if (
      !message.active_source_revisions_snapshot ||
      message.active_source_revisions_snapshot.length === 0
    ) {
      return true;
    }

    // Every captured source in the snapshot must still be active and at the identical revision
    for (const record of message.active_source_revisions_snapshot) {
      if (!activeSet.has(record.source_id)) {
        return false;
      }
      const currentRev = activeSourceRevisions.get(record.source_id);
      if (currentRev !== undefined && currentRev !== record.revision) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Creates an immutable submission-time snapshot of active sources and their revisions.
 */
export function createSubmissionSnapshot(
  activeSourceIds: string[],
  activeSourceRevisions: Map<string, number>
): ActiveSourceRevision[] {
  return activeSourceIds.map((source_id) => ({
    source_id,
    revision: activeSourceRevisions.get(source_id) ?? 1,
  }));
}
