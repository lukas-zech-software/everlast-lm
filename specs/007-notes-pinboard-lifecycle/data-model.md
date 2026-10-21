# Data Model: Notes & Pinboard Lifecycle

**SRS IDs**: FR-NM-01..04, FR-GC-09, FR-SI-01, FR-WM-07, C-01, C-02 | **Plan**: [plan.md](plan.md)

## Note (`FR-NM-01`, `FR-NM-02`)

| Field | Type | Rules |
| :--- | :--- | :--- |
| `id` | UUID | Primary key |
| `notebook_id` | UUID | Owning notebook; cascade delete; every access checks ownership (`FR-WM-04`) |
| `owner_id` | string | Owner subject (v2 Owner-only) |
| `title` | string | 1–200 Unicode code points after trim; default `"New note"` |
| `content_md` | string | Sanitized Markdown; 0–100,000 words; empty allowed |
| `origin_type` | `'manual' \| 'saved_response'` | Immutable after creation |
| `source_message_id` | UUID \| null | Saved responses only; unique with `(notebook_id, owner_id)` for idempotent save (`FR-GC-09`) |
| `citations_json` | `Citation[]` | Saved responses only; copied independently of chat (`FR-NM-02`); `[]` when response had 0 citations |
| `origin_note_id` | UUID \| null | Set on an editable copy of a saved response |
| `revision` | int ≥ 1 | Incremented on each successful title/content change |
| `display_order` | int | Monotonic per notebook; defines "displayed order" for concatenation |
| `created_at`, `updated_at` | ISO datetime | |

**Lifecycle (`FR-NM-01`)**: `Drafting → Saved → Deleted`. Client drafts are local until a save is acknowledged; `Deleted` is a permanent hard delete (no tombstone).
**Saved-response state (`FR-NM-02`)**: `SavedReadOnly`; `convert-to-editable` creates a new `manual` note and leaves this one unchanged.

## NoteSource (`FR-NM-03`, `C-01`; owner decision 2026-10-20, `D16`)

A normal v1 PostgreSQL `sources` row with `media_type: 'note_markdown'`, `status` ∈ `Uploading | Processing | Ready | Failed`, its `source_revisions`, `source_pages` and `chunks` (with embeddings), plus one `note_source_provenance` row. It occupies one source slot from reservation until `Failed`, shared with uploads (`FR-WM-07`).

| Field | Rules |
| :--- | :--- |
| `title` | Single note → note title clamped to 100 code points; multi-note → `"Combined notes"` |
| `origin_notes` | `[{note_id, revision, title}]` snapshot in displayed order (`note_source_provenance.origin_notes`) |
| `origin_key` | Sorted `note_id:revision` set; the FR-NM-04 reuse key |
| `origin_citations` | Package 1.3 `Citation[]` copied from saved-response notes; provenance only, never cited |
| `chunks` | `UnifiedDocumentChunk[]` (`C-01`) from the v1 Markdown ingestion (`processIngestJob`) |
| `byte_size`, `word_count` | Inclusive limits 200,000,000 / 500,000 |

Content composition: single note → `# {title}\n\n{content}`; multiple → each note as `# {title}\n\n{content}` joined by `\n\n`, in `display_order`. Verified inline citation markers (`[[n]]` or `[n]` whose `n` is a badge of the note's citations) are removed before ingestion. Empty/whitespace-only combined **bodies** (all contents blank) → conversion rejected (`NoteSourceEmpty`).
**States**: `Note → IngestingAsSource (Uploading → Processing) → SourceReady`; failure → `Failed` (slot released), notes unchanged.
**Reuse (`FR-NM-04`, SRS §5.6)**: a Note Assistant action reuses a `Ready` note-source of the same notebook whose `origin_key` equals the selection's; a deleted source removes its provenance by cascade and is never reused.

## NoteAssistantOperation (`FR-NM-04`)

`{ action_type, selected_note_ids (1..50), selected_source_ids, note_source_id, snapshot: [{source_id, revision}], status: NotesSelected → Converting → Synthesizing → Completed | Failed, message: ChatMessage }`. The question and the validated result are published as one turn of the caller's v1 PostgreSQL chat thread (`publishTurn` with the scope snapshot as provenance), so they appear in `GET /chat` and are removed by Clear chat; a `Note` is created only through Save to note.

## Relationships

- Notebook 1—N Note; Note N—M NoteSource via `origin_notes` (snapshot, not a live link).
- Saved-response Note ↔ ChatMessage: **copy only** (`source_message_id` is a plain value, not a FK).
- NoteSource 1—N `UnifiedDocumentChunk`; reads only through `C-02`.

## Storage (`D16`, owner decision 2026-10-20)

- **Notes**: in-memory repository of the single API instance until v3; the designed table waits in `packages/db/migrations/v3-draft/notes.sql` (`notes(id, notebook_id FK→notebooks ON DELETE CASCADE, owner_id, title, content_md, origin_type CHECK, source_message_id, citations_json JSONB, origin_note_id, revision, display_order, created_at, updated_at, UNIQUE(notebook_id, owner_id, source_message_id))`).
- **Note-sources** (`packages/db/migrations/0004_note_sources.sql`): `sources.media_type` accepts `note_markdown`; `note_source_provenance(source_id PK, notebook_id, origin_key, origin_notes JSONB, origin_citations JSONB, created_at, FK (notebook_id, source_id) → sources ON DELETE CASCADE)` with an index on `(notebook_id, origin_key)`.
