# Specification Analysis Report: Workspace & UI Comfort

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Tasks**: [tasks.md](tasks.md) | **Checklist**: [ux.md](checklists/ux.md)
**Package Source**: [Package 2.1 FR card](../../spec/requirements/v2/package_2_1_workspace_ui_comfort.md) + [binding cross-package rules](../../spec/requirements/README.md)
**SRS IDs in scope**: `FR-WM-02`, `FR-WM-03`, `FR-UI-02`, `FR-GC-03`
**Analyzed**: 2026-10-19, after plan/checklist/tasks reconciliation

## Findings Table

| ID | Category | Severity | Location(s) | Summary | Recommendation |
| :- | :- | :- | :- | :- | :- |
| — | All categories (`A`–`F`) | NONE | [spec.md](spec.md), [plan.md](plan.md), [tasks.md](tasks.md), [ux.md](checklists/ux.md) | No remaining duplication, unresolved ambiguity, constitution conflict, requirement coverage gap, or task ordering inconsistency after the upstream and downstream refinements listed below. | Proceed to implementation after this design-level analysis. |

## Requirement Coverage Summary

| Requirement Key | Has Task? | Task IDs | Notes |
| :- | :- | :- | :- |
| `FR-001` | Yes | T006, T008 | Notebook identification and Ready-source count. |
| `FR-002` | Yes | T009, T016 | Flash-Lite first-Ready topic icon, sticky custom state, non-fatal failure. |
| `FR-003` | Yes | T003, T006, T011, T014 | Emoji grapheme validity and HTTP 400 without mutation. |
| `FR-004` | Yes | T004, T009, T012, T016 | Source lifecycle/count/timestamp and shared note/artifact mutation hook. |
| `FR-005` | Yes | T007, T008, T012, T014, T015 | Grid/list, all sorts, most-recent fallback and view defaults. |
| `FR-006` | Yes | T006, T008, T015 | Owner role and both creation/modified dates in List view. |
| `FR-007` | Yes | T004, T007, T012, T014, T015 | Per-owner pin state and pinned-first sorting. |
| `FR-008` | Yes | T008, T015 | Immediate and persisted view/sort choice. |
| `FR-009` | Yes | T008, T015 | Empty-state call-to-action and hidden/disabled sorting. |
| `FR-010` | Yes | T019, T020, T025, T026 | System/light/dark, no reload, first-paint theme and persistence. |
| `FR-011` | Yes | T018–T020, T023–T027 | Input `auto`, BCP-47 settings and chat consumer boundary. |
| `FR-012` | Yes | T018–T020, T023–T024 | Versioned 40-language set and supported-locale fallback. |
| `FR-013` | Yes | T018–T019, T023–T027 | Exact language precedence; current chat adapter plus shared future-consumer resolver. |
| `FR-014` | Yes | T021, T027 | Original-language citation quotations remain unchanged. |
| `FR-015` | Yes | T006, T014, T019, T025 | Owner-only v2.0 API and preference behavior. |
| `SC-001` | Yes | T008, T029 | Metadata timing measured from list response to visible content. |
| `SC-002` | Yes | T008, T029 | 500 synthetic records, ≤100 ms in Chromium. |
| `SC-003` | Yes | T020, T026, T029 | ≤50 ms across panels and no initial flash. |
| `SC-004` | Yes | T018, T020, T029 | Exact 40 supported output-language choices. |
| `SC-005` | Yes | T029, T031 | Scripted acceptance outcomes and final verification. |

**Coverage**: 20/20 buildable FR/SC requirements mapped to test and/or implementation tasks (100%). All task IDs are referenced in handoffs as `[005-workspace-ui-comfort] Tnnn`; each task includes a feature file path and SRS citation.

## Constitution Alignment (`CC-01`..`CC-08`)

| Gate | Status | Evidence |
| :- | :- | :- |
| `CC-01` Traceability | PASS | Requirements and tasks cite the applicable SRS IDs; list-date, supported-language, theme, and topic-icon refinements were flowed into `spec.md` and the Package 2.1 FR card. |
| `CC-02` Test-First | PASS | Foundational and story-specific contract/repository/API/web/worker tests precede the behavior tasks they cover; Red must be assertion-related. |
| `CC-03` Scope & Snapshot | PASS | No source-selection, retrieval, or generation read path is introduced. Topic selection uses only source title and media type; it cannot alter active source selection. |
| `CC-04` Citations & Leakage | PASS | Existing citations are not transformed; original-language source quotations are explicitly preserved. |
| `CC-05` Contracts & Pipelines | PASS | New typed schemas are additive in `package-v2-1.ts`; topic selection is a bounded enrichment call, not an agent loop; shared C-01/C-02/C-03 are unchanged. |
| `CC-06` Release & Package Order | PASS | Scope is Package 2.1 only; preferences precede downstream language-sensitive generators. No Gate v2.0 completion is claimed. |
| `CC-07` Security, RBAC & Residency | PASS | API remains owner-only; topic emoji uses the enterprise Vertex AI endpoint, keyless auth, and `europe-west4`; no consumer key or region exception. |
| `CC-08` Platform & Cost | PASS | Existing pnpm/TypeScript/Zod/Vitest/native HTTP/Cloud SQL design is retained; no new framework or cloud product is added. |

## Task Validation

