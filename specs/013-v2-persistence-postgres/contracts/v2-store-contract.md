# Internal Contract: v2 Store Interface

External contracts (HTTP routes, `packages/contracts` Zod schemas, error codes) do **not** change (`FR-002`). This file fixes the internal `@everlast/db` surface that apps rely on.

## Unchanged exports (same signatures and semantics)

- `workspace-preferences.ts`: `getNotebookMetadata`, `buildNotebookOverview`, `sortNotebookOverview`, `touchNotebookModified`, `setNotebookIcon`, `claimTopicIconSelection`, `setTopicIconIfDefault`, `getOwnerWorkspacePreferences`, `patchOwnerWorkspacePreferences`, `getOwnerNotebookPreferences`, `patchOwnerNotebookPreferences`, `setNotebookPinned`, `recordNotebookOpened`, `resolveEffectiveOutputLanguage`, `NotebookPreferenceScopeError`.
- `package-v2-2.ts`: `getSourceGuide`, `saveSourceGuide`, `deleteSourceGuides`, `getOverview`, `getOverviewForUser`, `saveOverview`, `getChatConfiguration`, `saveChatConfiguration`, `saveMessageFeedback`, `saveMessageFollowUps`, `getMessageFollowUps`, `clearMessageFeedback`, `getMessageFeedback`, `persistPackageV22AssistantMessage`.
- `notes.ts`: `createNote`, `listNotes`, `getNote`, `updateNote`, `deleteNote`, `saveResponseAsNote`, `convertToEditable` and the four error classes.
- `studio-artifacts.ts`: `StudioArtifactRepository` interface, `InMemoryStudioArtifactRepository`, `StudioRetryNotAllowedError`.
- Test helpers (`reset*Store`, `resetPocBridge`, `createPocNotebook`, `rememberNotebook`, `setReadySourceCount`, `deleteNotesForNotebook`, `forgetNotebook`) keep working in memory mode.

## New exports

| Export | Module | Contract |
| :- | :- | :- |
| `runWithV2Persistence(pool, fn)` | `v2-persistence.ts` | Runs `fn` and its async continuations with all v2 module stores bound to `pool` (used by the API per request and by `createV2Runtime`). |
| `configureV2Persistence(pool: Pool \| null): void` | `v2-persistence.ts` | Process default when no scope is active (store-level tests); `null` = memory test double. |
| `v2Pool(): Pool \| null` | `v2-persistence.ts` | Scope pool, else the default. |
| `getNotebookOwner(notebookId): Promise<string \| null>` | `poc-bridge.ts` | Owner of a live notebook (PostgreSQL `notebooks` in PG mode, mirror in memory mode). Replaces sync `getNotebookRaw(...)?.owner_id` in apps. |
| `getNotebookRecord(notebookId): Promise<Notebook \| null>` | `poc-bridge.ts` | Async notebook lookup with the same shape as `getNotebookRaw`. |
| `PostgresStudioArtifactRepository` | `studio-artifacts.ts` | `StudioArtifactRepository` over `studio_artifacts`; same errors and transition checks as the memory repository. |
| `sweepInterruptedStudioArtifacts(pool): Promise<number>` | `studio-artifacts.ts` | R5 Studio sweep; returns rows failed. |
| `sweepOrphanedSourceGuides(pool): Promise<number>` | `package-v2-2.ts` | R5 guide sweep; returns rows deleted. |

## Behavioural guarantees in PostgreSQL mode

- Every record read back equals the record written (Zod-parsed), across process restarts.
- Scoping: every read/write is filtered by notebook (and owner/user where the memory key had it); a record of another notebook or owner is never returned.
- Deleting a notebook (v1 `DELETE FROM notebooks`) removes all its v2 rows by cascade.
