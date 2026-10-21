# Implementation Plan: v2 Data Persistence (PostgreSQL)

**Branch**: `013-v2-persistence-postgres` | **Date**: 2026-10-21 | **Spec**: [spec.md](spec.md)
**Package Source**: none (technical v3 prerequisite closing `DEV-04` / `D16`; behaviour from `spec/requirements/v2/package_2_1..2_4_*.md`)
**SRS IDs in Scope**: `DEV-04`, `FR-WM-01..04`, `FR-UI-02`, `FR-SI-02`, `FR-GC-04/05/07/09`, `FR-NM-01..04`, `FR-ST-10/11`, `C-02`, `C-03` | **Release Gate**: before `Gate v3.0`
**Input**: Feature specification from `specs/013-v2-persistence-postgres/spec.md`

## Summary

Release v2 keeps its records in module-level `Map`s inside `packages/db/src/{workspace-preferences,package-v2-2,notes,studio-artifacts,poc-bridge}.ts` (`D16`). This feature adds PostgreSQL tables for those records (four ordered migrations after `0004`, starting from `packages/db/migrations/v3-draft/`) and switches the stores to them **behind the existing repository functions**, as `D16` anticipated. The exported function signatures and every v2 route stay unchanged (`FR-002`). The in-process notebook mirror is removed: ownership, ready counts and the notebook modified time come from the v1 tables (`FR-007`). Startup sweeps resolve background work a stopped process left behind (`FR-010`, `FR-011`). The deployment keeps one API instance (`FR-012`, owner 2026-10-21).

Approach (details in [research.md](research.md)):

- **R1 Store selection**: `configureV2Persistence(pool)` in a new `packages/db/src/v2-persistence.ts`; `createV2Runtime` always calls it. Each store function takes the PostgreSQL path when a pool is configured, otherwise its existing in-memory path, which stays as the labelled test double for DB-less unit tests and evals.
- **R2 Schema**: typed tables for notes and Studio artifacts (from the drafts); typed key columns plus a Zod-validated `record JSONB` for preferences, guides, overviews, configuration, feedback and follow-ups. Every table references `notebooks` (and `users`, `sources`, `chat_messages` where applicable) `ON DELETE CASCADE` (`FR-008`).
- **R3 Mirror removal**: owner and archive checks read `notebooks`; ready counts are counted from `sources`; `touchNotebookModified` bumps `notebooks.updated_at` monotonically.
- **R4 Concurrency**: row locks or conditional `UPDATE … RETURNING` for note revisions, `ON CONFLICT` for saved responses, a conditional upsert for the topic-icon claim, and a per-notebook counter for note display order (`FR-009`).
- **R5 Restart sweeps**: at runtime start, Studio artifacts `Queued`/`Running` from before the start become `Failed` (`GenerationError`, interrupted message); orphaned `GuidePending` guides are deleted, so the next listing or open regenerates them. The Ready hook skips a source revision whose guide already exists in the effective language, so a restart never regenerates guides (`FR-011`, US3-1).

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode, ESM) on Node.js 24 (`pnpm` workspaces)
**Primary Dependencies**: `pg` (existing), Zod schemas in `packages/contracts` (unchanged)
**Storage**: the existing single Cloud SQL for PostgreSQL 16 instance (`D1`/`D4`); four new migrations `0005`–`0008`
**Authentication & Residency**: unchanged (`D6`); `europe-west4` (`D3`). Region-map exception: none
**Testing**: Vitest integration project against real PostgreSQL (`TEST_DATABASE_URL`, per-suite databases); existing v2 suites must pass unchanged; new restart suites start a second runtime/API on the same database. Playwright E2E unchanged.
**Execution Model**: Deterministic repositories; no model or agent changes. Background work stays in the API process (`FR-012`).
**Performance Goals**: v2 targets unchanged, e.g. note auto-save within 1.0 s of a typing pause (`FR-NM-01`).
**Constraints**: API contracts and error codes unchanged (`FR-002`); one API instance (`FR-012`); no new datastore (`CC-08`); Zod validation on every write and read of a JSONB record.
**Within-Release Prerequisites**: v2 packages 2.1–2.4 merged (specs/005–008); note-sources already in PostgreSQL (`0004_note_sources.sql`).

## Constitution Check (`CC-01`..`CC-08`)

