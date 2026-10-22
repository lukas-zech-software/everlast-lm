# Specification Analysis Report: Package 3.3

Date: 2026-10-22. Scope: FR-ST-08/09/18, FR-ST-10/11, FR-SI-02/03/05, FR-GC-01/02/06, FR-WM-04/05, C-01/C-02/C-03, NFR-SEC-01/02, NFR-EVAL-01..04, Gate v3.0 #3.

## Execution and authority

Created `/private/tmp/everlast-v3-tasks-3-3-20261022` on `codex/v3-tasks-3-3-20261022` from completed predecessor `fb88719414149301ea9fd54558203503c516717e` as the first action. Second action exported supplied `SPECIFY_FEATURE_DIRECTORY=specs/011-studio-mindmaps-data-tables`, wrote that exact value to `.specify/feature.json`, then unset/asserted absent. Read current hierarchy and all own design artifacts plus predecessor reservations. setup-tasks selected the override template. Parsed hooks with Ruby Psych: before/after tasks/analyze contain optional Git commit only; announced/skipped automatic hooks in favor of a reviewed explicit commit. No mandatory hook omitted.

Generated complete tasks, ran `check-prerequisites.sh --json --require-spec --require-tasks --include-tasks`, then analyzed read-only. Emitted initial findings before changing files. User authorization to resolve findings covered a separate remediation phase; applied narrow own-card/spec/plan/model/interfaces/quickstart fixes, then repeated read-only analysis. This file is saved afterwards as a reporting action, outside the read-only analysis. No application code, implementation tests, database operation or deployment was performed.

## Initial findings and remediation

| ID | Category/severity | Original locations | Finding | Resolution |
| --- | --- | --- | --- | --- |
| C1 | Constitution/CRITICAL | tasks T014, T051 | First explicit deterministic eval assertions were assigned to a final task, despite prose requiring early Red. | RESOLVED: T014 owns all early generation/drilldown/history/cache/export grounding/leakage assertions; T051 only reruns them. Implementation descendants depend on T014. |
| U1 | Underspecification/MEDIUM | plan Project Structure; tasks T009, T018, T020, T022, T035, T056 | Exact migration/helper/test/benchmark paths and owning-package handoff were insufficiently concrete. | RESOLVED: reserve 0011, name planned modules/test owners in plan, retain handoff in own quickstart. 3.4 consumes 3.3 helper rather than circular prerequisite. |
| A1 | Ambiguity/MEDIUM | spec SC-002; quickstart scenario 1; tasks T016, T024, T029 | P95 sample/failure denominator and frame population allowed discretionary exclusions. | RESOLVED: predeclare N≥20 accepted submissions, fixture/environment/cold-warm mix; all accepted runs included, failed/unfinished=positive infinity, nearest-rank ceil(.95*N). Frame population/actions/hardware fixed before capture. Spec/card/plan/quickstart agree; thresholds unchanged. |
| I1 | Inconsistency/MEDIUM | tasks T052 | Proposed scripts/eval-judged.mjs does not exist; current package command invokes a different CLI. | RESOLVED: use pnpm eval:judged→packages/evals/src/cli.ts release and actual fixed 50 case release mode. |
| I2 | Inconsistency/MEDIUM | contracts Studio admission; apps/api/src/routes/studio.ts | Generic invalid parameters 422 omitted current unsupported output-language 400 exception. | RESOLVED: contract/spec/card/task/quickstart preserve UnsupportedOutputLanguage 400; other invalid parameters 422. No report response regression. |

## Final findings

| ID | Category | Severity | Location | Summary | Recommendation |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | No remaining actionable inconsistency, uncovered requirement, task-order defect or ambiguity found. | Proceed to reviewer checklist and gated test-first implementation. |

## Coverage summary — CC-01/02

Task references below are local to `specs/011-studio-mindmaps-data-tables`; qualify them externally. Verification includes runtime evidence tasks, not a claim those tasks ran.

