# Research: v2 Data Persistence (PostgreSQL)

All decisions trace to `DEV-04` / `D16` and spec 013. No open `NEEDS CLARIFICATION` remains (FR-012 resolved by the owner, 2026-10-21).

## R1 — How stores reach PostgreSQL

- **Decision**: A module `packages/db/src/v2-persistence.ts` resolves the pool for the current async context: `runWithV2Persistence(pool, fn)` (`AsyncLocalStorage`) used by the API for every request and by `createV2Runtime` for its own entry points and timers, then the process default `configureV2Persistence(pool | null)` (store-level tests). Every exported v2 store function keeps its signature and takes the PostgreSQL path when a pool is resolved, else its current in-memory path. *(Revised during implementation 2026-10-21: a plain process-wide default leaked between several test APIs in one process.)* Studio uses a new `PostgresStudioArtifactRepository` implementing the existing `StudioArtifactRepository` interface.
- **Rationale**: `D16` says v3 moves the stores "behind the existing repository functions". Keeping signatures leaves routes, services, workers and contracts untouched (`FR-002`). About 20 DB-less suites (worker, evals, store unit tests) keep working on the in-memory path.
- **Alternatives**: (a) add a `pool` parameter to every store function — touches every caller and test, no behavioural gain; (b) delete the in-memory paths — forces all unit suites onto PostgreSQL. Both rejected.
- **Safety**: the restart suite (`apps/api/test/v2-restart.integration.test.ts`) clears every in-memory store between two APIs on the same database, so a request that fell back to memory would fail it.

## R2 — Schema shape

- **Decision**: Notes and Studio artifacts use typed columns (from `v3-draft/`, adjusted: owner columns are `UUID REFERENCES users ON DELETE CASCADE`; Studio gets an identity `seq` for insertion order). Preferences, guides, overviews, chat configuration, feedback and follow-ups use typed key columns (for lookup, uniqueness and cascades) plus `record JSONB` holding the contract object, parsed with its existing Zod schema on write and read.
- **Rationale**: These records are read and written whole, by key; the contract schemas already validate them. JSONB avoids a second, drifting copy of each schema while key columns keep integrity and cascades in the database.
- **Alternatives**: fully typed columns for every field — more DDL and mapping code for records that are never queried by field. Rejected.

## R3 — Removing the in-process notebook mirror (`poc-bridge`)

- **Decision**: In PostgreSQL mode, owner/archive checks query `notebooks`; ready-source counts are counted from `sources` (`status = 'Ready' AND active_revision IS NOT NULL`); `touchNotebookModified` runs `UPDATE notebooks SET updated_at = greatest(now(), updated_at + interval '1 millisecond')`. `rememberNotebook`/`setReadySourceCount` become no-ops in PostgreSQL mode (kept for the memory test double). `ownerOf` in the runtime becomes async.
- **Rationale**: `FR-007`; the mirror is the reason the PoC needed one instance for access-adjacent data. The v1 row is the single source of truth for ownership and the content modified time (FR-WM-03).
- **Alternatives**: a separate `v2_modified_at` column — duplicates `updated_at` semantics. Rejected.

## R4 — Concurrency

- **Decision**: Note update/delete/convert run in a transaction with `SELECT … FOR UPDATE` on the note row (revision conflict and read-only checks as today). Saved responses use `INSERT … ON CONFLICT (notebook_id, owner_id, source_message_id) DO NOTHING` then read. The topic-icon claim is one conditional upsert on `notebook_v2_metadata` (`topic_selection_attempted = false AND icon_source = 'default'`). Note display order comes from `notebook_v2_metadata.note_order_counter` incremented with `UPDATE … RETURNING` (never reused after deletes, like the memory counter).
- **Rationale**: `FR-009` with exactly-one-winner semantics without application locks.

## R5 — Background work after a restart

- **Decision**: At runtime start (single instance, `FR-012`): `UPDATE studio_artifacts SET status = 'Failed', failure_json = {code: 'GenerationError', message: 'Report generation was interrupted by a service restart. Retry to generate it again.'}, progress_json = NULL WHERE status IN ('Queued','Running') AND updated_at < now()`; and `DELETE FROM source_guides WHERE status = 'GuidePending' AND updated_at < now()`. The API runtime's Ready hook first checks for an existing guide of that source revision in the effective language and skips generation if one exists (the worker's `onSourceReady` itself still always generates, as its tests expect). v2 requests, Ready dispatch and the watcher wait for the sweep, so nothing the new process starts is swept.
- **Rationale**: `FR-010`, `FR-011`, US3-1. Reports have Retry; guides are created automatically, so deleting an orphaned pending guide lets the existing on-open (`202 GuidePending` + start) and listing-time paths regenerate it. No new failure code: `GenerationError` exists in `StudioFailureCodeSchema` (`FR-002`). `updated_at < now()` (transaction start) keeps jobs created after start safe.
- **Alternatives**: resume interrupted reports — needs a durable job queue for Studio, out of scope for a single-instance PoC; add an `Interrupted` failure code — contract change. Rejected.

## R6 — Migrations and drafts

- **Decision**: `0005_v2_workspace.sql`, `0006_v2_context.sql`, `0007_notes.sql`, `0008_studio_artifacts.sql`; delete `migrations/v3-draft/`; repoint `notes-schema.test.ts` and `studio-artifacts-schema.test.ts` to the real migrations.
- **Rationale**: `FR-013`; one migration per v2 package area keeps review small. The v3 package branches must renumber any migration after this merges.