| Gate ID | Principle | Pre-Research Status | Post-Design Status | Verification Evidence / Notes |
| :--- | :--- | :--- | :--- | :--- |
| `CC-01` | **I. Traceability** | PASS | PASS | Every requirement cites SRS IDs; tasks and tests will cite `DEV-04` plus the package FR IDs. Flow-back planned: SRS §5.5 `DEV-04` closed, §5.6 PoC note, `D16`, and the PoC notes in the four v2 FR cards (owner approval 2026-10-21). |
| `CC-02` | **II. Test-First** | PASS | PASS | Restart, cascade, concurrency and sweep tests are written first and observed failing (they fail today because data is lost on a new runtime); existing v2 suites act as regression. |
| `CC-03` | **III. Scope & Snapshot** | PASS | PASS | No change to source reads: v2 still reads sources only through `C-02`; Studio snapshots and the source-changed failure are unchanged. |
| `CC-04` | **III. Citations & Leakage** | PASS | PASS | Citation validation untouched. Cascades remove guides of deleted sources and feedback/follow-ups of deleted messages, so no stale v2 record outlives its source or message. |
| `CC-05` | **IV. Contracts & Pipelines** | PASS | PASS | Contracts unchanged; every stored JSONB record is parsed with its existing Zod schema on write and read. Studio lifecycle per `C-03`; the restart sweep is documented as the only system transition `Queued → Failed` (see data-model). |
| `CC-06` | **V. Release & Package Order** | PASS | PASS | v3 prerequisite before Gate v3.0; no deferred items touched. |
| `CC-07` | **VI. Security, RBAC & Residency** | PASS | PASS | Access is still decided by v1 ownership before any v2 handler; v2 queries are additionally scoped by notebook and owner. Owner-only (v1–v5). No region change. |
| `CC-08` | **Platform & Cost** | PASS | PASS | Uses the existing Cloud SQL instance; no new service, datastore or idle cost. |

## Project Structure

### Documentation (this feature)

```text
specs/013-v2-persistence-postgres/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── v2-store-contract.md   # Internal store interface: unchanged signatures + new persistence entry points
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code

```text
packages/db/
├── migrations/
│   ├── 0005_v2_workspace.sql        # notebook_v2_metadata, user_preferences, notebook_user_preferences
│   ├── 0006_v2_context.sql          # source_guides, notebook_overviews, chat_configurations, message_feedback, message_followups
│   ├── 0007_notes.sql               # from v3-draft/notes.sql
│   ├── 0008_studio_artifacts.sql    # from v3-draft/studio_artifacts.sql
│   └── v3-draft/                    # removed
├── src/
│   ├── v2-persistence.ts            # NEW: configureV2Persistence / v2Pool
│   ├── workspace-preferences.ts     # PG path + memory test double
│   ├── package-v2-2.ts              # PG path + memory test double
│   ├── notes.ts                     # PG path + memory test double
│   ├── studio-artifacts.ts          # + PostgresStudioArtifactRepository, sweepInterruptedStudioArtifacts
│   ├── poc-bridge.ts                # notebook mirror only in memory mode; PG mode reads notebooks/sources
│   └── index.ts
└── test/                            # new PG suites per store; schema tests repointed to real migrations

apps/api/src/
├── v2/runtime.ts                    # configure persistence, PG repo, async ownerOf, startup sweeps
├── routes/notebooks.ts              # drop ready-count mirroring
├── routes/workspace-preferences.ts  # async notebook lookup
└── services/workspace-preferences.ts

apps/worker/src/package-v2-2-runtime.ts      # Ready hook skips an existing guide (R5)
apps/api/test/v2-restart.integration.test.ts # NEW restart suite (US1–US4)

docs/solution-architecture.md (D16), spec/System_Requirements_Specification_Gemeni_Notebook.md (DEV-04, §5.6),
spec/requirements/v2/package_2_1..2_4_*.md (PoC notes)   # flow-back
```

**Structure & File Ownership Decision**: This feature owns the files above. Shared serialized files: `packages/db/migrations` (new numbers `0005`–`0008`; the v3 package branches 009–012 must renumber any migration after this merges), `docs/solution-architecture.md` and the SRS (owner-approved flow-back, 2026-10-21).

## Complexity Tracking

| Gate / Decision | Why Needed | Simpler Alternative Rejected Because |
| :--- | :--- | :--- |
| `D16` amendment (`CC-01`) | Closes the PoC deviation; documents the remaining single-instance constraint and the restart sweeps | Leaving `D16` as is would contradict the code |
| Memory test double kept (`CC-05`) | ~20 DB-less unit/eval suites (worker, evals, store unit tests) use the stores without PostgreSQL | Moving all of them onto PostgreSQL multiplies the change and slows the unit tier; production always configures PostgreSQL (asserted by test) |
