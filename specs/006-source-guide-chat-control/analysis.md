# Specification Analysis Report: Proactive Context Intelligence & Chat Control

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Tasks**: [tasks.md](tasks.md) | **Checklist**: [requirements-quality.md](checklists/requirements-quality.md)
**Package Source**: [Package 2.2](../../spec/requirements/v2/package_2_2_proactive_context_intelligence_chat_control.md) + [binding rules](../../spec/requirements/README.md)
**SRS IDs**: `FR-SI-02`, `FR-GC-04/05/07/09`, `FR-NM-02`, `C-02`, `NFR-EVAL-02/04`, `Gate v2.0 #1/#2`
**Analyzed**: 2026-10-19 (post-convergence refresh)

## Findings

| ID | Category | Severity | Location(s) | Summary | Recommendation |
| :- | :- | :- | :- | :- | :- |
| — | All categories | NONE (resolved) | `spec.md`, `plan.md`, `tasks.md`, T037–T059 | The thirteen convergence gaps are resolved: canonical C-02 scope checks, fail-closed injected runtime/chat and source listing, authorized source selection, saved-note display, scoped follow-up persistence, notebook identity/empty states, feedback comments, explicit active preferences, local latency/cache evidence, evidence-limited overview prompts and support IDs, short-source sentence validation, and plan/analysis flow-back. | Proceed to final verification and convergence review; retain upstream Gate v1/Package 2.1 and downstream Package 2.3 evidence boundaries. |

The documentation inconsistencies found during analysis were corrected before this report: Source Guide retry policy is bounded and identical in the feature spec, research, contracts and Package 2.2 card; latency targets have explicit deterministic test tasks while external P95 remains an explicit deployment gate; and the web-shell integration now has a test-before-implementation task. The save-note DTO is identical in the Package 2.2 feature/card and Package 2.3 FR-NM-02 card. No other cross-artifact mismatch remains.

## Requirement and Success-Criteria Coverage

| Requirement | Has task? | Task IDs | Notes |
| :- | :- | :- | :- |
| FR-001 | Yes | T006, T009, T037, T047, T048 | Ready trigger, C-02 singleton scope and persistence |
| FR-002 | Yes | T002, T006, T009, T058 | Source-length exception, word/topic boundaries and no padding |
| FR-003 | Yes | T008, T011 | Inspector placement and grounded topic dispatch |
| FR-004 | Yes | T006, T009, T011 | Selection isolation, retry and readable source on guide failure |
| FR-005 | Yes | T012, T015, T039, T049, T052, T057, T059 | Scoped overview, prompt limits, cache identity and support IDs |
| FR-006 | Yes | T014, T017 | Overview presentation and grounded starter prompt action |
| FR-007 | Yes | T012–T017, T039, T049, T051, T052, T057, T059 | Stale/empty/deleted scope invalidation and cache rechecks |
| FR-008 | Yes | T018, T020, T039, T042, T051 | 0–3 supported chips, limit, timing and latest-message storage |
| FR-009 | Yes | T018–T021 | Refusal-safe suggestions and next-turn dispatch |
| FR-010 | Yes | T002, T022–T025 | Options, defaults, persistence, subsequent turn and header indicator |
| FR-011 | Yes | T002, T022–T025 | Trimmed Unicode bounds and previous-value retention |
| FR-012 | Yes | T022, T024 | Non-overridable grounding/citation guardrails; length targets |
| FR-013 | Yes | T027–T031 | Toolbar, copy variants, confirmation and thumbs-up |
| FR-014 | Yes | T002, T026–T031, T043, T053 | Categories, comment bounds, persistence and active state |
| FR-015 | Yes | T026–T031, T041, T050 | Stable note shape, citations, zero-citation save, idempotency |
| FR-016 | Yes | T027, T030 | Authenticated message ownership and v2 Owner-only note creation |
| FR-017 | Yes | T006, T012, T018, T027, T037, T039, T047, T051 | Explicit scopes, snapshots and fail-closed publication |
| FR-018 | Yes | T006, T012, T018, T020, T034, T045, T055 | Deterministic local budgets; real P95 requires approved endpoint |
| FR-019 | Yes | T028, T030, T031, T041, T043, T045, T050, T053, T055 | Local copy/feedback and saved-note display budgets |
| FR-020 | Yes | T012, T018, T020, T042, T051, T059 | Exact cache key/support IDs and latest assistant metadata |
| SC-001 | Yes | T006, T034, T045, T055 | Local fake-client budget is not production P95 evidence |
| SC-002 | Yes | T012, T014–T017, T045, T052, T055, T057, T059 | Six-second local budget and stale-scope hiding |
| SC-003 | Yes | T018–T021, T039, T042, T045, T051, T055 | One-second follow-up target and scope invalidation |
| SC-004 | Yes | T002, T022–T025 | Custom instruction bounds and adversarial guardrail case |
| SC-005 | Yes | T028–T031, T041, T043, T045, T050, T053, T055 | Copy/feedback and note-render local timing targets |
| SC-006 | Yes | T006, T012, T018, T027, T034, T037, T039, T047, T051 | Scoped chunks/citations and zero-leakage assertions |
| SC-007 | Yes | T026–T030, T036 | Package 2.3 FR-NM-03 conversion is an explicit downstream dependency; Gate v2.0 is not claimed here |

