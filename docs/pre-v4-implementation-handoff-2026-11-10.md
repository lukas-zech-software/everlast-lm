# Pre-V4 continuation handoff — 2026-11-10

The active goal remains to finalize all pre-V4 implementation, release gates and
tests before V4 work starts. It is not complete. Preserve the original scope in
docs/pre-v4-implementation-plan.md and the dated handoffs/open-work inventory.

## Current coordination

Branch/worktree: codex/pre-v4-resume-20261110 at
/private/tmp/everlast-pre-v4-resume-20261110. Read
docs/pre-v4-resume-20261110.md and docs/pre-v4-implementation-candidate.json.

Initial usage reset to100% five-hour/44%weekly. User's <=10% remaining cutoff
continues to apply; never consume reset credits automatically. Current final
usage/checkpoint will be recorded below after active010 finishes.

All package work uses sequential subagents, one agent per package. Each new task
starts by creating a worktree from the preceding completed checkpoint, immediately
pins its feature via temporary SPECIFY_FEATURE_DIRECTORY then unsets it, and reads
current AGENTS/Constitution2.1 IV/CC-09/architecture guardrails. Reuse existing
package agents for continuation; never widen migration exceptions to pass checks.

## Approved roadmap merge completed

Refreshed existing PR174 with current main at3df9ac5 after local four acceptance
tests, lint/type/spec/diff passed. Sync skill dry run showed zero project changes
and zero issue closures. Actual CI passed447unit/contract,815integration tests
(with12skips),64browser journeys(with1skip), deterministic gates and CodeQL.
The deterministic report remains GatePending, not release acceptance.

Initial normal merge was rejected by automatic approval review because explicit
main mutation authorization was missing. The user then explicitly approved PR174.
Head/checks were revalidated unchanged; normal merge succeeded at
1957b3aa99c8c7faeb085b7e48fb6f369ea49f1f. No bypass or issue/gate closure occurred.
Origin/main is fetched at that commit. Its contents are the four governance/audit
files already present in the candidate. Parent merged that ancestry after the final 010 checkpoint; see below.

## Package010 local completion work

Base4e18590; agent /root/package_010, worktree
/private/tmp/everlast-pre-v4-010-complete-20261110, branch of the same name.

Recovered optional typed bare Agent Engine parent and dev/foundation wiring from
0e00bf8, preserving current8.10locks/constraints, ModelArmor/render/Guide/signup
changes and default-off resource creation. R6 remains obsolete underD19.

Implemented bounded ordinary authenticated chat/SSE collector, private file
preflight/reader and shared additive private producer contracts. No public
telemetry endpoint or eval-to-API import. Replaced unused eval wildcard export
with explicit root exports, removing only its obsolete exception:185unchanged
approved records remain, no policy widening.

Collector binds frozen plan/manifest, candidate/revision, Owner/notebook/source
snapshot, expected citations/result, runtime/config digest and retained hashed
clock calibration/qualification. Rejects replay, duplicate execution/attempt IDs,
invalid trace/timings, foreign sources and missing evidence. Hard deadlines bound
even unresponsive ports; invalid evidence stops further unqualified batches.
Known SSE-error execution failures remain FAIL rather than disappearing as missing
evidence. HTTP tests use actual VisibleMessage projection with no request_id;
correlation uses the request/stream, fresh replay flag, running ID and private
trace/request evidence. No public DTO change was introduced.

CLI requires approved exact plan/manifest hashes, two private Owner credentials,
matching EU runtime/config and private producer preflight before dispatch. Guard
tests prove zero HTTP dispatch for wrong approvals/runtime or absent evidence.
Local tests use labelled doubles/loopback HTTP; no paid sandbox/model run occurred.

Latest actual checks:35collector/HTTP/private-file/CLI/evaluator tests,23API/DB
regressions, typecheck/lint/spec/diff and graph/artifact checks pass;7typed-parent
mocked dev plans pass. Final package SHA and handoff are recorded below.

## Remaining integration and release obligations

