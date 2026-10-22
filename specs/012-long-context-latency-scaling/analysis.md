# Specification Analysis: Package 3.4

**Date**: 2026-10-22. **Scope**: `NFR-PERF-01`, `C-01/C-02/C-03`, supporting grounding/security/eval IDs in spec.md. **Feature**: `specs/012-long-context-latency-scaling`.

Read-only analysis ran after the complete 50-task draft. The user authorized resolving findings; remediation was a separate editing step, followed by read-only reanalysis. This report was saved afterwards. Optional before/after tasks/analyze Git hooks were inspected and skipped in favor of an explicit reviewed final commit; no mandatory hook applied.

## Initial findings and remediation (`CC-01/02`, `NFR-PERF-01`)

Locations identify the initial artifact sections and stable task IDs; line positions may shift after remediation.

| ID | Category | Severity | Location | Finding and resolution |
| :--- | :--- | :--- | :--- | :--- |
| U1 | Underspecification | MEDIUM | plan.md Project Structure; tasks.md T008/T016/T027/T028/T037–T042 | Concrete new helper/test paths and predecessor ownership were not fully allocated in the plan. Added the concrete task-ownership table, explicit 3.3 evidence/handler/registry handoff, actual browser test directory and no speculative migration. |
| U2 | Underspecification | HIGH | data-model.md Context plan/cache entry; plan.md Phase1 item 5; tasks.md T023/T028 | Metadata persistence, restart and cleanup ownership were undefined. Selected process-local metadata, mandatory finite positive provider TTL/confirmed expiry, per-use C-02 checks, immediate ineligibility, best-effort idempotent deletion and no orphan reattachment. Mirrored in spec/plan/model/contracts/card and tests/tasks. |
| I1 | Inconsistency | MEDIUM | data-model.md Benchmark observation; contracts/interfaces.md Evaluation output; tasks.md T010/T015 | Positive-infinity failure aggregation had no explicit JSON representation. Null timestamps/latency and terminal status represent missing factual answers; infinity exists only in aggregation. Failed aggregate uses null p95 and FAIL; unavailable prerequisites use UNAVAILABLE. Flowed through governing card and feature artifacts. |
| I2 | Inconsistency | LOW | spec.md Out of Scope; plan.md Project Structure/CC-02/latest baseline | Stale lifecycle prose said task generation excluded/no tasks existed. Updated to the current task-generation/analysis stage and branch while preserving no implementation or runtime evidence. |

## Final findings (`NFR-PERF-01`, CC-01..CC-08)

| ID | Category | Severity | Location | Summary |
| :--- | :--- | :--- | :--- | :--- |
| — | — | — | Reviewed spec, plan, tasks, model, interfaces, research, quickstart and governing card/rules | No remaining actionable findings. |

## Coverage (`CC-01/02`, `NFR-PERF-01`)

Task IDs below are local to `[012-long-context-latency-scaling]`. Each mapped Red test precedes its covered implementation; final checks repeat evidence rather than creating first coverage.

