# Specification Analysis Report: Studio Text Synthesis & Reports

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Tasks**: [tasks.md](tasks.md) | **Checklist**: [studio-reports-gates.md](checklists/studio-reports-gates.md)
**Package Source**: [package_2_4_studio_text_synthesis_reports.md](../../spec/requirements/v2/package_2_4_studio_text_synthesis_reports.md) + [README.md](../../spec/requirements/README.md)
**SRS IDs in Scope**: `FR-ST-10`, `FR-ST-11`, `C-02`, `C-03`, `NFR-EVAL-02`, `NFR-EVAL-04`, `NFR-SEC-02`, `Gate v2.0 #3`
**Analyzed At**: 2026-10-19 (after `/speckit-tasks`; findings fixed in the same pass, re-run clean)

## Findings Table

| ID | Category | Severity | Location(s) | Summary | Resolution |
| :- | :- | :- | :- | :- | :- |
| A1 | Underspecification | MEDIUM | [contracts/interfaces.md](contracts/interfaces.md) suggestions route | Authorization of the suggestions endpoint (owner + scope before reading guides) was not stated. | Fixed: route row now requires `StudioAccessVerifier` and `403 InvalidScope`. |
| A2 | Coverage | MEDIUM | [tasks.md](tasks.md) T015 | FR-006 "non-blocking" had no explicit assertion. | Fixed: T015 asserts the dispatcher is invoked without awaiting generation. |
| A3 | Consistency | LOW | [data-model.md](data-model.md) vs [plan.md](plan.md) | `failure` is non-null for `Cancelled` while spec says cancellation is not a failure. | Accepted and documented: code `Cancelled` carries the user-visible reason; status stays `Cancelled`. |
| A4 | Coverage | LOW | [tasks.md](tasks.md) | Playwright and LLM-judged suites have no task. | Accepted: reported `UNAVAILABLE` in T035 and plan §Technical Context (no harness/live model, Constitution II). |

After fixes: **0 open findings**.

## Constitution Alignment (`CC-01`..`CC-08`)

| Gate ID | Principle | Status | Verification Summary |
| :- | :- | :- | :- |
| `CC-01` | I. Traceability | PASS | All tasks T001–T035 cite SRS IDs; plan refinements flowed into spec and FR card. |
| `CC-02` | II. Test-First | PASS | Red tasks (T003, T005, T007, T009, T011–T016, T025–T028) precede their implementation tasks; limits 1/5,000/5,001, 3–4, 3.0 s, 25.0 s covered. |
| `CC-03` | III. Scope & Snapshot | PASS | C-02-only reads, snapshot, re-checks in T009/T010/T014. |
| `CC-04` | III. Citations & Leakage | PASS | T013, T014, T033 (precision 1.0, leakage 0); refusal on failure, no stripping. |
| `CC-05` | IV. Contracts & Pipelines | PASS | Single C-03 definition (T003/T004); deterministic pipeline T021; no `LlmAgent`. |
| `CC-06` | V. Release & Package Order | PASS | Package 2.4 only; deferred items excluded. |
| `CC-07` | VI. Security, RBAC & Residency | PASS | Owner-only (T015, T023), enterprise endpoints behind model port, `europe-west4`. |
| `CC-08` | Platform & Cost | PASS | No new framework or datastore; one Postgres table. |

## Requirement Coverage Summary

| Requirement | Red tasks | Implementation tasks |
| :- | :- | :- |
| FR-001/FR-002..005 templates (FR-ST-10) | T012, T014 | T017, T021, T022 |
| FR-006/007 async job and lifecycle (C-03) | T003, T005, T009, T015 | T004, T006, T010, T023 |
| FR-008 viewer/copy/convert/delete | T015, T016 | T023, T024 |
| FR-009/018 suggestions and guide states | T025, T028 | T029, T032 |
| FR-010/011 custom prompt, edit, generate | T003, T026, T027, T028 | T004, T030, T031, T032 |
| FR-012 explicit scope | T003, T015 | T004, T023 |
| FR-013 snapshot, recheck, retry | T009, T014 | T010 |
| FR-014 citation validation | T013 | T020 |
| FR-015 insufficient evidence | T012 | T021 |
| FR-016 Owner-only | T015 | T023 |
| FR-017 / SC-001 gate timing | T033 | T021 |

## Metrics

Requirements: 18 FR, 6 SC; tasks: 35; coverage 100 %; ambiguity 0; duplication 0; critical issues 0.


## Pre-V4 admission analysis — 2026-11-07 (CC-01..CC-08)

Focused consistency review of on-demand Guide admission (FR-SI-02/FR-ST-11,
NFR-SEC-02) and retained report acceptance (FR-ST-10, NFR-EVAL-01..04):

