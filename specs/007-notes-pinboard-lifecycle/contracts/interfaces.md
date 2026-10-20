# Interface Contracts: Notes & Pinboard Lifecycle

Trace: FR-NM-01, FR-NM-02, FR-NM-03, FR-NM-04, FR-GC-09, FR-SI-01, FR-WM-07, C-01, C-02. Storage: notes in memory (`D16`); note-sources are v1 PostgreSQL sources (owner decision 2026-10-20). `C-01` (`UnifiedDocumentChunk`) and `C-02` (`ScopedContextProvider`) are imported from `packages/contracts`; nothing here redefines them. All Zod schemas live in `packages/contracts/src/package-v2-3.ts`.

## Constants (FR-NM-01..04)

`DEFAULT_NOTE_TITLE="New note"`, `NOTE_TITLE_MAX_CODE_POINTS=200`, `NOTE_BODY_MAX_WORDS=100_000`, `NOTE_ASSISTANT_MAX_NOTES=50`, `COMBINED_NOTES_TITLE="Combined notes"`, `SOURCE_TITLE_MAX_CODE_POINTS=100`, `SAVED_TO_NOTES_MESSAGE="Saved to notes"`, `SOURCE_LIMIT_REACHED_MESSAGE="Source limit reached"`, `NOTE_AUTOSAVE_DEBOUNCE_MS=500`, `NOTE_AUTOSAVE_DEADLINE_MS=1000`.

## HTTP routes (Owner-only; every route verifies notebook ownership, `FR-WM-04`, `NFR-SEC-02`)

| Method + path | Purpose | Success | Errors |
| :--- | :--- | :--- | :--- |
| `GET /api/notebooks/:id/notes` | List notes in `display_order` (FR-NM-01) | 200 `{notes, source_slots:{used,limit}}` | 403 Forbidden |
| `POST /api/notebooks/:id/notes` | Create manual note, default title (FR-NM-01) | 201 `{note}` | 403, 422 ValidationError |
| `GET /api/notebooks/:id/notes/:noteId` | Open note | 200 `{note}` | 403, 404 NoteNotFound |
| `PATCH /api/notebooks/:id/notes/:noteId` | Auto-save `{title?, content_md?, base_revision?}` | 200 `{note}` | 404, 409 NoteReadOnly, 409 RevisionConflict, 422 |
| `DELETE /api/notebooks/:id/notes/:noteId` | Permanent delete, requires `?confirm=true` | 200 `{deleted:true}` | 400 ConfirmationRequired, 404 |
| `POST /api/notebooks/{notebook_id}/chat/messages/{message_id}/note` | Shared save-note route (FR-NM-02, FR-GC-09; Package 2.2 and 2.3). Body `{notebook_id, message_id}` equal to the path IDs | 200 `{note: {id, notebook_id, source_message_id, title, content_md, citations_json, origin_type: "saved_response", read_only: true, created_at}}`, same note on repeat | 400 ValidationError (invalid body or IDs differ from path), 404 MessageNotFound/NotFound, 503 |
| `POST /api/notebooks/:id/notes/:noteId/convert-to-editable` | Manual copy without citation badges (FR-NM-02) | 201 `{note}` | 404, 409 NotSavedResponse |
| `POST /api/notebooks/:id/notes/convert-to-source` | `{note_ids:[…], reuse?: boolean}` or `{all:true}` (FR-NM-03); `reuse: true` (used by the Note Assistant bar for its snapshot phase) returns an existing Ready note-source of the same notes and revisions | 201 `{source, reused}` (`source` is a v1 source DTO plus `origin_notes`, `origin_citations`) | 404 NoteNotFound (invalid/cross-notebook id), 409 SourceLimitReached ("Source limit reached"), 422 NoteSourceEmpty / SourceOversized / SourceOversizedWords, 502 IngestionFailed |
| `POST /api/notebooks/:id/notes/assistant` | `{action_type, selected_note_ids, selected_source_ids}` (FR-NM-04) | 200 `{message, messages, note_source, reused, snapshot, note_assertion_source_ids, citation_kinds}` (`messages` = question and answer as v1 history messages; citations carry `source_media_type`) | 400 ComparisonSourceRequired, 404, 409 SourceLimitReached, 409 SourceSnapshotInvalid, 422, 502 IngestionFailed, 503 Unavailable |

## Ports (`apps/api/src/notes/service.ts`)

```ts
// FR-NM-03 / FR-WM-07 / FR-SI-01 / C-01 — apps/api/src/notes/note-sources.ts over the v1 reservation and ingestion
interface NoteSourceStore {
  slots(notebookId: string): Promise<{ used: number; limit: number }>;
  findReusable(ownerId: string, notebookId: string, origins: NoteSourceOrigin[]): Promise<NoteSource | null>;
  create(ownerId: string, notebookId: string, input: { title: string; markdown: string;
         origin_notes: NoteSourceOrigin[]; origin_citations: Citation[] }): Promise<NoteSource>;
}
// FR-NM-04 / C-02 / FR-GC-06 — apps/api/src/v2/runtime.ts over captureScopeSnapshot, listSnapshotChunks,
// verifyScopeSnapshot and publishTurn (v1 PostgreSQL chat)
interface NoteAssistantContext {
  read(ownerId, notebookId, sourceIds): Promise<{ snapshot: SourceRevisionPair[]; chunks: UnifiedDocumentChunk[] }>;
  verify(ownerId, notebookId, snapshot): Promise<void>;
  publish(input: { ownerId; notebookId; snapshot; question; answer }): Promise<VisibleMessage[]>;
}
```

`C-01` chunks and `C-02` reads are the v1 ones; there is no separate note-source read path.

## Error → message mapping (exact strings)

`SourceLimitReached` → `"Source limit reached"`; `ComparisonSourceRequired` → `"Select a comparison source first"`; `NoteReadOnly` → `"Saved responses cannot be edited"`; `ConfirmationRequired` → `"Deletion must be confirmed"`.

## Universal failure rules

Over-limit values are rejected, never truncated; limits are inclusive (`200,000,000` bytes, `500,000` words, 200 code points, 100,000 words, 50 notes); a failed conversion releases its slot (source `Failed`) and makes **no** model call; upstream error text never reaches a response; stale or unauthorized captured source revisions fail without publishing output; all source reads use `C-02`.

## `Note` label (FR-NM-04, FR-017)

History and turn citations carry `source_media_type`; the Chat panel shows a `Note` label on every citation whose source is `note_markdown`. Note Assistant results also return `citation_kinds` (`note_assertion` | `source_fact`, keyed by chunk ID).
