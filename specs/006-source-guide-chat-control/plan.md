# Implementation Plan: Proactive Context Intelligence & Chat Control

**Branch**: `006-source-guide-chat-control` | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)
**Package Source**: `spec/requirements/v2/package_2_2_proactive_context_intelligence_chat_control.md` + [binding rules](../../spec/requirements/README.md)
**SRS IDs in Scope**: `FR-SI-02`, `FR-GC-04`, `FR-GC-05`, `FR-GC-07`, `FR-GC-09`, `FR-NM-02`, `C-02`, `NFR-EVAL-02`, `NFR-EVAL-04`, `Gate v2.0 #1/#2`
**Input**: `specs/006-source-guide-chat-control/spec.md`

## Summary

Implement Package 2.2 on the existing v1 TypeScript monorepo without changing shared C-01/C-02 contracts. Source Guide and overview/follow-up generation are deterministic TypeScript pipelines around an injected structured-model client; no ADK `LlmAgent` loop is introduced (`FR-SI-02`, `FR-GC-04`, `FR-GC-05`, D1/D2). Source reads use only the canonical `ScopedContextProvider` at the C-02 boundary and immutable `(source_id, revision)` snapshots; authorization and revision state are rechecked after reads and before publication. Runtime composition accepts injected provider, scope validator, Ready-source metadata reader, and structured model; it fails closed when production generation is unconfigured. Add package-local Zod DTOs (including explicit `source_word_count` and a hashed SHA-256 authorization partition key), an in-memory repository matching existing test adapters, authenticated API route dispatch, and browser-side controllers/renderers. The Save-to-note request and response are a stable shared contract for `FR-GC-09` and `FR-NM-02`; its shape is flowed back to the feature spec and both package cards before implementation.

## Technical Context

- **Language/runtime**: TypeScript 5.x strict ESM, Node.js 24, pnpm workspace.
- **Dependencies**: Existing Zod, native Node HTTP, and Vitest only. Inject `StructuredGenerationClient`; tests use a deterministic fake. No new framework, model SDK, datastore, cloud service, or dependency.
- **Storage**: Existing Cloud SQL/PostgreSQL remains the production storage decision (`D1`, `D4`). This package adds a Map-backed repository adapter following current in-memory test stores; it is not a claim of durable production persistence. Model production wiring and durable SQL adapter remain governed by existing infrastructure/approved endpoint setup.
- **Authorization/residency**: API auth continues through existing owner identity middleware; v2 is Owner-only. Model endpoints must be enterprise no-training and default to `europe-west4` (`NFR-SEC-01`, `D3`). No cloud APIs or infrastructure are enabled/changed.
- **Execution**: Source Guide, notebook overview and follow-up suggestions are deterministic pipelines (structured model step only); chat remains the existing grounded engine. Chat settings cannot override grounding/citation controls (`FR-GC-01/02`, D13).
- **Performance targets**: Source Guide P95 <10 s after `Ready`; overview <=6 s after first `Ready`; follow-ups <=1 s after stream completion; copy/feedback <=200 ms; save-to-note item <=300 ms (`FR-SI-02`, `FR-GC-04/05/09`). Deterministic unit tests verify behavior; local tests do not prove cloud P95.
- **Limits**: `<50` words → one-sentence guide and 1–3 topics; otherwise target 100–250 summary words and 5–10 topics (≤40 code points); overview 3–5 prompts (≤120 code points); follow-ups 0–3 (≤100 code points); custom prompt 1–5,000 Unicode code points after trim; feedback comment 0–1,000; save-note title 1–200. Reject over-limits, never truncate (`FR-SI-02`, `FR-GC-04/05/07/09`, FR-NM-02).
- **Within-release prerequisites**: Package 2.1 language preferences precede language-aware generation. Package 2.2 shares a Save-to-note contract with Package 2.3 (`FR-GC-09`/`FR-NM-02`). Consume existing C-01/C-02; do not redefine them. Package 2.4 owns C-03 and is out of scope. Gate v1 must pass before v2 implementation (Constitution V).

## Constitution Check (`CC-01`..`CC-08`)

Pre-research and post-design design checks are recorded below. Gate v1 deterministic evaluation initially failed because shell Gemini API-key variables tripped the keyless security preflight. Re-running `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm eval:deterministic` passed all 29 tests. Gate v1 deterministic eval prerequisite is PASS; prior Gate v1 upload/citation evidence and Package 2.1 prerequisite remain upstream release evidence.

