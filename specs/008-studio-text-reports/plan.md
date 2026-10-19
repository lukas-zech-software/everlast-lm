# Implementation Plan: Studio Text Synthesis & Reports

**Branch**: `008-studio-text-reports` | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)
**Package Source**: `spec/requirements/v2/package_2_4_studio_text_synthesis_reports.md`
**SRS IDs in Scope**: FR-ST-10, FR-ST-11, C-02, C-03, NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-04, NFR-SEC-02, FR-NM-03 (conversion reuse), FR-SI-02 (Source Guide input) | **Release Gate**: Gate v2.0 #3 (contributes, does not independently satisfy Gate v2.0)
**Input**: Feature specification from [spec.md](spec.md) (clarified 2026-10-18) and [binding cross-package rules](../../spec/requirements/README.md).

## Summary

Package 2.4 introduces **C-03 `StudioGeneratorPlugin`** (one shared Zod/TS definition in `packages/contracts`, `D2`) with the `StudioPluginRegistry` and the unified `Queued → Running → Completed | Failed | Cancelled` lifecycle, and ships the first plugin: `report` with six subtypes (`briefing_doc`, `study_guide`, `faq`, `timeline`, `dynamic`, `custom`) for FR-ST-10/11. Reports are **deterministic pipelines** (Constitution IV, no ADK `LlmAgent` loop): bounded map-reduce batches over **all** scoped C-01 chunks obtained only through `C-02 getScopedContext` (`D12`), an injectable structured-output model client (a deterministic fake ships for tests and local runs; the Gemini Flash/Flash-Lite client is a configuration-time adapter, `NFR-SEC-01`), pre-publication citation validation (`D13`), and submission-time `(source_id, revision)` snapshots with access re-checks before reading and before publishing. Delivery slices: contracts → in-memory repository (+ Postgres DDL) → worker runner/registry → report generators → API routes → web modules.

## Technical Context

