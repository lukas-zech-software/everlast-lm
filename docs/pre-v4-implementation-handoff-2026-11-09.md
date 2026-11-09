# Pre-V4 implementation handoff — 2026-11-09

## Objective and current result

The active user goal is to refresh main and finalize all outstanding pre-V4 work,
including release gates and tests, before V4 tasks commence. This goal is NOT
complete: Gate v3 and several retained implementation/live obligations remain open.

User also requires regular usage checks and a safe handoff when a relevant usage
window reaches 10% or less remaining. Do not use reset credits automatically.

## Start here

- Current continuation branch: `codex/pre-v4-resume-20261109`.
- Worktree: `/private/tmp/everlast-pre-v4-resume-20261109`.
- Current progress: `docs/pre-v4-resume-20261109.md`.
- Candidate index: `docs/pre-v4-implementation-candidate.json`. Older validation
  results are explicitly dated; they do not certify the final candidate.
- Original execution scope: `docs/pre-v4-implementation-plan.md`, original
  `/private/tmp/everlast-pre-v4-open-work-2026-11-07.md`, companion handoff and
  recovered runbook under `/private/tmp/everlast-lm-pre-v4-execution-20261105/docs/`.
- Constitution 2.1 and current AGENTS/architecture guardrail procedure supersede
  the older plan's eight-gate wording. CC-09 is mandatory on resumed features.

## Main refresh and architecture reconciliation

Fetched main `5f44947`, merged it with prior continuation `a937b9e` at `abe17ff`.
The root/main checkout was not modified. Main updated dependencies/providers and
introduced architecture checks under CC-09. Canonical D21 is main's architecture
enforcement decision; provisional unmerged signup D21 was explicitly superseded
under D22, preserving the original owner policy and historical evidence.

Initial new checks found 15 graph findings and 16 artifact findings in inherited
local changes. Sequential package agents repaired them without policy expansion:

| Package | Commit | Verified result |
| --- | --- | --- |
| 001 | `935eabe` | Explicit db/testing and six testkit exports; literal unchanged Firebase URLs. 31 targeted tests, 39 checker fixtures, two provider tests, typecheck/build/spec and deterministic citation160/160/leakage0 passed. Live signup/identity/storage remains open. |
| 006 | `3d02a51` | Docs/evidence CC-09 reconciliation; 66 focused tests, typecheck/spec/diff pass. No runtime or policy changes. |
| 008 | `fb75e72` | API-owned suggestion fixture replaces worker import. Same 51 tests pass before/after; scoped artifacts/type/spec/diff pass. Production unchanged. |
| 009 | `62b297424e0a39e993ca955966187945b0b65257` | Recovered default-off ingestion/Model Armor wiring, five provider locks at 8.10.0, render bootstrap repair. Seven mock runs, module validation/policy tests, 33 focused tests, lint/type/spec/deterministic and CC-09 checks pass. Live T049/T050 stays open. |

The parent independently verified 186 retained exception records exactly equal
main and zero new/edited records. The 107 removals correspond to actual repairs,
not rebaselining. After 009 the graph and changed-feature artifacts both pass.
Untouched historical features are not retrospectively certified.

Per-package handoffs are under `/private/tmp/`:
`everlast-pre-v4-001-cc09-handoff-20261109.md`,
`everlast-pre-v4-006-cc09-handoff-20261109.md`,
`everlast-pre-v4-008-cc09-handoff-20261109.md`,
`everlast-pre-v4-009-resume-handoff-20261109.md`.

## Image and infrastructure evidence

Current provider constraint intersection is preserved; all five tracked locks now
select 8.10.0. Offline schema/mocks/validate do not constitute a saved cloud plan.
All optional new ingestion/Model Armor resources remain default-off, unapplied.

Actual Node26 image has no Corepack (Red127); render now installs pinned pnpm12
via npm. Full local native image build and network-disabled runtime/tool/entrypoint
smoke passed. Tag: `everlast-pre-v4-render-009:20261109`; manifest-list digest:
`sha256:53e67574d1995b3c6fd60c6a420f79995fbf5661016480d9c979b45c79d8a082`.
This is not a declared Cloud Run deployment image: build the final target platform
and freeze new digests. Main API/worker Node24→26 remains assigned to 012.

## Recovery integrity and future merge cautions

Old temporary recovery directories lost their .git links. Seven loose 012 files
are missing. All saved archive members were revalidated against their SHA256s;
all missing files are present in the verified archive at
`/private/tmp/everlast-pre-v4-recovery-20261107-implementation/`.
Use preserved base `0e00bf8` and binary patch with reviewed three-way merging for
tracked files; recover untracked files selectively from the archive. Never blanket
overwrite modern manifests, locks, shared docs or earlier package changes.