| Gate | Principle | Pre-Research | Post-Design | Evidence |
| :--- | :--- | :--- | :--- | :--- |
| CC-01 | I. Traceability | PASS | PASS | FR/SRS IDs map through feature, package cards, plan, tests and tasks; save-note contract is identical in Package 2.2 and 2.3 cards. |
| CC-02 | II. Test-First | PASS | PASS | Contract, pipeline, repository, API and UI behavior tests are ordered before corresponding implementation tasks. |
| CC-03 | III. Scope/Snapshot | PASS | PASS | All generation reads use injected C-02, explicit Ready source IDs, exact revisions, authorization context and rechecks; empty scope rejects/clears. |
| CC-04 | III. Citations/Leakage | PASS | PASS | Supporting chunk IDs are schema-validated against scoped chunks; invalid support/citation IDs fail closed; caches key exact scope/revision/auth/language/parameters. |
| CC-05 | IV. Contracts/Pipelines | PASS | PASS | New DTOs are Zod in `package-v2-2.ts`; C-01/C-02 stay canonical; generation is deterministic orchestration, not an LlmAgent. |
| CC-06 | V. Release/Order | PASS* | PASS* | Deterministic v1 eval prerequisite passes 29/29 with keyless shell; prior Gate v1 upload/citation and Package 2.1 evidence remain upstream conditions. |
| CC-07 | VI. Security/Residency | PASS | PASS | Owner-only v2; API derives user from auth; enterprise no-training endpoints/europe-west4 required for production wiring; no secrets/cloud changes. |
| CC-08 | Platform/Cost | PASS | PASS | Existing pnpm/TS/Cloud SQL/Cloud Run architecture and zero-new-dependency local tests; no fixed-cost service. |

Gate v1 deterministic evals pass with the API-key variables unset. Implementation uses that environment; do not infer that this alone certifies all v1 release artifacts.

## Project Structure and Ownership

| Area | Owned files | Trace |
| :--- | :--- | :--- |
| Contracts | `packages/contracts/src/package-v2-2.ts`; one export in `packages/contracts/src/index.ts`; `packages/contracts/test/package-v2-2.test.ts` | `FR-SI-02`, `FR-GC-04/05/07/09`, `FR-NM-02`, `C-02` |
| Repository | `packages/db/src/package-v2-2.ts`; one export in `packages/db/src/index.ts`; `packages/db/test/package-v2-2.test.ts` | `FR-SI-02`, `FR-GC-04/05/07/09`, `FR-NM-02` |
| Pipelines | `apps/worker/src/package-v2-2.ts`, `apps/worker/src/package-v2-2-runtime.ts`; worker C-02/runtime tests | `FR-SI-02`, `FR-GC-04/05`, `C-02` |
| API | `apps/api/src/routes/package-v2-2.ts`; minimal route registration in `apps/api/src/server.ts`; `apps/api/test/package-v2-2.test.ts` | `FR-GC-04/05/07/09`, `FR-NM-02`, `FR-WM-04/05` |
| Web | `apps/web/src/source-guide.ts`, `apps/web/src/chat-control.ts`, integration in `apps/web/src/main.ts`; corresponding focused tests under `apps/web/test/` | `FR-SI-02`, `FR-GC-04/05/07/09` |
| Design docs/upstream flow-back | `specs/006-source-guide-chat-control/{plan,research,data-model,quickstart}.md`, `contracts/interfaces.md`, checklist, tasks, analysis; targeted additions to feature and Package 2.2/2.3 cards | `CC-01`, `FR-GC-09`, `FR-NM-02` |

Do not modify other package schemas or migrations; do not edit managed templates/skills. Shared `packages/contracts/src/index.ts` and `packages/db/src/index.ts` exports are single-line serialized changes in this worktree.

## Design Outputs

- [Research](research.md) resolves model, scope, retry, and shared save-note contract choices.
- [Data model](data-model.md) defines generated records, cache keys, validation and transitions.
- [Contracts](contracts/interfaces.md) defines HTTP and cross-package schemas, including stable save-note shape.
- [Quickstart](quickstart.md) lists tests and end-to-end checks; external model latency requires an approved enterprise endpoint.

## Complexity Tracking

No new frameworks, datastores, cloud services or architecture decisions. Injecting a model interface isolates external calls for deterministic testing; a test-only in-memory adapter follows existing patterns. No SRS deviation or scope change is proposed.
