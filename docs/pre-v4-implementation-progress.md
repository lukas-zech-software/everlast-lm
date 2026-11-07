# Pre-V4 implementation progress

Started 2026-11-07. Traceability: CC-01/06, Gate v3.0, NFR-PERF-01.

## Scope and stop condition

User authorized implementation through sequential package subagents. Check account
usage before each package and at regular intervals during long work; when any
available relevant window has 10% or less remaining, stop dispatching new work,
ask the active package agent to checkpoint safely, and prepare a handoff. Never
consume a reset credit automatically.

Initial usage: five-hour window 13% used / 87% remaining; weekly 18% used /
82% remaining. Limits are shared account state and must be rechecked.

## Preservation checkpoint

Private recovery snapshot: `/private/tmp/everlast-pre-v4-recovery-20261107-implementation/`.
Contains binary-capable tracked patches, changed/untracked file archives, hashes,
heads and status in manifest.json; original worktrees were not modified.

- Package 006: clean at 4fd99c08d275866badcf853e4f7c7ccfc68cce2a.
- Coordinator recovery: 0e00bf8, seven changed/new files preserved.
- Package 012: 0e00bf8, 55 changed/new files preserved (46 tracked, nine new).
- Original handoff, open-work index and 012 brief copied into private snapshot.

The implementation plan from the earlier planning worktree was uncommitted; it
has been copied here explicitly so descendants inherit the actual plan.

## Package queue

006 integration → 001 retained work → 008 retained work → 009 recovery →
010 recovery → 011 recovery and numeric export → 012 recovery/qualification →
integrated gate acceptance. Conditional 002 OCR and 003 refusal repairs get their
own package agents/worktrees if needed. One active package agent at a time.

No deployment, paid cohort, GitHub issue closure or external message has occurred
as part of this implementation continuation. Prepare concrete approved-scope
resource/workload plans before any approval-gated cloud action.

## Package 006 completed

Checkpoint `0e77ebb` on `codex/pre-v4-impl-006-20261107` (clean). Integrated
original Guide/Shorter fixes and added judge retry/failure reporting with per-run
attempt isolation. Product Guide sources match original `4fd99c0`.

Checks: 75 focused tests plus final four judge regressions, lint/typecheck/spec
integrity/diff PASS; deterministic citation160/160 and leakage0 PASS. No new paid
runs or deployment. Historical overall judged failure remains FAIL; 18 reviewer
checklist entries unchanged. Package handoff:
`/private/tmp/everlast-pre-v4-impl-006-handoff-20261107.md`.

Package001 agent started from `0e77ebb`; target worktree
`/private/tmp/everlast-pre-v4-impl-001-20261107`. Last parent usage check: 69%
five-hour remaining, 79% weekly.

## Coordinator security triage (read-only)

Dependabot alert2 remains open for transitive uuid9.0.1 under GHSA-w5hq-g745-h8pq.
Advisory concerns supplied-buffer writes in v3/v5/v6; installed gaxios6.7.1 uses
v4() for multipart boundaries, ExcelJS4.4.0 uses v4() for conditional-format IDs.
No direct uuid imports found under apps/packages/scripts. This is a scoped caller
inspection, not proof for every possible path; no dismissal, override or dependency
change applied. Final lockfile/upstream update still needs compatibility review.

Latest usage check during001: five-hour60%remaining, weekly78%remaining.

## Package 001 safe implementation checkpoint

Checkpoint `be90304` on `codex/pre-v4-impl-001-20261107` (clean). Added
admin-only signup IaC, sign-in UI behavior and explicitly gated real identity/GCS
cleanup suites. D21/DEV-06 record the saved owner policy.

Checks: 22 local tests plus two provider mock tests, tofu validate, lint/typecheck/
spec/diff and deterministic citation160/160/leakage0 PASS. Two live tests skipped;
missing-approved-fixture probe reports UNAVAILABLE before cloud access.
T046/T061 remain OPEN: policy unapplied, disposable fixture approval/config absent.
Current upload capability is signed PUT; arbitrary administrator-created resumable
session cancellation is not proven and must not be silently discharged.
Handoff `/private/tmp/everlast-pre-v4-impl-001-handoff-20261107.md`.

Package008 started from `be90304`, target worktree
`/private/tmp/everlast-pre-v4-impl-008-20261107`. Latest remaining usage46% five-hour,
76%weekly. No other package agent active.

## OCR prerequisite inventory (read-only, 2026-11-07)

Authenticated Document AI processors.list in EU returned an existing ENABLED
LAYOUT_PARSER_PROCESSOR `projects/865450204790/locations/eu/processors/7e8fb3b073398d36`
(displayName everlast-dev-layout-parser). No provisioning or process call occurred.
The judged CLI createOcrEngine accepts this full value as DOCUMENT_AI_PROCESSOR_NAME;
the saved failure was SEC-OCR missing configuration. This inventory does not prove
processing access/functionality or a release pass. Include the existing processor
in the final authorized candidate's environment/preflight; do not create a duplicate
just to resolve the old absent env var. Initial Python TLS trust failed; system curl
with ordinary TLS verification succeeded. Credentials were kept private.

## Package 008 local completion checkpoint

Checkpoint `eb25d667797abb8fe961bc26e17913b860a3b7ac` on
`codex/pre-v4-impl-008-20261107` (clean). Migration0012 adds atomic persisted Guide
admission and immutable primary-language metadata. Defaults2concurrent/20starts per
notebook/rollinghour, configured by GUIDE_MAX_CONCURRENT/GUIDE_MAX_STARTS_PER_HOUR.
Dedup, failures in hourly population, terminal/restart recovery, route429 and
suggestion-unavailability behavior verified. Initial primary polling is excluded;
preference changes are charged variants and no longer become perpetual Pending.

Checks: final6files/51tests, lint/typecheck/spec/diff PASS. Deterministic
citation160/160/leakage0 PASS; that run preceded final identity fix, affected API
suite reran afterward. T061 locally complete; T076 live report/common judged
acceptance OPEN. Report504/75%validity remainsFAIL, model/timeouts untouched.
Handoff `/private/tmp/everlast-pre-v4-impl-008-handoff-20261107.md`.

Package009 started from `eb25d66`, target
`/private/tmp/everlast-pre-v4-impl-009-20261107`, soleactive package agent.
Latest remaining usage17%five-hour/71%weekly; agent instructed to checkpoint at<=10%.

## Usage cutoff and Package 009 partial recovery

User cutoff observed:10%five-hourremaining/70%weekly. No further implementation
or new package dispatch after that observation; already-running local checks finished.
Package009finalcheckpoint `f3a9e388a9ef5443795306e964dd1b4ee28577b4` on `codex/pre-v4-impl-009-20261107`, clean.
Audio recovery77bac2b integrated as e278c03;10audio tests,typecheck,lint/spec/diffPASS.
Unconfigured audioCLI correctlyUNAVAILABLEexit2 before provider work.

009infra7e87bb2NOTintegrated: broadprovider6→8.9changes require compatibility review.
Resume009before010;T049/T050liveacceptance stillOPEN. Handoff
`/private/tmp/everlast-pre-v4-impl-009-handoff-20261107.md`. Allpackageagents finished;
no test/dev processes left by agents. SharedlocalPostgres remainsavailable.

Overallhandoff: docs/pre-v4-implementation-handoff-2026-11-07.md, copied also to
`/private/tmp/everlast-pre-v4-implementation-handoff-2026-11-07.md`.
No resetcredit consumed. No cloudwrites/deployments/paidruns/GitHubwrites.
