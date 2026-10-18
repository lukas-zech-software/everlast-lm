import {
  type Citation,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";
import {
  verifyAndIndexCitations,
  DEFAULT_REFUSAL_MESSAGE,
} from "./citations.js";

export interface PublishTurnParams {
  notebookId: string;
  userId: string;
  threadId: string;
  expectedEpoch: number;
  draftText: string;
  activeChunks: UnifiedDocumentChunk[];
  activeSourceIds: string[];
  sourceTitles?: Map<string, string> | undefined;
  nliVerifier?: ((statement: string, chunk: UnifiedDocumentChunk) => Promise<boolean> | boolean) | undefined;
  getThreadEpoch?: ((notebookId: string, userId: string) => Promise<number>) | undefined;
  checkAuthorization?: ((notebookId: string, userId: string) => Promise<boolean>) | undefined;
  persistMessage?: ((params: {
    notebookId: string;
    userId: string;
    threadId: string;
    role: "assistant";
    content: string;
    citations: Citation[];
    generationEpoch: number;
  }) => Promise<{ id: string }>) | undefined;
}

export interface PublishedTurnResult {
  success: boolean;
  refusal: boolean;
  content: string;
  citations: Citation[];
  generationEpoch: number;
  messageId?: string | undefined;
  rejectedDueToEpoch?: boolean | undefined;
  error?: string | undefined;
}

export class EpochMismatchError extends Error {
  constructor(message = "Thread epoch changed: generation was cancelled or cleared") {
    super(message);
    this.name = "EpochMismatchError";
  }
}

/**
 * Publication gate for assistant turns (FR-GC-02, C-02, D13).
 * Enforces:
 * - Thread epoch verification: rejects late results if user cleared chat or bumped epoch.
 * - Current authorization check before publication.
 * - D13 citation verification: invalid chunk IDs withhold the entire draft and publish refusal without regeneration.
 * - Atomic persistence of validated response.
 */
export async function publishTurn(
  params: PublishTurnParams
): Promise<PublishedTurnResult> {
  const {
    notebookId,
    userId,
    threadId,
    expectedEpoch,
    draftText,
    activeChunks,
    sourceTitles,
    nliVerifier,
    getThreadEpoch,
    checkAuthorization,
    persistMessage,
  } = params;

  // 1. Authorization check
  if (checkAuthorization) {
    const isAuthorized = await checkAuthorization(notebookId, userId);
    if (!isAuthorized) {
      return {
        success: false,
        refusal: false,
        content: "",
        citations: [],
        generationEpoch: expectedEpoch,
        error: "Unauthorized notebook access",
      };
    }
  }

  // 2. Thread epoch check before verification & persistence
  if (getThreadEpoch) {
    const currentEpoch = await getThreadEpoch(notebookId, userId);
    if (currentEpoch !== expectedEpoch) {
      return {
        success: false,
        refusal: false,
        rejectedDueToEpoch: true,
        content: "",
        citations: [],
        generationEpoch: currentEpoch,
        error: "Generation epoch mismatch: thread was cleared or reset",
      };
    }
  }

  // 3. Verify citations against active context
  const verification = await verifyAndIndexCitations(draftText, activeChunks, {
    sourceTitles,
    nliVerifier,
  });

  // 4. Persistence
  let messageId: string | undefined;

  if (verification.valid) {
    if (persistMessage) {
      const persisted = await persistMessage({
        notebookId,
        userId,
        threadId,
        role: "assistant",
        content: verification.processedContent,
        citations: verification.citations,
        generationEpoch: expectedEpoch,
      });
      messageId = persisted.id;
    }

    return {
      success: true,
      refusal: verification.refusal,
      content: verification.processedContent,
      citations: verification.citations,
      generationEpoch: expectedEpoch,
      messageId,
    };
  }

  // 5. Verification failed: D13 refusal publication
  if (persistMessage) {
    const persisted = await persistMessage({
      notebookId,
      userId,
      threadId,
      role: "assistant",
      content: verification.processedContent || DEFAULT_REFUSAL_MESSAGE,
      citations: [],
      generationEpoch: expectedEpoch,
    });
    messageId = persisted.id;
  }

  return {
    success: true,
    refusal: true,
    content: verification.processedContent || DEFAULT_REFUSAL_MESSAGE,
    citations: [],
    generationEpoch: expectedEpoch,
    messageId,
  };
}