- **Total tasks**: 31 (`T001`–`T031`), all with checklist syntax, sequential IDs, SRS citations, and repository file paths.
- **Setup**: 2 tasks; **Foundational**: 3 tasks.
- **User Story 1**: 12 tasks (T006–T017), independent test covers metadata, view/sort/pin, empty state, and icon behavior.
- **User Story 2**: 11 tasks (T018–T028), independent test covers theme, language preferences/precedence, chat propagation, and citation fidelity.
- **Polish**: 3 tasks (T029–T031).
- **Parallel work** is limited to tests in disjoint files; shared exports, service modules and the same test file are serialized. No task is unmapped.

## Reconciliation of Initial Analysis Risks

The initial pass found that the draft plan omitted the architecture-required Flash-Lite topic selector; List-view date choice, supported locale choices, System theme behavior, and performance measurement environment were insufficiently explicit; the chat adapter was not in the file/task boundary; and same-file tests were incorrectly marked parallel. These points were resolved by flowing the topic-selection behavior into the FR card/spec/plan, specifying both List-view dates and the versioned 40-language set at scenario and success-criteria level, defining System as `prefers-color-scheme` with first-paint application, naming the Chromium measurement fixture, adding chat propagation tests/tasks, and correcting parallel markers. A final source audit aligned scenario-level language/date wording, the design gate notes, and model-routing citations with Solution Architecture §2.1 and the stable D3 residency decision; D2 is the TypeScript backend-language decision, not the model-routing source.

## Explicit Integration Limits

- The existing preference repository follows the current in-memory DB adapter pattern. It persists across browser reloads while the API process remains running, but is not durable across process restart; this package does not claim that this local adapter is Cloud SQL durability.
- Live Flash-Lite endpoint acceptance requires enterprise Vertex AI credentials and is `UNAVAILABLE` if they are not configured. Deterministic adapter tests remain mandatory.
- Notes and Studio artifacts are implemented by later v2 packages. This package exposes `touchNotebookModified()` for those writers; each downstream writer must call it when implemented.

## Next Actions

- Recommendation: **proceed** to implementation; no blocking analyze findings remain.
- Run `/speckit-implement` with tests first, follow the qualified task IDs, and flow any new implementation discovery back into the feature spec and governing FR card before rerunning analyze.
- This analysis is a design consistency result only; it does not claim tests, live model acceptance, or Gate v2.0 have passed.

## Convergence re-analysis after card flow-back (2026-10-20, T040–T042)

Scope: `FR-WM-02`, `FR-WM-03`, `FR-UI-02` against the revised Package 2.1 card (PR #127).

| Finding | Card change | Flowed into | Status |
| :- | :- | :- | :- |
| SC-002 size (`FR-WM-03`, contradicts) | Measured at 100 notebooks (v1–v5 limit, SRS §5.6) | `spec.md` SC-002, `plan.md` Performance Goals, `quickstart.md` | Consistent |
| View/sort persistence (`FR-WM-03`, contradicts) | `localStorage` only, per browser | `spec.md` FR-008, US1 #4/#9, Edge Cases, Key Entities; `plan.md`; `data-model.md`; `contracts/interfaces.md`; Solution Architecture §4.1 Relational DB row | Consistent; code follows in T049/T050 |
| Title sort (`FR-WM-03`, partial) | `Intl.Collator`, ties by `created_at` desc | `spec.md` FR-005, Edge Cases; `plan.md`; `data-model.md` | Consistent; code follows in T053/T054 |
| Role column (`FR-WM-03`, partial) | v6.0 item; v2 shows Owner | `spec.md` FR-006, US1 #8, FR-015 | Consistent |
| D16 meaning (`FR-WM-02/03`) | "Persisted" = kept by running API | `spec.md` Source Traceability; `plan.md` | Consistent |
| Theme storage (`FR-UI-02`, contradicts) | `localStorage` + server; server value replaces local | `spec.md` FR-010, Edge Cases, Key Entities; `plan.md` Execution Model; `data-model.md` | Consistent; code follows in T051/T052 |
| Input language (`FR-UI-02`) | Tag passed as question language; typed input only in v2 | `spec.md` FR-011, US2 #4, Edge Cases; `plan.md` | Consistent |
| Personal overrides (`FR-UI-02`, contradicts) | Owner sets notebook language in v1–v5; overrides from v6.0 | `spec.md` FR-013, FR-015, US2 #6, Edge Cases, Key Entities; `data-model.md`; `contracts/interfaces.md` | Consistent; code follows in T055/T056 |
| Output default (`FR-UI-02`, partial) | User default → supported browser locale → `en-US` | `spec.md` FR-012, US2 #6; `plan.md` | Consistent; code follows in T057/T058 |
| Source Guide per language (`FR-UI-02`) | Stored per (source, revision, language) | `spec.md` FR-013 references `specs/006` as owner | Consistent |

No CRITICAL or HIGH inconsistency remains between card, `spec.md` and `plan.md`. No upstream card change was needed.

### Post-implementation re-analysis (T059)

Code, tests and artifacts agree: every convergence task T040–T059 is `[X]`; each implementation task (T044, T046, T048, T050, T052, T054, T056, T058) follows a test task whose Red was recorded in [validation.md](validation.md); SRS IDs are cited in tests and tasks (`CC-01`, `CC-02`). No remaining contradiction with the revised card was found. Open limits are unchanged: D16 in-memory v2 stores, live Flash-Lite and judged evals `UNAVAILABLE`.