| Requirement | Has tasks? | Red tests | Implementation / verification | Covered behavior |
| :--- | :--- | :--- | :--- | :--- |
| FR-001 | Yes | T003/T004/T013/T032/T033 | T007/T008/T018/T037/T038/T042/T047 | Million-token/300-source capacity, original accounting, bounded traversal/envelopes |
| FR-002 | Yes | T004/T013/T022/T024 | T007/T018/T026/T027/T029 | Scoped hybrid retrieval, broad/detail routing |
| FR-003 | Yes | T005/T022/T024/T025 | T026/T027/T029/T031 | All 40 Guides plus original details and follow-up |
| FR-004 | Yes | T003/T004/T023/T032–T036 | T007/T008/T028/T037–T043 | Full context/cache and all-original bounded map-reduce |
| FR-005 | Yes | T005/T010–T014 | T015–T021/T047 | 20 warm, 19th rank, ≤2,500 ms, max 40 attempts, no resets |
| FR-006 | Yes | T004/T011–T014/T023/T024/T032/T035/T036 | T007/T008/T016–T020/T026/T028/T030/T038/T041 | Exact submission scope, C-02, reauthorization and stale-output fences |
| FR-007 | Yes | T003/T004/T005/T012/T014/T023–T025/T035 | T006/T017/T026/T028–T030/T041 | Cache/history/Guide identity and zero leakage |
| FR-008 | Yes | T005/T012/T024/T025/T034/T036 | T009/T017/T029/T040/T045/T046 | Citation validity, semantic support, immediate refusal, no silent retry |
| FR-009 | Yes | T003/T023/T032–T036 | T006/T028/T037–T041 | Existing C-03 lifecycle, fresh retries, no partial completion |
| FR-010 | Yes | T005/T010/T012/T025/T036 | T009/T015/T019/T029/T040/T045–T048 | Deterministic PR gates and fixed stratified 50-case judged release evidence |
| SC-001 | Yes | T004/T005/T013/T032/T033 | T008/T009/T018/T037/T038/T042/T047 | ≥1,000,000 active tokens, ≥1,050,000 fixture excluding decoy |
| SC-002 | Yes | T005/T010–T014 | T015–T021/T047 | Every warm answer 142.8 bar/correct needle, no 155.0 bar leakage |
| SC-003 | Yes | T005/T010/T012/T024/T025/T036 | T009/T015/T029/T040/T045/T046 | Exact quality thresholds and distinct quality/timing populations |
| SC-004 | Yes | T022–T025/T032–T035 | T026–T031/T037–T043 | Complete Guides/original evidence, no summary-only substitution |
| SC-005 | Yes | T003–T005/T011–T014/T023–T025/T032/T035/T036 | T006–T009/T016/T017/T020/T026–T030/T038/T041 | Empty/foreign/stale scope rejected, no stale publication |

## Metrics and constitution (`CC-01`..`CC-08`)

- Requirements: 15 (10 FR + 5 buildable SC); coverage: 15/15 = 100%.
- Tasks: 50, all unchecked and sequential T001–T050. Setup 2, foundation 7, US1 12, US2 10, US3 12, final 7.
- Parallel opportunities: 17 disjoint test-owner tasks after their prerequisites; shared implementation writes remain serial.
- Initial findings: 4 (0 critical, 1 high, 2 medium, 1 low); final ambiguity, duplication, unmapped tasks and actionable issues: 0.
- CC-01 PASS: SRS IDs, complete requirement coverage and upstream flow-back.
- CC-02 PASS at task-design level: explicit Tests/Implementation headings and Red dependencies for every requirement. Runtime Red/Green has not been executed.
- CC-03 PASS: exact C-02 scope/revision/ACL at read and publication, fail closed on cache restart/mutation.
- CC-04 PASS: citation validation before factual output, explicit refusal, no leaked decoys/history/cache.
- CC-05 PASS: shared schemas, deterministic pipelines, unchanged public C-02 and C-03 lifecycle, predecessor helper extensions.
- CC-06 PASS at planning level: sequential 3.1→3.2→3.3→3.4 handoff; v2 owner override distinguished from measured evidence; full v3 runtime gate pending.
- CC-07 PASS at design level: Owner isolation, enterprise EU processing, private handles/telemetry, no credentials or provisioning.
- CC-08 PASS: current TypeScript/Cloud Run/PostgreSQL stack; no new datastore/service/migration. D19 provider acceptance retained; no R6 spike.

## Validation and next step (`CC-01/02/06`, Gate v3.0)

Static validation confirms task format, contiguous IDs, backward local dependencies, source IDs/file paths, story labels/headings, exact feature pin with environment variable absent, and byte-identical reviewer checklists. All 38 custom checklist items remain unchecked; built-in 16-item requirements checklist is unchanged. Spec integrity and whitespace checks pass. No application code or runtime test was executed.

MVP is foundation + US1 precise retrieval and benchmark; independent story checks cover US1 needle/timing, US2 all-Guide synthesis/detail follow-up, and US3 complete original evidence with bounded memory. Later stories and integrated release checks remain necessary for full delivery. Implementation can follow these tasks in package order. Deployed benchmark, model/cache capacity, memory, performance and quality proof remain UNAVAILABLE until implemented and run on an approved environment; document completion is not Gate v3.0 acceptance.
