# Implementation Plan: Notes & Pinboard Lifecycle

**Branch**: `007-notes-pinboard-lifecycle` | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)
**Package Source**: `spec/requirements/v2/package_2_3_notes_pinboard_lifecycle.md`
**SRS IDs in Scope**: FR-NM-01, FR-NM-02, FR-NM-03, FR-NM-04, FR-GC-01, FR-GC-02, FR-GC-09, FR-SI-01, FR-WM-07, C-01, C-02, NFR-EVAL-02, NFR-EVAL-04 | **Release Gate**: `Gate v2.0` (#2 round trip; this package contributes, it does not close the gate)
**Input**: Feature specification from [spec.md](spec.md); binding rules from [`spec/requirements/README.md`](../../spec/requirements/README.md).

## Summary

Package 2.3 adds a persistent notes pinboard: manual notes with debounced auto-save and local draft recovery (`FR-NM-01`), read-only saved chat responses with copied citations and an idempotent save action shared with Package 2.2 (`FR-NM-02`, `FR-GC-09`), one-click conversion of one, selected, or all notes into a single bounded `Ready` source through the existing admission/ingestion path (`FR-NM-03`, `FR-WM-07`, `FR-SI-01`, `C-01`), and four contextual Note Assistant actions that first convert the exact selection into a note-source, wait for `Ready`, read only through `C-02`, and publish a citation-validated `ChatMessage` (`FR-NM-04`).

Technical approach (all choices stay inside the fixed stack `D1`–`D4`, `D6`, `D14`; no new framework, datastore, or idle-cost resource):

1. **Contracts** (`C-01`/`C-02` reused, never redefined): a new, self-contained `packages/contracts/src/package-v2-3.ts` holds the note/pinboard Zod schemas, limits, sanitizer, and helper functions; `index.ts` gets exactly one export line.
2. **Persistence (`D16`, owner decision 2026-10-20)**: notes stay in the in-memory repository `packages/db/src/notes.ts` of the single API instance until v3 (designed tables in `packages/db/migrations/v3-draft/notes.sql`). Note-sources are normal v1 PostgreSQL `sources` rows (`media_type: note_markdown`) with `chunks`/embeddings; their provenance (origin notes with revisions, reuse key, copied citations) lives in `note_source_provenance` (migration `packages/db/migrations/0004_note_sources.sql`, repository `packages/db/src/note-sources.ts`). The former in-memory note-source registry is removed.
3. **API**: `apps/api/src/notes/service.ts` orchestrates note CRUD, the shared save-note action, convert-to-editable, convert-to-source and the Note Assistant through two ports: `NoteSourceStore` (implemented by `apps/api/src/notes/note-sources.ts` over the v1 reservation and ingestion) and `NoteAssistantContext` (C-02 capture, bounded chunk read, revision recheck and publication to the v1 PostgreSQL chat thread, implemented in `apps/api/src/v2/runtime.ts`). `apps/api/src/routes/notes.ts` exposes the notes routes; the shared save-note route lives in `apps/api/src/routes/package-v2-2.ts`. Both are mounted by the v2 runtime behind the v1 ownership check (`apps/api/src/app.ts`).
4. **Worker**: `apps/worker/src/ingestion/note-markdown.ts` runs the v1 ingest job (`processIngestJob`: Markdown sections, 300–600-token chunker, `C-01` chunks, embeddings, atomic Ready publication) for one note-source at once, so conversion is synchronous and reuses the FR-SI-01 path instead of a parallel chunker. `media_type: note_markdown` is parsed as Markdown.
5. **Web**: the Right Panel notes pinboard `apps/web/src/notes/panel.ts` over the framework-free modules under `apps/web/src/notes/` (editor session with debounced save + draft recovery, pinboard state with selection/action bar/conversion gating, saved-response citation badges that open the Source Inspector, Note Assistant bar), mounted from `apps/web/src/workspace/index.ts`.

## Technical Context

**Language/Version**: TypeScript 5.x (strict, ESM) on Node.js 24 (`pnpm` workspaces)
**Primary Dependencies**: Zod (`packages/contracts`); existing `GroundedChatAgent` (ADK-backed model adapter port) for the Note Assistant; no new runtime dependencies
**Storage**: Notes in process memory of the single API instance (`D16`, SRS `DEV-04`); note-sources, their chunks, provenance (`0004_note_sources.sql`) and Note Assistant chat turns in Cloud SQL for PostgreSQL (`D1`/`D4`), owner decision 2026-10-20
**Authentication & Residency**: Identity Platform (`D6`); EU residency `europe-west4` (`D3`) — **no region exception**
**Testing**: Vitest (contract, db, api and worker integration on real PostgreSQL via `TEST_DATABASE_URL`, web DOM tests, deterministic evals `NFR-EVAL-02/04`); Playwright `apps/web/test/notes-roundtrip.spec.ts` runs the Gate v2.0 #2 round trip in the browser against `apps/web/test/e2e-server.ts` (fixture model); live TTFT and LLM-judged evals stay `UNAVAILABLE` until a deployed run exists
**Model routing**: the Note Assistant uses the v1 grounded model (`createGroundedModelFromEnv`: ADK `Gemini`, `vertexai: true`, `europe-west4`, `gemini-2.5-flash`, keyless ADC) and the v1 citation verifier; never `GEMINI_API_KEY`/`GOOGLE_API_KEY`; without Vertex configuration the route answers `503`
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
| `CC-08` | **Platform & Cost** | PASS | PASS | One backward-compatible SQL migration (`0004_note_sources.sql`) on the existing Cloud SQL instance; notes stay in memory (`D16`); no new service, datastore, or fixed-idle-cost resource. |

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
├── src/package-v2-3.ts          # Package 2.3 schemas, limits, sanitizer, marker stripping, shared save-note DTO
├── src/package-v2-2.ts          # re-exports the shared save-note schemas
├── src/package-v1-2.ts          # SourceMediaTypeSchema + "note_markdown"
└── test/package-v2-3.test.ts

packages/db/
├── migrations/0004_note_sources.sql   # sources.media_type + note_markdown; note_source_provenance (owner decision 2026-10-20)
├── migrations/v3-draft/notes.sql      # notes table for v3 (not applied, D16)
├── src/notes.ts                 # in-memory note repository (D16); sanitizes every write
├── src/note-sources.ts          # note-source provenance and reuse lookup (PostgreSQL)
├── src/chat-history.ts          # history citations carry source_media_type (Note label)
└── test/notes.test.ts, notes-schema.test.ts, note-sources.integration.test.ts

apps/api/
├── src/notes/service.ts         # NotesService (CRUD, save, convert, reuse, assistant)
├── src/notes/note-sources.ts    # NoteSourceStore over v1 reserveSources + ingestion
├── src/notes/assistant-model.ts # grounded model + v1 verifier for the Note Assistant
├── src/routes/notes.ts          # notes HTTP routes
├── src/routes/package-v2-2.ts   # shared save-note route
├── src/v2/runtime.ts            # mounts the routes; NoteAssistantContext over C-02 and the PostgreSQL chat
└── test/notes*.test.ts          # PostgreSQL integration tests (quota, round trip, assistant, convert)

apps/worker/
├── src/ingestion/note-markdown.ts   # runs the v1 ingest job for one note-source at once
├── src/ingestion/extract.ts         # note_markdown parsed as Markdown
└── test/note-markdown.test.ts

apps/web/
├── src/notes/panel.ts           # Right Panel notes pinboard (list, editor, viewer, convert, assistant bar)
├── src/notes/editor-session.ts  # debounced auto-save, flush on close, local draft
├── src/notes/pinboard.ts        # ordering, selection, convert gating
├── src/notes/saved-response.ts  # citation badge segments + inspector navigation
├── src/notes/assistant.ts       # action availability and disclosure
├── src/chat/panel.ts            # append messages; Note label on note-source citations
└── test/notes-*.test.ts, notes-roundtrip.spec.ts

packages/evals/test/notes-roundtrip.eval.test.ts   # NFR-EVAL-02/04 leakage + citation validity for note-sources on PostgreSQL
```

**Structure & File Ownership Decision**: This feature owns the notes files above. The v2 runtime (`apps/api/src/v2/runtime.ts`) mounts `handleNotesRoute` and the shared save-note route behind the v1 ownership check; `apps/api/src/server.ts` and `apps/web/test/e2e-server.ts` pass storage, embedder and job notifier to it so note-sources use the v1 ingestion. Shared v1 files receive additive edits only: `SourceMediaTypeSchema` (+`note_markdown`), the history projection (`source_media_type` on citations for the `Note` label), `extractPlainText` (`note_markdown` as Markdown) and the chat panel (append messages, `Note` label).

### Note-sources are v1 sources (owner decision 2026-10-20, `D16` amendment)

- **Admission (`FR-WM-07`, Constitution VI)**: conversion calls the v1 `reserveSources` with `media_type: note_markdown` under the notebook row lock, so uploads, copied text and note-sources count against one limit and concurrent conversions cannot exceed it. The in-flight `Uploading`/`Processing` row holds the slot until `Ready` or `Failed`; `GET /notes` reports `source_slots.used` from the same occupancy count.
- **Ingestion (`FR-SI-01`, `C-01`)**: the combined Markdown (inline citation markers removed) is written as the raw object, received (`acceptReceivedSource`, durable ingest job) and ingested at once in the API process (`processIngestJob`, the same function the worker runs). Any failure marks the source `Failed`, which releases the slot, and returns `502` with a fixed message; the queued job then finds the source settled and does nothing.
- **Reads (`C-02`)**: the Left Panel list (`GET /api/notebooks/:id/sources`), the v1 chat retrieval, the history projection and the Source Inspector read note-sources like any upload. No second read path exists.
- **Provenance and reuse (`FR-NM-03/04`, SRS §5.6)**: `note_source_provenance` stores `origin_notes [{note_id, revision, title}]`, the reuse key (sorted `note_id:revision` set) and `origin_citations` (Package 1.3 `Citation[]`). An assistant action looks up a `Ready` note-source with the same key and reuses it without a slot; deleting the source removes its provenance (cascade), so it is not reused.
- **`Note` label (`FR-NM-04`)**: history and turn citations carry `source_media_type`; the chat shows a `Note` label for `note_markdown` sources, and the Note Assistant result also returns `citation_kinds`.
- **Client selection (`FR-NM-03`)**: the requesting browser calls `SelectionModel.markImported(source.id)` and refreshes the Left Panel; other clients are not changed.

### Shared save-note contract (Package 2.2 ↔ 2.3)

`spec/requirements/README.md` (v2 row) requires Packages 2.2 and 2.3 to share one save-note contract. The single server entry point is `POST /api/notebooks/{notebook_id}/chat/messages/{message_id}/note` (`apps/api/src/routes/package-v2-2.ts`), which writes through `NotesService.saveFromMessage`. The request schema `SaveResponseNoteRequestSchema` (`{notebook_id, message_id}`) and the response schemas `SavedResponseNoteSchema` / `SaveResponseNoteResponseSchema` are defined once in `packages/contracts/src/package-v2-3.ts` and re-exported by `package-v2-2.ts`. The former `POST /notes/from-message` route and `SaveNoteFromMessageInputSchema` are removed. Title = preceding user question trimmed to 200 code points, else `Saved response`; body IDs different from the path IDs → `400`; idempotent on `(user_id, message_id)`.

## Phase 0 / Phase 1 Outputs

- [research.md](research.md) — decisions R1–R10, no `NEEDS CLARIFICATION` remains.
- [data-model.md](data-model.md) — `Note`, saved-response fields, `NoteSource`, `NoteAssistantOperation`, state machines.
- [contracts/interfaces.md](contracts/interfaces.md) — routes, DTOs, ports, error codes.
- [quickstart.md](quickstart.md) — commands and expected outcomes.

## Complexity Tracking

No constitution violations. Storage follows `D16` / `DEV-04`, amended on 2026-10-20 by the project owner for note-sources (v1 PostgreSQL sources; notes stay in memory). Two cross-tier refinements (display order of notes; converted-source title clamp to the existing 1–100 source-title limit) are recorded as flow-back items in [research.md](research.md) and applied to `spec.md` and the FR card during `/speckit-analyze`.
