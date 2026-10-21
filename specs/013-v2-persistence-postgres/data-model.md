# Data Model: v2 Data Persistence (PostgreSQL)

All tables live in the existing database (`D4`). `→` marks a foreign key; every foreign key is `ON DELETE CASCADE` unless stated. JSONB `record` columns hold the contract object and are parsed with the named Zod schema on write and read (`CC-05`).

## 0005_v2_workspace.sql (Package 2.1: `FR-WM-02`, `FR-WM-03`, `FR-UI-02`)

### notebook_v2_metadata
| Column | Type | Rule |
| :- | :- | :- |
| notebook_id | UUID PK → notebooks | one row per notebook, created on first write |
| icon_emoji | TEXT NOT NULL DEFAULT `DEFAULT_NOTEBOOK_ICON` | `NotebookIconSchema` |
| icon_source | TEXT NOT NULL DEFAULT 'default' | `default` / `topic` / `custom` |
| topic_selection_attempted | BOOLEAN NOT NULL DEFAULT false | claim flag (R4) |
| note_order_counter | INTEGER NOT NULL DEFAULT 0 | next note display order (R4) |

Absent row = defaults (`NotebookMetadataSchema` defaults). `ready_source_count` is derived from `sources`, never stored.

### user_preferences
`user_id UUID PK → users`, `record JSONB NOT NULL` (`OwnerWorkspacePreferencesSchema`), `updated_at`.

### notebook_user_preferences
`(user_id → users, notebook_id → notebooks)` PK, `record JSONB NOT NULL` (`OwnerNotebookPreferencesSchema`), `updated_at`.

## 0006_v2_context.sql (Package 2.2: `FR-SI-02`, `FR-GC-04/05/07/09`)

| Table | Key | Other columns | Record schema |
| :- | :- | :- | :- |
| source_guides | PK (source_id → sources, revision, output_language) | notebook_id → notebooks, status (`GuidePending`/`GuideReady`/`GuideFailed`), updated_at | `SourceGuideSchema` |
| notebook_overviews | PK cache_key | notebook_id → notebooks, authorization_key, updated_at | `NotebookOverviewSchema` |
| chat_configurations | PK (notebook_id → notebooks, user_id → users) | updated_at | `ChatConfigurationSchema` |
| message_feedback | PK (notebook_id → notebooks, user_id → users, message_id → chat_messages) | updated_at | `MessageFeedbackSchema` |
| message_followups | PK (notebook_id, user_id, message_id → chat_messages, output_language) | updated_at | `PersistedMessageFollowUpsSchema` |

Cascades: deleting a source removes its guides; clearing a chat thread removes feedback and follow-ups of its messages; deleting a notebook removes everything (`FR-008`, `CC-04`).

## 0007_notes.sql (Package 2.3: `FR-NM-01..04`)

`notes` as in `v3-draft/notes.sql` with: `owner_id UUID → users`, `title` limited by the API (`NOTE_TITLE_MAX_CODE_POINTS`), `UNIQUE (notebook_id, owner_id, source_message_id)` (saved-response idempotency), index `(notebook_id, owner_id, display_order)`. `source_message_id` has no foreign key (a saved note outlives a cleared chat, as today). `origin_note_id` has no foreign key (the editable copy outlives its original, as today).

State: `revision` starts at 1 and increments on every title/content change; `saved_response` rows are read-only (`NoteReadOnlyError`).

## 0008_studio_artifacts.sql (Package 2.4: `FR-ST-10/11`, `C-03`)

`studio_artifacts` as in `v3-draft/studio_artifacts.sql` with: `owner_id UUID → users`, `seq BIGINT GENERATED ALWAYS AS IDENTITY` (list order = insertion order), `retry_of → studio_artifacts ON DELETE SET NULL`, checks `payload iff Completed` and non-empty snapshot kept. Index `(notebook_id, owner_id, seq)`.

Lifecycle (`C-03`): `Queued → Running | Cancelled`, `Running → Completed | Failed | Cancelled`, terminal otherwise, enforced by `canTransitionStudioStatus` in a `SELECT … FOR UPDATE` transaction. **System transition (R5)**: the startup sweep moves `Queued`/`Running` rows last updated before the start to `Failed` with `GenerationError` and the interrupted message; it is the only path to `Failed` from `Queued`.

## Unchanged

`notebooks`, `sources`, `chat_*`, `note_source_provenance` keep their schema. `notebooks.updated_at` is additionally bumped by v2 content changes (R3).
