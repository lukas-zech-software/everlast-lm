# Interface Contracts: Notes & Pinboard Lifecycle

Trace: FR-NM-01, FR-NM-02, FR-NM-03, FR-NM-04, FR-GC-09, FR-SI-01, FR-WM-07, C-01, C-02. `C-01` (`UnifiedDocumentChunk`) and `C-02` (`ScopedContextProvider`) are imported from `packages/contracts`; nothing here redefines them. All Zod schemas live in `packages/contracts/src/package-v2-3.ts`.

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
| `POST /api/notebooks/:id/notes/from-message` | Save to note `{message_id}` (FR-NM-02, FR-GC-09; shared with 2.2) | 201 `{note, created:true, toast:"Saved to notes"}`; 200 `{note, created:false}` on repeat | 403, 404 MessageNotFound, 422 |
| `POST /api/notebooks/:id/notes/:noteId/convert-to-editable` | Manual copy without citation badges (FR-NM-02) | 201 `{note}` | 404, 409 NotSavedResponse |
| `POST /api/notebooks/:id/notes/convert-to-source` | `{note_ids:[…]}` or `{all:true}` (FR-NM-03) | 201 `{source}` | 404 NoteNotFound (invalid/cross-notebook id), 409 SourceLimitReached ("Source limit reached"), 422 NoteSourceEmpty / SourceOversized / SourceOversizedWords, 502 IngestionFailed |
| `POST /api/notebooks/:id/notes/assistant` | `{action_type, selected_note_ids, selected_source_ids}` (FR-NM-04) | 200 `{message, note_source, snapshot, note_assertion_source_ids}` | 400 ComparisonSourceRequired, 404, 409 SourceLimitReached, 409 SourceSnapshotInvalid, 422, 502 |

## Ports

```ts
// FR-NM-03 / FR-SI-01 / C-01 — implemented in apps/worker over IngestionPipeline
interface NoteSourceIngestor {
  ingest(input: { attempt_id: string; notebook_id: string; source_id: string; revision_id: number;
                  title: string; markdown: string }): Promise<NoteSourceIngestionResult>;
}
// NoteSourceIngestionResult = { status: 'Ready' | 'Failed'; byte_size; word_count; chunks: UnifiedDocumentChunk[]; error_message? }

// C-02 — implemented by packages/db source-registry (and by the production Postgres provider)
interface ScopedContextProvider { getScopedContext(notebook_id: string, active_source_ids: string[]): Promise<UnifiedDocumentChunk[]> }
```

## Error → message mapping (exact strings)

`SourceLimitReached` → `"Source limit reached"`; `ComparisonSourceRequired` → `"Select a comparison source first"`; `NoteReadOnly` → `"Saved responses cannot be edited"`; `ConfirmationRequired` → `"Deletion must be confirmed"`.

## Universal failure rules

Over-limit values are rejected, never truncated; limits are inclusive (`200,000,000` bytes, `500,000` words, 200 code points, 100,000 words, 50 notes); a failed conversion releases its slot and makes **no** model call; stale or unauthorized captured source revisions fail without publishing output; all source reads use `C-02`.
