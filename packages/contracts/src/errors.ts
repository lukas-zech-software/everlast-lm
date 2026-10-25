/**
 * Shared application error model (FR-WM-01, FR-WM-04, FR-WM-07, C-02).
 * Every error carries a stable `code` and HTTP `status`; messages never include source content.
 */

export type AppErrorCode =
  | "Unauthenticated"
  | "Forbidden"
  | "NotFound"
  | "NotebookNotFound"
  | "SourceNotFound"
  | "DeletionNotFound"
  | "ValidationFailed"
  | "InvalidTitle"
  | "NotebookQuotaExceeded"
  | "SourceQuotaExceeded"
  | "SourceOversized"
  | "SourceOversizedWords"
  | "DishonestDeclaration"
  | "UnsupportedMediaType"
  | "EmptyScope"
  | "InvalidScope"
  | "SourceNotReady"
  | "SourceSnapshotInvalid"
  | "GenerationCancelled"
  | "MethodNotAllowed"
  | "PayloadTooLarge"
  | "RetryableFailure"
  | "InternalError"
  // Release v2 (FR-WM-02, FR-WM-03, FR-UI-02)
  | "InvalidPreference"
  | "InvalidEmoji"
  // Release v3 package 3.1 (FR-SI-01, FR-SI-05)
  | "SyncAlreadyInProgress"
  | "DelegatedAccessDenied"
  // Release v3 package 3.2 (FR-GC-08)
  | "ExecutionInProgress"
  | "RequestAlreadyHandled";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;

  constructor(code: AppErrorCode, status: number, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