| Obligation | Coverage | Disposition |
| --- | --- | --- |
| Atomic2concurrent/20rolling-hour defaults, configurable positive integers | T072–T074; DB/API/config tests | Implemented, locally verified |
| Dedup before charging; failed starts remain counted; terminal/restart recovery | T072–T074 | Implemented, locally verified |
| Ordinary primary Guide exclusion/polling race | T072–T074; mountedAPI test | Implemented, locally verified |
| Authorization/revision/standard report availability | T072–T074; scoped DB/API regressions | Implemented, locally verified |
| Live four-template validity/timing and common judged acceptance | T076 | Open, UNAVAILABLE on final candidate |

CC-01: policy synchronized in spec/plan/card/SRS/architecture; oldT061deferral is
historical. CC-02: API Red observed5calls instead of2; primary polling Red
observed1charged start instead of0 before fixes. CC-03: C-02 generation snapshot
path unchanged, admission rechecks owner/Ready revision. CC-04: no citation retry or
leakage relaxation. CC-05: existing contracts/pipelines retained; additive safe
error code only. CC-06: v2retained work, V4unchanged, no gate pass inferred.
CC-07: metadata-only ledger, Owner checks, no cloud writes. CC-08: existing
PostgreSQL/TypeScript stack, additive migration0012, no new service.

No new critical/high design inconsistency identified. Report504root cause remains
insufficiently localized; unchanged historical failure and openT076are explicit.
Both reviewer checklists remain unchanged (16/16and22/22checked). Hooks before/after
analyze/implement are optional Git commit; dispatched scripts respect disabled
auto-commit configuration, final reviewed checkpoint is manual.


## Resumed CC-09 analysis before fixture remediation —2026-11-09

Reviewed base 3d02a51plus refreshed008spec/plan/tasks; scoped to FR-SI-02,
FR-ST-10/11,C-02/C-03,NFR-SEC-02 and current ConstitutionIV/CC-09.

| ID | Category | Severity/status before fix | Location | Finding and disposition |
| --- | --- | --- | --- | --- |
| CC09-008-1 | Forbidden dependency | CRITICAL, open pendingT079 | apps/api/test/guide-admission.integration.test.ts:3 | One concrete worker-model import yields no-cross-app and public-entrypoint findings. No exception exists. Remove it via a local valid suggestion double; no new helper/type/export bypass. |
| CC09-008-2 | Missing boundary evidence | CRITICAL at resumed base; resolved in design T078 | spec/plan/tasks | Previously four 008 artifact findings; populated real inventory and qualifiedtasks. Scoped validateArtifacts now returns zero. |
| CC09-008-3 | Live acceptance | Existing openT076, unchanged | validation/quickstart | Report504cause remains unproven and final four-template/judged evidence unavailable; neither static remediation nor local tests claim acceptance. |

Six scoped obligations have coverage in T077–T080: explicit public fixture imports;
unchanged exceptions/exports; admission and primary identity; scope/publication;
transaction/dispatch/recovery placement; truthful release evidence. Coverage6/6;
four new tasks; no new design ambiguity, duplication or unmapped task. The two
non-grandfathered graph diagnostics are the actual governance Red, and T079 is
the only permitted implementation change to resolve them. No product behavior
failure is asserted: pre-edit six-file characterization passes51tests onVitest 5.1.0.

CC-01 PASS: existing IDs and card/README aligned; scope is fixture/boundary evidence.
CC-02 PASS: characterize before fixture change; do not force false product Red.
CC-03 PASS (manual): current C-02snapshot/read/recheck path unchanged.
CC-04 PASS (manual): citation/refusal/leakage logic unchanged, affected regressions retained.
CC-05 PASS (manual): canonical contracts and existing deterministic pipelines unchanged.
CC-06 PASS (manual): onepackage, no V4 or releasepass.
CC-07 PASS (manual): owner/Readychecks and atomic ledger kept, no cloud/credentials added.
CC-08 PASS (manual): same stack/dependencies/placement.
CC-09 FAIL (graph before fix); designinventory/scope PASS (manual): fixture repair must
make graphzero without policy change; scoped 008artifact checkPASS. Final evidence
will distinguish the remaining009artifact failures from008and global graph results.

Analyzer output is read-only; this dated record is retained separately as authorized
workflow evidence. No exception self-approval or checker weakening was performed.


### Final CC-09 disposition — 2026-11-09

T079 removes the sole new edge without changing policy, exports or production code.
CC09-008-1 is resolved: graph check against origin/main reports zero findings and
186 exact legacy exceptions. CC09-008-2 remains resolved: scoped 008 artifacts pass.
Global artifact validation has four findings, all in 009; they are not a PASS and
remain assigned to the next package. No new manual ownership or requirement gap
was found in the final diff. CC-09 PASS is limited to this resumed fixture/artifact
slice and the documented exact legacy records; it is not a completed R1/R2 migration.
The same six files/51 tests pass before and after the change on current Vitest 5.1.0.
No test was weakened or forced to fail. Live T076 remains open; report timeouts,
model/pipeline logic, scope, quotas, dispatch and publication are unchanged.
