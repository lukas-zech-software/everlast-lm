# Analysis: Notes & Pinboard Lifecycle

Trace: FR-NM-01, FR-NM-02, FR-NM-03, FR-NM-04, FR-GC-09, C-01, C-02. Artifacts: [spec](spec.md), [plan](plan.md), [tasks](tasks.md), [checklist](checklists/ux.md).

## Findings (all resolved)

| ID | Severity | Finding | Resolution |
| :--- | :--- | :--- | :--- |
| A1 | Medium | "Displayed order" undefined (checklist CHK003) | Defined as `display_order` ascending in spec FR-010 and the FR card |
| A2 | Medium | Note title limit 200 vs source title limit 100 (CHK004, CHK011) | Source title clamped to 100 code points; full title kept as first heading (spec FR-010, FR card) |
| A3 | Low | "Convert all notes" vs 50-note assistant cap (CHK023) | No cap on convert-all; documented in spec FR-010 and FR card |
| A4 | Medium | Shared save-note contract with Package 2.2 | Own schema in `package-v2-3.ts`; reconcile at merge ([plan](plan.md)) |
| A5 | Low | Offline draft locality unstated | Spec Assumptions: client-only draft |

## Coverage and gates

Every FR-001..FR-019 maps to a task in [tasks.md](tasks.md) (US1 FR-001..005, US2 FR-006..009, US3 FR-010..013/019, US4 FR-014..018). Tests precede implementation in every story (CC-02). Constitution gates CC-01..CC-08 pass in the plan. No unmapped requirements, no orphan tasks, no remaining CRITICAL/HIGH findings.
