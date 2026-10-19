# Implementation Plan: Notes & Pinboard Lifecycle

**Branch**: `007-notes-pinboard-lifecycle` | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)
**Package Source**: `spec/requirements/v2/package_2_3_notes_pinboard_lifecycle.md`
**SRS IDs in Scope**: FR-NM-01, FR-NM-02, FR-NM-03, FR-NM-04, FR-GC-01, FR-GC-02, FR-GC-09, FR-SI-01, FR-WM-07, C-01, C-02, NFR-EVAL-02, NFR-EVAL-04 | **Release Gate**: `Gate v2.0` (#2 round trip; this package contributes, it does not close the gate)
**Input**: Feature specification from [spec.md](spec.md); binding rules from [`spec/requirements/README.md`](../../spec/requirements/README.md).

## Summary

Package 2.3 adds a persistent notes pinboard: manual notes with debounced auto-save and local draft recovery (`FR-NM-01`), read-only saved chat responses with copied citations and an idempotent save action shared with Package 2.2 (`FR-NM-02`, `FR-GC-09`), one-click conversion of one, selected, or all notes into a single bounded `Ready` source through the existing admission/ingestion path (`FR-NM-03`, `FR-WM-07`, `FR-SI-01`, `C-01`), and four contextual Note Assistant actions that first convert the exact selection into a note-source, wait for `Ready`, read only through `C-02`, and publish a citation-validated `ChatMessage` (`FR-NM-04`).

Technical approach (all choices stay inside the fixed stack `D1`–`D4`, `D6`, `D14`; no new framework, datastore, or idle-cost resource):

1. **Contracts** (`C-01`/`C-02` reused, never redefined): a new, self-contained `packages/contracts/src/package-v2-3.ts` holds the note/pinboard Zod schemas, limits, sanitizer, and helper functions; `index.ts` gets exactly one export line.
2. **Persistence**: `packages/db/src/notes.ts` (in-memory repository for tests/harness, same pattern as `chat-history.ts`) plus `packages/db/src/source-registry.ts` (Ready-source/chunk registry that implements the `C-02` read path for the harness) plus Postgres DDL `packages/db/migrations/0007_notes.sql` (`D1`).
3. **API**: `apps/api/src/notes/service.ts` orchestrates note CRUD, save-from-message, convert-to-editable, convert-to-source (atomic slot reservation via the existing `reserveSourceSlot`, ingestion through an injected `NoteSourceIngestor` port), and the Note Assistant (`GroundedChatAgent` + `C-02` reads + pre-publication citation validation). `apps/api/src/routes/notes.ts` exposes the HTTP routes.
4. **Worker**: `apps/worker/src/ingestion/note-markdown.ts` adapts the existing `IngestionPipeline` (Markdown parser, 300–600-token chunker, `C-01` chunks, byte/word limits) to the `NoteSourceIngestor` port, so conversion reuses the FR-SI-01 path instead of a parallel chunker.
5. **Web**: framework-free modules under `apps/web/src/notes/` (editor session with debounced save + draft recovery, pinboard state with selection/action bar/conversion gating, saved-response citation badges that open the Source Inspector).

## Technical Context

**Language/Version**: TypeScript 5.x (strict, ESM) on Node.js 24 (`pnpm` workspaces)
**Primary Dependencies**: Zod (`packages/contracts`); existing `GroundedChatAgent` (ADK-backed model adapter port) for the Note Assistant; no new runtime dependencies
**Storage**: Cloud SQL for PostgreSQL (`D1`/`D4`) via `0007_notes.sql`; in-memory repositories for unit/integration tests (same pattern as `chat-history.ts`, `quota.ts`)
**Authentication & Residency**: Identity Platform (`D6`); EU residency `europe-west4` (`D3`) — **no region exception**
**Testing**: Vitest (contract, db, api, worker, web, deterministic evals `NFR-EVAL-02/04`); Playwright UNAVAILABLE for this package (no new runnable page is added; web logic is covered by DOM-free Vitest modules)
**Execution Model**: Notes CRUD, save, convert, and ingestion are **deterministic pipelines**; only the Note Assistant synthesis step is an agentic/model call (constitution IV: "interactive note assistant"), invoked after the deterministic conversion succeeds
**Performance Goals**: Save to note ≤ 300 ms (`FR-NM-02`); ≤ 5,000-word note → `Ready` source ≤ 2.0 s (`FR-NM-03`, Gate v2.0 #2); validated TTFT ≤ 2.5 s after snapshot `Ready` (`FR-NM-04`, `D13`); auto-save ≤ 1.0 s after typing pause (`FR-NM-01`)
**Constraints**: Title 1–200 code points; body ≤ 100,000 words; 1–50 notes per assistant action; 200,000,000 bytes and 500,000 words per source (inclusive); Owner-only in v2 (`FR-WM-04/05`, `NFR-SEC-02`)
**Within-Release Prerequisites**: `C-01`/`C-02` and Packages 1.1–1.4 exist (v1.0 gate). Package 2.2 and 2.3 share one save-note contract — see [Shared save-note contract](#shared-save-note-contract-package-22--23). Package 2.4 (`C-03`) is not required.

## Constitution Check (`CC-01`..`CC-08`)

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Gate ID | Principle | Pre-Research Status | Post-Design Status | Verification Evidence / Notes |
| :--- | :--- | :--- | :--- | :--- |
| `CC-01` | **I. Traceability** | PASS | PASS | Every section cites SRS IDs; [spec.md](spec.md) transcribes the FR cards; design refinements (display order, source-title clamp, shared contract) are recorded in [research.md](research.md) and flowed back to `spec.md` and the FR card in `/speckit-analyze`. |
| `CC-02` | **II. Test-First** | PASS | PASS | [tasks.md](tasks.md) places failing spec-derived tests (Gherkin, 200/100,000/50/500,000/200,000,000 boundaries) before implementation in every story. |
| `CC-03` | **III. Scope & Snapshot** | PASS | PASS | Note Assistant passes explicit source IDs, captures `(source_id, revision)` at submission, reads only via the `C-02` provider (`getScopedContext`), and rechecks authorization/revisions before reading and publishing ([data-model.md](data-model.md), [contracts/interfaces.md](contracts/interfaces.md)). |
| `CC-04` | **III. Citations & Leakage** | PASS | PASS | Citations validated through the existing `verifyAndIndexCitations` before publication; failure → refusal, no stripped draft; deselected sources never enter prompts (`NFR-EVAL-02/04` covered in `packages/evals`). |
| `CC-05` | **IV. Contracts & Pipelines** | PASS | PASS | `C-01` chunks and `C-02` reads reused unchanged; new DTOs live in one contracts file; conversion/ingestion is deterministic, only synthesis is model-driven. |
| `CC-06` | **V. Release & Package Order** | PASS | PASS | Targets `v2.0`/Package 2.3 after Gate v1.0; no deferred items (`D5`, `D8`, `D10`) touched; 2.2/2.3 shared contract honored. |
| `CC-07` | **VI. Security, RBAC & Residency** | PASS | PASS | Server-side notebook ownership check on every route; Owner-only; one source slot reserved atomically before ingestion (`FR-WM-07`); failed conversion releases the slot; model calls go only through the enterprise adapter port (`NFR-SEC-01`); `europe-west4`. |
| `CC-08` | **Platform & Cost** | PASS | PASS | One new SQL migration on the existing Cloud SQL instance; no new service, datastore, or fixed-idle-cost resource. |

## Project Structure

### Documentation (this feature)

```text
specs/007-notes-pinboard-lifecycle/
├── spec.md              # Feature specification (/speckit-specify)
├── plan.md              # This file (/speckit-plan)
├── research.md          # Phase 0 decisions R1–R10
├── data-model.md        # Phase 1 entities, states, validation
├── quickstart.md        # Phase 1 validation guide
├── contracts/
│   └── interfaces.md    # HTTP routes, Zod DTOs, ports (NoteSourceIngestor, SourceRegistry)
├── checklists/
│   ├── requirements.md  # Spec quality (/speckit-specify)
│   └── ux.md            # Requirements-quality checklist (/speckit-checklist)
├── tasks.md             # /speckit-tasks
└── analysis.md          # /speckit-analyze
```

### Source Code (exact file boundaries for this feature)

```text
packages/contracts/
├── src/package-v2-3.ts          # NEW — all Package 2.3 schemas, limits, sanitizer, helpers
├── src/index.ts                 # +1 export line only (shared file)
└── test/package-v2-3.test.ts    # NEW

packages/db/
├── migrations/0007_notes.sql    # NEW — notes, note_source_origins tables
├── src/notes.ts                 # NEW — note repository (in-memory + SQL-shaped API)
├── src/source-registry.ts       # NEW — Ready source/chunk registry; C-02-style scoped read
├── src/index.ts                 # +2 export lines (shared file)
├── src/notebooks.ts             # +cleanup hook calls on notebook deletion (shared file, 2 lines)
└── test/notes.test.ts, notes-schema.test.ts   # NEW

apps/api/
├── src/notes/service.ts         # NEW — NotesService (CRUD, save, convert, assistant)
├── src/notes/assistant.ts       # NEW — Note Assistant action orchestration
├── src/routes/notes.ts          # NEW — HTTP route dispatcher
└── test/notes*.test.ts          # NEW

apps/worker/
├── src/ingestion/note-markdown.ts   # NEW — NoteSourceIngestor adapter over IngestionPipeline
└── test/note-markdown.test.ts       # NEW

apps/web/
├── src/notes/editor-session.ts  # NEW — debounced auto-save, flush on close, local draft
├── src/notes/pinboard.ts        # NEW — list/selection/action bar/convert gating state
├── src/notes/saved-response.ts  # NEW — citation badge rendering + inspector navigation
└── test/notes-*.test.ts         # NEW

packages/evals/test/notes-roundtrip.eval.test.ts   # NEW — NFR-EVAL-02/04 leakage + citation validity for the round trip
```

**Structure & File Ownership Decision**: This feature owns every file above except the three shared files (`packages/contracts/src/index.ts`, `packages/db/src/index.ts`, `packages/db/src/notebooks.ts`), which receive only additive one-to-two-line edits so concurrent branches (005/006/008) merge trivially. The server entrypoint (`apps/api/src/server.ts`) is intentionally **not** edited: like `routes/chat.ts` and `routes/chat-history.ts`, `handleNotesRoute` is an exported dispatcher that the later integration step mounts.

### Shared save-note contract (Package 2.2 ↔ 2.3)

`spec/requirements/README.md` (v2 row) requires Packages 2.2 and 2.3 to share one save-note contract. Package 2.2 (branch `006`) defines its variant in `packages/contracts/src/package-v2-2.ts`; this package defines `SaveNoteFromMessageInputSchema` / `SaveNoteResultSchema` in `package-v2-3.ts` following the FR-NM-02 card (`message_id` UUID; idempotent on `(user_id, message_id)`; `origin_type: 'saved_response'`; copied `content_md` + `citations_json`). **Reconcile at merge time**: keep the field names above as the canonical shape, re-export one from the other, and delete the duplicate; the HTTP route `POST /api/notebooks/:id/notes/from-message` is the single server entry point for both packages' "Save to note" buttons.

## Phase 0 / Phase 1 Outputs

- [research.md](research.md) — decisions R1–R10, no `NEEDS CLARIFICATION` remains.
- [data-model.md](data-model.md) — `Note`, saved-response fields, `NoteSource`, `NoteAssistantOperation`, state machines.
- [contracts/interfaces.md](contracts/interfaces.md) — routes, DTOs, ports, error codes.
- [quickstart.md](quickstart.md) — commands and expected outcomes.

## Complexity Tracking

No constitution violations; no `Dn` / `DEV-xx` entry is required. Two cross-tier refinements (display order of notes; converted-source title clamp to the existing 1–100 source-title limit) are recorded as flow-back items in [research.md](research.md) and applied to `spec.md` and the FR card during `/speckit-analyze`.