**Language/Version**: TypeScript 5.x (strict, ESM) on Node.js 24 (`pnpm` workspaces)
**Primary Dependencies**: Zod (`packages/contracts`); no new runtime dependency. Gemini access is behind the `ReportModelClient` interface (no SDK import in this slice, `D1`–`D4` unchanged).
**Storage**: Single Cloud SQL for PostgreSQL (`D4`): new table `studio_artifacts` (migration `0004_studio_artifacts.sql`); an in-memory repository implements the same interface for tests (existing `chat-history.ts` pattern). No new datastore.
**Authentication & Residency**: Identity Platform OIDC (`D6`); EU `europe-west4` (`D3`) — **no region exception**. Model endpoints are enterprise Gemini only (`NFR-SEC-01`); the fake model never leaves the process.
**Testing**: Vitest (contract, db, worker, api, web unit/integration, deterministic evals `NFR-EVAL-02/04`). Playwright E2E: `UNAVAILABLE` for this slice (no browser journey harness for Studio yet). LLM-judged suites (`NFR-EVAL-01/03`) require a live model: `UNAVAILABLE` here, required before Gate v2.0.
**Execution Model**: Deterministic pipelines only (reports, dynamic suggestions). No ADK `LlmAgent` loop; model calls are fixed steps (map → reduce) with structured outputs.
**Performance Goals**: Standard templates P95 ≤ 25.0 s (FR-ST-10, Gate v2.0 #3); dynamic suggestions ≤ 3.0 s, cached per source-set identity (FR-ST-11). Suggestion calls are hard-bounded by a 3,000 ms timeout.
**Constraints**: Owner-only (v2.0); explicit non-empty `active_source_ids` (never an all-sources fallback); custom prompt 1–5,000 Unicode code points after trimming, no truncation; retry = new attempt with a fresh explicit scope; Markdown only (no PDF/DOCX export).
**Within-Release Prerequisites** (`spec/requirements/README.md`): 2.1 language preference precedes language-sensitive generators (consumed as an optional `output_language` string that is part of cache keys); 2.4 defines C-03; Source Guide (FR-SI-02) is consumed through the `SourceGuideProvider` interface and is asynchronous; FR-NM-03 note/source conversion is consumed through a `ConvertToSource` port; C-01/C-02 are reused from `packages/contracts` (`document-chunk.ts`, `scoped-context.ts`).

## Constitution Check (`CC-01`..`CC-08`)

| Gate ID | Principle | Pre-Research Status | Post-Design Status | Verification Evidence / Notes |
| :--- | :--- | :--- | :--- | :--- |
| `CC-01` | **I. Traceability** | PASS | PASS | Every design element below and every task cites FR-ST-10/11, C-02/03, NFR-*. Plan refinements (C-03 shape, retry semantics, suggestion states, failure codes) are flowed back into [spec.md](spec.md) (§Plan Refinements) and the FR card (edge cases) before implementation. |
| `CC-02` | **II. Test-First** | PASS | PASS | [tasks.md](tasks.md) places Red tests before implementation in every phase, covering all Gherkin scenarios, the 1/5,000/5,001 prompt boundaries, 3–4 suggestions, 3.0 s and 25.0 s targets. |
| `CC-03` | **III. Scope & Snapshot** | PASS | PASS | Reads only via `ScopedContextProvider.getScopedContext` (C-02) with explicit IDs; snapshot captured at submission; `StudioAccessVerifier` runs before read and before publish; chunk revisions compared with the snapshot (no silent substitution). |
| `CC-04` | **III. Citations & Leakage** | PASS | PASS | `validateReportCitations` (D13, NFR-EVAL-02): every cited `chunk_id` ∈ scoped chunks with matching source/revision, verbatim quotes and dates must occur in cited chunk text; failure → `Failed` with refusal, no stripped draft, no retry; leakage = 0 via scope-only reads (NFR-EVAL-04); artifact reads of deleted/revoked snapshots return an unavailable placeholder. |
| `CC-05` | **IV. Contracts & Pipelines** | PASS | PASS | C-03 defined once in `packages/contracts/src/package-v2-4.ts`; deterministic pipelines; plugin added without modifying existing plugins (open-closed registry). |
| `CC-06` | **V. Release & Package Order** | PASS | PASS | v2.0 package; excludes FR-ST-12, mindmaps, tables, flashcards, quizzes, slides, audio/video, PDF/DOCX export, template uploads; no deferred item (`D5`, `D8`, `D10`) touched. Gate v1.0 is a prerequisite for *running* v2 implementation in a release; this tree already contains the v1 baseline. |
| `CC-07` | **VI. Security, RBAC & Residency** | PASS | PASS | Owner-only server-side checks in API and runner (NFR-SEC-02); enterprise no-training Gemini only (NFR-SEC-01); `europe-west4`; no quota slot logic here beyond the FR-NM-03 conversion port that reserves slots atomically. |
| `CC-08` | **Platform & Cost** | PASS | PASS | pnpm TS monorepo, Cloud Run worker + Cloud Tasks dispatch port, one Postgres table; no new framework, datastore or idle-cost resource. |

## Project Structure

### Documentation (this feature)

```text
specs/008-studio-text-reports/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/interfaces.md  # Phase 1 (C-03 + HTTP/port contracts)
├── checklists/          # requirements.md, studio-reports-gates.md
├── tasks.md             # /speckit-tasks
└── analysis.md          # /speckit-analyze
```

### Source Code (exact file boundaries owned by this feature)

```text
packages/contracts/src/package-v2-4.ts     # C-03 + report DTOs (single new file)
packages/contracts/src/index.ts            # ONE added export line (serialized shared file)
packages/contracts/test/package-v2-4.test.ts
packages/db/migrations/0004_studio_artifacts.sql
packages/db/src/studio-artifacts.ts        # repository interface + in-memory implementation
packages/db/src/index.ts                   # ONE added export line
packages/db/test/studio-artifacts.test.ts, studio-artifacts-schema.test.ts
apps/worker/src/studio/runner.ts           # job runner (lifecycle, snapshot, validation)
apps/worker/src/studio/reports/{templates,batching,model,deterministic-model,pipeline,render,validation,plugin,suggestions}.ts
apps/worker/test/studio-*.test.ts, studio-fixtures.ts
apps/api/src/routes/studio.ts, apps/api/src/studio/service.ts
apps/api/test/studio-*.test.ts
apps/web/src/studio/{api,reports-modal,artifact-list,markdown}.ts
apps/web/test/studio-*.test.ts
```

**Structure & File Ownership Decision**: This feature owns only the paths above. Shared files touched with a single added line each: `packages/contracts/src/index.ts`, `packages/db/src/index.ts`. `apps/api/src/server.ts` is intentionally **not** edited (composition-root wiring of Studio dependencies is deferred to the integration owner; route handler takes injected dependencies as `routes/chat.ts` does). Managed `.specify/templates/*.md` and speckit skills are untouched.

## Complexity Tracking

No constitution exception and no new `Dn`/`DEV-xx`. Recorded design choices (see [research.md](research.md)): R1 plugin shape, R2 map-reduce batching, R3 citation/quote/date validation, R4 retry semantics, R5 suggestion states and cache key, R6 injectable model client.
