# Requirements Quality Checklist: Studio Reports Gates (C-03, Scope, Grounding)

**Purpose**: Unit tests for the requirements — verify completeness, clarity, consistency and measurability of Package 2.4 before task generation. Depth: standard (author/reviewer). Resolution: all items reviewed on 2026-10-19; recommendation **proceed to `/speckit-tasks`**.
**Created**: 2026-10-19
**Feature**: [spec.md](../spec.md) | [plan.md](../plan.md) | [data-model.md](../data-model.md) | [contracts](../contracts/interfaces.md)

## C-03 Contract & Lifecycle

- [x] CHK001 Is the C-03 plugin/registry shape defined once with a single owning file and open-closed registration? [Completeness, C-03, plan §Source Code] — Yes: `package-v2-4.ts`; duplicate/unknown registry errors specified.
- [x] CHK002 Are legal state transitions and terminal immutability specified for all five states? [Clarity, C-03, data-model §State transitions]
- [x] CHK003 Is retry unambiguous (new attempt, fresh authorization, explicit scope, who may retry)? [Clarity, FR-013, research R4]
- [x] CHK004 Is cancellation behavior (no partial publication) specified and testable? [Coverage, Edge Case, spec §Edge Cases]
- [x] CHK005 Are failure codes enumerated so "source-changed explanation" and "refusal explanation" are objectively testable? [Measurability, FR-013/014, data-model]

## Scope, Snapshot & Authorization

- [x] CHK006 Is the empty/omitted selection rejected server-side with no all-sources fallback, and disabled in the UI? [Consistency, FR-012, contracts §HTTP]
- [x] CHK007 Are snapshot capture, pre-read and pre-publish access re-checks, and the no-silent-substitution rule all specified? [Completeness, FR-013, research R3/R4]
- [x] CHK008 Is the Owner-only phasing explicit and are later roles excluded? [Consistency, FR-016, NFR-SEC-02]
- [x] CHK009 Is historical-artifact behavior for deselected vs deleted/revoked sources distinguished? [Clarity, research R7]

## Grounding & Evidence

- [x] CHK010 Are citation validity rules (chunk membership, revision match, verbatim quote, literal date) precise enough to test deterministically? [Measurability, FR-014, research R3]
- [x] CHK011 Are required vs core blocks and the insufficient-evidence outcome (fewer items with note vs refusal) defined per template? [Completeness, FR-015, data-model §Templates]
- [x] CHK012 Is the no-dates Timeline behavior (statement + cast, no invented dates) defined? [Edge Case, FR-005]
- [x] CHK013 Is processing of *all* scoped chunks in bounded batches (not summaries) specified with measurable bounds? [Completeness, D12, research R2]
- [x] CHK014 Is the deterministic-vs-agentic boundary explicit (no `LlmAgent`) and the model interface injectable? [Consistency, Constitution IV, research R6]

## Dynamic & Custom Reports

- [x] CHK015 Are the 1/5,000/5,001 prompt boundaries, trim rule and code-point counting unambiguous? [Clarity, FR-010, data-model §Validation rules]
- [x] CHK016 Are Pending/Failed/Ready Source Guide states and their UI effects defined, including that standard/custom stay usable? [Coverage, FR-018]
- [x] CHK017 Is the 3.0 s suggestion bound plus cache identity (scope, revision, authz, language) specified? [Measurability, FR-009, research R5]
- [x] CHK018 Is the risk-matrix edit scenario traceable to a prompt-bearing artifact whose content must be source-grounded? [Traceability, FR-011, US2/AC2]

## Measurability & Non-Functional

- [x] CHK019 Is the P95 ≤ 25.0 s criterion measurable on a declared fixture, and is the live-model portion labelled `UNAVAILABLE`? [Measurability, FR-017, plan §Technical Context]
- [x] CHK020 Is the leakage = 0 / citation-ID precision = 1.0 obligation mapped to deterministic tests? [Traceability, NFR-EVAL-02/04]
- [x] CHK021 Are actions on completed artifacts (open, copy, convert-to-source via FR-NM-03, delete) and their failure behavior defined? [Completeness, FR-008, contracts §HTTP]
- [x] CHK022 Are out-of-scope items (FR-ST-12, PDF/DOCX export, template uploads, non-owner roles) stated and not planned? [Scope, spec §Assumptions]

## Notes

- No gate failed; no item needs a spec change beyond the already-flowed-back [plan refinements](../spec.md#plan-refinements-flow-back-from-speckit-plan-2026-10-19).