010T064 production private evidence capture/012 qualification is OPEN; T052 live
security/four cohorts>=20 each and common50-case judged report is OPEN. Never
qualify from flags or fabricate timestamps/zeroes. The private producer must
capture sandbox_created_at immediately BEFORE runtime.create invocation (boot/RPC
time included) and execution_completed_at immediately after runtime.execute settles
on the same server clock. Attempt startedAt is only a consistency bound. The
collector’s local success does not prove production producer/runtime qualification.

Next implementation:011 recovery and numeric exports #153, then012 recovered
streaming/cache/scale/private producer and candidate qualification; retain003
GC-E04 refusal browser coverage,001 live identity/storage/signup and008 report
reliability/live obligations. No V4 implementation until Gatev3 passes.

- #153 option1 was explicitly approved: numeric CSV/XLSX values and separate
  citation columns, with safe formulas and full conflict/missing/citation semantics.
  Flow back spec/plan/contracts/card/architecture before implementation.
- 011 old120-node P9516.734ms>16ms remainsFAIL; no rounding/threshold relaxation.
- 012 recovery archive is verified and contains seven files missing from loose
  temp folders. Recover from preserved0e00bf8 using reviewed three-way tracked
  patches and selective untracked recovery, not a blanket directory overwrite.
- Preserve006trusted Guide+012cache/private errors,008admission/primary language/
  startup/config, migration0012,009render npm bootstrap,001signupD22/DEV06.
  Canonical mainD21 is architecture enforcement.
- SCALE-UI-01 is actually chat-scale.spec.ts. It passed refreshed PR174CI but
  previously failed locally; preserve history and fix brittle setup under012,
  retaining readiness coverage. Do not assume archived studio-scale.spec fixes it.
- Report504/75%validity remains historicalFAIL. Existing EU OCR processor/config
  needs correct final judged environment; no duplicate resource solely for an old
  missing local env var. Current cloud readiness must be freshly inspected.

No cloud apply/resource creation/deployment/paid run occurred. Earlier approval
covered only four API registrations. Before new resource/paid work, prepare actual
images, saved-state IaC plan, exact resources/region, bounded workload and cleanup/
rollback so required owner approval is the final step. Local native render smoke
image is not a target-platform Cloud Run candidate. Final gates require immutable
candidate/digests/fixtures, all applicable tests/live cohorts, fixed stratified
50-case judged evidence and evidence-backed issue/roadmap reconciliation.

Three open moderate dependency alerts were read:14minimatch,13glob,2uuid. No
dismissal/override applied. Scoped installed caller findings are in progress doc;
they are not whole-program security acceptance. Review compatible remediation.

## Final cutoff checkpoint

Cutoff observed at 10% five-hour remaining /30% weekly. All package agents are
finished; no new work/tests or 011 dispatch occurred afterward. No test/build
process remains from the package agent.

Package 010 final checkpoint: `f2d82bafc4e054c3cb00faa9993ac9741e440d1e`, clean.
Handoff: `/private/tmp/everlast-pre-v4-010-complete-handoff-20261110.md`.
T062 optional parent IaC and T063 collector are locally complete; T064 production
producer integration and T052 live acceptance remain OPEN. The package handoff
records exact validation, capture points and operational limits, including private
output-directory handling. Read it before implementing the producer.

Parent fast-forwarded the package, then merged approved origin/main1957b3a without
content conflicts at `b1c9df7e52d85b02463c3d3cfb8ebf9076bc7649`. The final docs-only commit
on codex/pre-v4-resume-20261110 records this handoff, progress and candidate index;
inspect that branch HEAD for the documentation SHA.

Next package is 011 in a new worktree from the final continuation branch, with
CC-09 refresh before implementation. Goal remains active and incomplete. Recheck
usage and user continuation before resuming; never use reset credits. Other local
package changes remain unmerged: publish separately scoped package PRs and obtain
required final merge authorization. User approval here was specifically PR174,
not arbitrary main mutations, cloud deployment or paid runs.