**Coverage**: 27/27 buildable feature requirements and success criteria are mapped to tests/implementation or explicitly named release-evidence tasks (100%). Package 2.3's note-to-source work is intentionally not specified as Package 2.2 implementation; the full Gate v2.0 #2 roundtrip remains a release integration prerequisite.

## Constitution Alignment (`CC-01`..`CC-08`)

| Gate | Status | Evidence |
| :- | :- | :- |
| CC-01 Traceability | PASS | Every FR/SC is mapped above; stable save-note contract flowed into feature spec and both package cards. |
| CC-02 Test-First | PASS | Tasks order contract/repository/pipeline/API/UI tests before their implementations. |
| CC-03 Scope/Snapshot | PASS | C-02 remains the sole read boundary; nonempty explicit scope and exact source revisions/access rechecks are stated. |
| CC-04 Citations/Leakage | PASS | Supporting chunk IDs validate against scoped chunks; stale and out-of-scope content fails closed. |
| CC-05 Contracts/Pipelines | PASS | Package DTOs extend only `package-v2-2.ts`; deterministic pipelines, no agent loop or duplicate C-01/C-02. |
| CC-06 Release/Order | PASS* | Deterministic eval passes 29/29 with keyless shell; upstream upload/citation and Package 2.1 evidence are not re-certified here. |
| CC-07 Security/Residency | PASS at design level | Owner-only v2 and enterprise/europe-west4 production requirements are explicit; no cloud config is claimed. |
| CC-08 Platform/Cost | PASS at design level | Existing pnpm/TypeScript/Cloud SQL architecture; no dependency or service additions. |

## Verification and Metrics

- `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm test:unit` — **PASS** (57 files, 415 tests).
- Focused Package 2.2 convergence suites — **PASS** (11 files, 56 tests); see [validation.md](validation.md) for the exact command.
- `pnpm eval:deterministic` — initially **FAIL** with API-key environment; `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm eval:deterministic` — **PASS** (6 files, 29 tests). Latest focused/typecheck/lint gates are recorded in [validation.md](validation.md).
- `node scripts/check-spec-integrity.mjs` — **PASS** (98 Markdown files, 55 SRS links, 15 feature artifact sets).
- Total functional requirements: 20 (`FR-001`–`FR-020`); total buildable success criteria: 7; total tasks: 59 (T001–T059).
- Coverage: 100%; unresolved cross-artifact ambiguity: 0; duplicate requirements: 0; critical release blockers: 0 (Gate v1 deterministic prerequisite passes; other v1 artifacts remain upstream evidence).

## Next Actions

- All final unit and focused suites, typecheck, lint, integrity, deterministic eval, and diff checks pass; deterministic local timing remains distinct from cloud P95. The final convergence pass verifies T057–T059.
- Keep full Gate v1 upload/citation evidence and Package 2.1 prerequisites distinct from this feature evidence; do not claim Gate v2.0 #2 until Package 2.3 converts the saved note and a subsequent grounded turn cites it.
- Do not declare Gate v2.0 #2 passed until Package 2.3 FR-NM-03 converts the saved note and a subsequent grounded turn cites the converted source.