Missing loose files retained in archive: v3-context-local.ts; context-session.ts;
context-vertex.ts; their two worker tests; v3-scale-import.ts; v3-scale-runner.test.ts.
Full paths and inventory are in the current progress document and recovery manifest.

Later 012 must preserve 006 trusted Guide instructions plus its own cache/private
error handling in package-v2-2-gemini.ts; preserve 008 atomic admission, immutable
primary-language identity, startup recovery and configuration in runtime/server.
Migration0012 is already guide admission/primary metadata; recheck future numbers.
Retain 009 render bootstrap repair and 001 signup D22/DEV-06.

## Remaining scope and external state

Continue sequentially: finish 010, then 011 numeric export #153/viewer acceptance,
012 recovery/scale/cache/qualification, retained 003 GC-E04 refusal browser coverage,
and all retained 001/008 live obligations. Do not create a combined feature branch.
Exactly one subagent per package, only one active at once; reuse existing package
agents for continuation. Each starts in a new worktree from its predecessor and
pins its matching feature immediately. Shared changes remain serialized.

- #153 still requires numeric CSV/XLSX values and separate citation columns, full
  spec/card/architecture flow-back, safe formulas and conflict/missing/citation
  semantics. Do not implement text-only exports.
- Preserve 011's 16.734ms failure against16ms and diagnose declared measurement/
  environment honestly; never round or silently lower the requirement.
- Preserve all 012 local diagnostics as labelled doubles, not enterprise capacity.
  T051–T060, SCALE-UI-01, real token ledger/readiness/concurrency and original
  evidence/cache qualification need current-candidate verification.
- 001 signup policy is not applied; T046/T061 require approved disposable live
  fixtures and actual authorization/revocation/purge proof. Arbitrary external
  administrator-created resumable-session cancellation is not proven.
- 008 report 504/75% validity remains a historical FAIL, not fixed by admission.
  Do not blindly increase deadlines; review recovered 012 batching before repair.
- Final gates require immutable commit/images/config/fixtures, all required local
  and live cohorts, previous-gate regressions, one qualifying fixed stratified
  50-case judged run with all IDs/hash/denominators, and evidence-backed roadmap
  reconciliation. No V4 implementation before Gate v3 passes.

Read-only current cloud check: API/worker still image51f78ab; SQLPostgreSQL16 is
STOPPED/activationNEVER, not ready for acceptance. Existing deployed OCR env names
are present; the old local judged CLI lacked config. Existing EU processor found
earlier is projects/865450204790/locations/eu/processors/7e8fb3b073398d36; recheck
state/IAM/config before paid use. No duplicate processor needed solely for old
missing environment settings.

Gate issue86 remains open. PR174 remains open and connector reports not mergeable;
recheck before publishing/merging. No GitHub state changed in this continuation.
No paid evaluations, cloud resource mutation/apply/deployment occurred. Previous
approval covers exactly four API registrations; it is not authorization for new
resource deployment or unbounded paid runs. Prepare concrete images/saved IaC plan/
resource list/bounded workload before requesting the required owner approval.

## Final cutoff checkpoint

Cutoff observed at 9% five-hour remaining /45% weekly. Parent instructed Package
010 to stop new implementation/test starts, finish already-running checks and
save a safe checkpoint. No Package 011 or later agent was started.

Package 010 final checkpoint: `a922c6382fb8034a43668f7a428a439ac2380dda`, clean, branch
`codex/pre-v4-010-resume-20261109`, worktree of the same name under /private/tmp.
Reviewed a6a38e5 strict benchmark validation is recovered. Seven actual Red
failures became 14 passing tests. Typecheck/lint (including 39 architecture
fixtures, graph0/186 unchanged records and artifact0)/spec/diff checks pass.
No fresh deterministic run: unchanged 009 citation/leakage evidence is reused
with a documented applicability rationale. No test/build process remains running.

T060/T061 are locally complete. Resume this same 010 agent before 011:
T062 optional typed parent infrastructure from 0e00bf8 has NOT been recovered;
T063 actual bounded authenticated application cohort collection is NOT implemented.
Measured serving/fixture/cold-warm evidence is missing. T052 live security/four
cohorts/common judged acceptance remains open. Do not infer readiness from flags.
Handoff: `/private/tmp/everlast-pre-v4-010-resume-handoff-20261109.md`.

All package agents are finished. No new work starts after the cutoff. The
continuation branch is advanced through this checkpoint and its final docs-only
commit records this handoff, current progress and candidate index. Check that
branch's HEAD for the final documentation SHA. Goal remains active and incomplete.
Check current usage and user continuation before resuming; do not spend reset
credits. No cloud writes, paid runs, GitHub writes or deployments occurred.