| Requirement key | Has task? | Red tests | Implementation/verification | Coverage |
| --- | --- | --- | --- | --- |
| FR-001 | Yes | T007, T013, T015, T016 | T012, T019–T024 | Entry/lifecycle/persistence/canvas |
| FR-002 | Yes | T004, T013, T015, T025 | T008, T017, T019, T021, T030 | Root/tree/limits/initial depth 2 |
| FR-003 | Yes | T006, T013, T014 | T018, T019, T023, T051 | ≥50 sources/all originals/field citations |
| FR-004 | Yes | T025, T027–T029 | T030, T031, T033–T037 | Native controls/full bounds/2× exports |
| FR-005 | Yes | T025, T026, T028 | T032, T034, T036 | Contextual node chat/persisted answer |
| FR-006 | Yes | T014, T026, T028 | T032, T034, T036, T051 | Missing-support selection/no injected text |
| FR-007 | Yes | T004, T007, T039, T041 | T008, T012, T042, T043, T046–T049 | Optional prompt/schema/table viewer |
| FR-008 | Yes | T004, T038, T040, T041 | T042, T044, T046, T047, T049 | Rectangular bounds/evidence/missing |
| FR-009 | Yes | T040, T041 | T044–T047, T049 | Safe valid CSV/XLSX |
| FR-010 | Yes | T005–T007, T014, T026, T027, T038–T040 | T009–T012, T018, T031, T032, T042, T045, T050 | Exact source snapshot/access/fencing |
| FR-011 | Yes | T006, T007, T014, T026–T028, T038, T040 | T011, T012, T017, T031–T034, T042, T045, T050, T051 | Factual refs/cache/history/export hygiene |
| FR-012 | Yes | T005–T007, T039 | T009–T012, T020, T043, T048, T050 | Shared lifecycle/new attempt/reports |
| FR-013 | Yes | T004, T013, T014, T025, T038, T039 | T008, T017–T019, T030, T042, T043, T047, T049 | Code points/evidence counts/no padding |
| FR-014 | Yes | T005, T007, T013, T015, T026–T028, T040, T041 | T009, T012, T019–T021, T031–T034, T045, T046, T051 | Owner/ACL/EU/label/redaction |
| FR-015 | Yes | T004, T038, T039, T041 | T008, T042, T043, T046, T047, T049 | 501/26 failure/500/25 allowed/no partial |
| FR-016 | Yes | T004, T038, T040, T041 | T008, T042, T044–T047, T049 | One item one row/per value conflicts |
| FR-017 | Yes | T004–T007, T015 | T008–T012, T020, T043, T048, T050 | Reuse 0008/durable delivery/restart |
| SC-001 | Yes | T004, T013, T015 | T017, T019–T023, T053 | 100% published valid graph |
| SC-002 | Yes | T016 | T019, T022, T024, T053 | Accepted cohort submission→Completed≤20s P95 |
| SC-003 | Yes | T025, T029 | T030, T035, T037, T053 | ≤120 nodes/60fps/≤16ms |
| SC-004 | Yes | T025, T027, T028 | T030, T031, T033, T036, T053 | 25 labels/full bounds/valid PNG+SVG |
| SC-005 | Yes | T040, T041 | T044–T047, T049, T053 | Valid inert CSV/XLSX/independent parse |
| SC-006 | Yes | T038–T041 | T042, T044, T046, T047, T053 | Three vendors/cited cells/missing marker |
| SC-007 | Yes | T014, T026, T028 | T018, T032, T034, T036, T051, T052 | Grounding/leakage/judged release sample |
| SC-008 | Yes | T004–T007, T013–T016, T026–T028, T038–T041 | T009–T012, T017–T024, T031–T034, T042–T047, T050, T051 | Limits/revocation/citation refusal |
| SC-009 | Yes | T004, T038, T039, T041 | T042, T043, T046, T047, T049, T053 | Inclusive edges/overflow failure |
| SC-010 | Yes | T004, T038, T040, T041 | T042, T044–T047, T049, T053 | All conflicting alternatives individually cited |
| SC-011 | Yes | T004–T007, T015 | T009–T012, T020, T043, T048, T050, T053 | Restart/claims/report compatibility |