## Pre-v4 follow-up analysis, 2026-11-07 (CC-01..CC-08)

The T089–T091 changes map to FR-002/FR-012 and upstream FR-SI-02/FR-GC-07. Spec, plan and package card agree on generation headroom, record summarization and trusted request-local Shorter routing (CC-01); observed failing regression tests precede implementation (CC-02). C-02 scope/snapshot handling and citation/refusal validation are unchanged; concurrent length isolation and no source/custom promotion are tested (CC-03/04/07). No schema, datastore, service or dependency is added (CC-05/08). Work is restricted to the existing v2 package; v3/v4 release acceptance is not inferred, and the recorded global judged failure remains open (CC-06). No new consistency finding in this bounded change; reviewer checklists were not marked reviewed. See validation.md for passing package metrics and retained global limitations.


## Integration and eval-resilience analysis, 2026-11-07 (T092–T094)

Checkpoint integration preserves T089–T091 behavior/evidence without repeating paid
runs. The resilience gap was verified: provider retries were bounded but had no
attempt records, malformed JSON was retried, and exhausted judge errors escaped
metric computation before a report. T092 Red tests reproduced all three behaviors;
T093 retains private-safe attempt outcomes and cumulative elapsed time, retries only
429/5xx, and records case-local judge failures without dropping the case population.
Affected judged metrics become unavailable and the report fails through errored cases.

CC-01: feature spec/plan, upstream card and T092–T094 agree. CC-02: observed Red
preceded Green implementation. CC-03/04: product C-02, refusal and citation validation
are unchanged and existing verifier tests pass. CC-05: additive evaluation metadata
only; no shared contract fork. CC-06: no new release acceptance is claimed; historical
judged/report/OCR failures remain. CC-07: attempt records omit prompts, source text
and raw provider error messages. CC-08: no runtime dependency, service or datastore
is added. Reviewer-owned checklists retain 18 unchecked entries and were not edited.
No further high/critical finding in this scoped integration.


## Resumed CC-09 analysis, 2026-11-09 (T095–T097)

Read-only analysis was rerun after refreshing spec/plan/tasks and before the
verification stage. Scope: 006 Guide/Shorter/judge repairs inherited at base 935eabe;
this reconciliation changes documents/evidence only. Boundary inventory names
workflow, transport, adapter and composition ownership, exact public ports and
regression paths. No new runtime implementation is needed for 006.

| Finding | Severity | Result |
| --- | --- | --- |
| Missing resumed 006 CC-09 spec/plan/tasks and inventory | CRITICAL before refresh | RESOLVED: actual artifact Red captured; scoped validator now reports no findings |
| Existing eval-to-app, API-to-worker and wildcard interface debt | Unchanged D21 migration debt |25 exact policy records copied with baseline, owner, removal task and expiry; no policy or edge changed |
| Global 008/009artifact and008 fixture graph defects | Out of this package; remains FAIL | Eight artifact findings and two graph findings preserved and assigned to later package agents |

CC-01: artifacts cite FR-SI-02/FR-GC-07/NFR-EVAL-01..04 and canonical D21; no behavior
refinement requires new upstream scope. CC-02: existing regression tests characterize
unchanged code; governance Red precedes artifact repair. CC-03/04: exact scope,
request-local length, invalid-output/refusal and publication guards remain unchanged.
CC-05: existing typed ports and contracts retained. CC-06: Gate v3 still pending and
legacy v2 owner override preserved. CC-07: no new cloud, credentials or authorization
behavior. CC-08: no runtime/dependency/export modification. CC-09 pre-research FAIL
for missing evidence; post-design manual PASS for this docs-only slice, scoped
artifact PASS. Global automated gates remain FAIL as recorded; manual review does
not substitute for them. No remaining scoped high/critical finding or new exception.

The manual review describes current owner placement; it does not claim that the
existing R1/R3migration has been completed. Eighteen reviewer checklist entries stay
unchecked and unchanged. Before/after analyze and implement hooks are optional Git
commit hooks only; no mandatory hook applies. Final checkpoint commit records this
package completion; no paid release run or live acceptance was performed.
