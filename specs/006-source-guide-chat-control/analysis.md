# Specification Analysis Report: Proactive Context Intelligence & Chat Control

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Tasks**: [tasks.md](tasks.md) | **Checklist**: [requirements-quality.md](checklists/requirements-quality.md)
**Package Source**: [Package 2.2](../../spec/requirements/v2/package_2_2_proactive_context_intelligence_chat_control.md) + [binding rules](../../spec/requirements/README.md)
**SRS IDs**: `FR-SI-02`, `FR-GC-04/05/07/09`, `FR-NM-02`, `C-02`, `NFR-EVAL-02/04`, `Gate v2.0 #1/#2`
**Analyzed**: 2026-10-19

## Findings

| ID | Category | Severity | Location(s) | Summary | Recommendation |
| :- | :- | :- | :- | :- | :- |
| — | All categories | NONE (resolved) | `plan.md`, `validation.md`, T001 | The original deterministic evaluation failure was environmental; rerunning with Gemini API-key variables unset passed all 29 tests. No remaining cross-artifact blocker was identified. | Proceed with implementation, while retaining upstream evidence boundaries for Gate v1 upload/citation and Package 2.1. |

The documentation inconsistencies found during analysis were corrected before this report: Source Guide retry policy is bounded and identical in the feature spec, research, contracts and Package 2.2 card; latency targets have explicit deterministic test tasks while external P95 remains an explicit deployment gate; and the web-shell integration now has a test-before-implementation task. The save-note DTO is identical in the Package 2.2 feature/card and Package 2.3 FR-NM-02 card. No other cross-artifact mismatch remains.

## Requirement and Success-Criteria Coverage

| Requirement | Has task? | Task IDs | Notes |
| :- | :- | :- | :- |
| FR-001 | Yes | T006, T009 | Ready trigger, C-02 singleton scope and persistence |
| FR-002 | Yes | T002, T006, T009 | Source-length exception, word/topic boundaries and no padding |
| FR-003 | Yes | T008, T011 | Inspector placement and grounded topic dispatch |
| FR-004 | Yes | T006, T009, T011 | Selection isolation, retry and readable source on guide failure |
| FR-005 | Yes | T012, T015 | Scoped overview, prompt limits, cache identity and support IDs |
| FR-006 | Yes | T014, T017 | Overview presentation and grounded starter prompt action |
| FR-007 | Yes | T012–T017 | Stale/empty/deleted scope invalidation and cache rechecks |
| FR-008 | Yes | T018, T020 | 0–3 supported chips, limit, timing and latest-message storage |
| FR-009 | Yes | T018–T021 | Refusal-safe suggestions and next-turn dispatch |
| FR-010 | Yes | T002, T022–T025 | Options, defaults, persistence, subsequent turn and header indicator |
| FR-011 | Yes | T002, T022–T025 | Trimmed Unicode bounds and previous-value retention |
| FR-012 | Yes | T022, T024 | Non-overridable grounding/citation guardrails; length targets |
| FR-013 | Yes | T027–T031 | Toolbar, copy variants, confirmation and thumbs-up |
| FR-014 | Yes | T002, T026–T031 | Categories, comment bounds, persistence and active state |
| FR-015 | Yes | T026–T031 | Stable note shape, citations, zero-citation save, idempotency |
| FR-016 | Yes | T027, T030 | Authenticated message ownership and v2 Owner-only note creation |
| FR-017 | Yes | T006, T012, T018, T027 | Explicit scopes, snapshots and fail-closed publication |
| FR-018 | Yes | T006, T012, T018, T020, T034 | Deterministic local budgets; real P95 requires approved endpoint |
| FR-019 | Yes | T028, T030, T031 | Local copy/feedback and saved-note display budgets |
| FR-020 | Yes | T012, T018, T020 | Exact cache key/support IDs and latest assistant metadata |
| SC-001 | Yes | T006, T034 | Local fake-client budget is not production P95 evidence |
| SC-002 | Yes | T012, T014–T017 | Six-second local budget and stale-scope hiding |
| SC-003 | Yes | T018–T021 | One-second follow-up target and scope invalidation |
| SC-004 | Yes | T002, T022–T025 | Custom instruction bounds and adversarial guardrail case |
| SC-005 | Yes | T028–T031 | Copy/feedback and note-render local timing targets |
| SC-006 | Yes | T006, T012, T018, T027, T034 | Scoped chunks/citations and zero-leakage assertions |
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

- `pnpm test:unit` — **PASS** (46 files, 364 tests).
- `pnpm eval:deterministic` — initially **FAIL** with API-key environment; `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm eval:deterministic` — **PASS** (6 files, 29 tests). See [validation.md](validation.md).
- `node scripts/check-spec-integrity.mjs` — **PASS** (96 Markdown files, 55 SRS links, 15 feature artifact sets).
- Total functional requirements: 20 (`FR-001`–`FR-020`); total buildable success criteria: 7; total tasks: 36.
- Coverage: 100%; unresolved cross-artifact ambiguity: 0; duplicate requirements: 0; critical release blockers: 0 (Gate v1 deterministic prerequisite passes; other v1 artifacts remain upstream evidence).

## Next Actions

- Proceed with `/speckit-implement` using `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm ...` for pnpm validation. Keep full Gate v1 release evidence distinct from this deterministic eval result.
- After Gate v1 passes, confirm Package 2.1 prerequisites, rerun analysis if source artifacts changed, then resume Package 2.2 implementation.
- Do not declare Gate v2.0 #2 passed until Package 2.3 FR-NM-03 converts the saved note and a subsequent grounded turn cites the converted source.