## Constitution alignment

| Gate | Result | Evidence and boundary |
| --- | --- | --- |
| CC-01 | PASS | All 17 FR + 11 SC mapped; every task SRS/path/explicit constraints; measurement/status refinements flowed to own FR card/spec. |
| CC-02 | PASS | Shared Red tests before schema/DB/runner; story Red tests before implementation; T014 early evals, T051 rerun; explicit Tests/Implementation headings and backward-only dependencies. |
| CC-03 | PASS | Captured Owner/exact revisions/C-02 all originals; no default scope or guide-only substitute; atomic source/publication fence. |
| CC-04 | PASS | Factual field/per alternative IDs before publication; invalid citation fails without model retry; history/cache/export/current-scope drilldown isolation. |
| CC-05 | PASS | Additive C-03 typed variants, registered report validator preserved, independent map/table plugins; unchanged C-01/C-02; no new agent framework. |
| CC-06 | PASS at task scope | Gate v2 owner override/absent postfix live evidence retained; 3.1 before consumers, 3.4 integrated measurement; T001 checks implementation prerequisites. |
| CC-07 | PASS at task scope | Owner/notebook/document ACLs, app-pool binding, EU enterprise/keyless processing, immediate invalidation and safe export requirements retained; no cloud approval inferred. |
| CC-08 | PASS | Current TypeScript/pnpm/Node 26/single PG/Cloud Run/OpenTofu; additive 0011, no new datastore/UI framework/fixed idle component. |

Constitution alignment issues: none remaining in artifacts. Unmapped tasks: none; setup/evidence/flow-back tasks map to SRS/gate obligations. Harmful duplication: none; schema, API, worker, browser and independent export-parser tests cover distinct boundaries.

## Metrics and handoff

- Requirements 28 (17 FR, 11 SC); tasks 56 (T001–T056); coverage 28/28 = 100%; remaining ambiguity 0; harmful duplication 0; critical 0; remaining actionable findings 0. Initial 5 findings resolved.
- Counts: Setup 3; Foundation 9; US1 generation 12; US2 explore/export 13; US3 tables 12; crosscutting 7. Seventeen [P] tasks are disjoint test owners, not blanket permission for concurrent shared implementation.
- Migration reserved: packages/db/migrations/0011_studio_structure.sql. Applied 0008 and preceding planned 0009/0010 preserved. Next package allocates 0012+ only if needed; recheck applied/reserved sequence at execution.
- Package 3.4 consumes T018's `apps/worker/src/studio/evidence.ts` original-evidence batching/coverage port, extended from existing C-02 and report batching. It may extend model-envelope/streaming/cache/benchmark behavior without making 3.3 depend on future 3.4 implementation. Common delivery modules are `apps/worker/src/studio/handler.ts` and `registry.ts` (T010/T020). 3.3 owns typed plugin/outbox/lease/publication; 3.1 owns re-sync/Guide lifecycle. T056 records handoff in the owning package's quickstart.
- MVP: foundation+US1; US2 and US3 remain required for full package. D19 accepts managed sandbox/R6 obsolete; no sandbox spike/task introduced.
- PASS: exact pin/env bootstrap, prerequisites, 56 sequential unchecked IDs, required story labels/SRS/exact paths, backward dependencies, 28 explicit requirement keys, checklist preservation, spec integrity, diff check. Custom 38 unchecked and built-in 16/16 remain byte-for-byte unchanged. No reviewer approval is fabricated.
- No implementation/runtime tests executed. New plugin/browser/export/lease/performance/eval scenarios are UNAVAILABLE until implemented/configured; existing runners are present. Spec integrity is not a runtime gate pass.
- Next: reviewer requirements checklist, then gated speckit-implement in package order with Red→Green→Refactor, normal provisioning approvals and release gates.
