# Pre-V4 resumed continuation

Traceability: CC-01..CC-09, C-01/C-02/C-03, NFR-PERF-01, NFR-EVAL-01..04, Gate v3.0.

This record supplements the [previous complete handoff](pre-v4-implementation-handoff-2026-11-10b.md)
and [candidate index](pre-v4-implementation-candidate.json). The goal is incomplete;
V4 implementation remains blocked. Temporary private handoffs from the previous
run are gone. Use tracked artifacts and Git commits, not those temporary paths.

## Refreshed state

- New coordinator worktree `/private/tmp/everlast-pre-v4-resume-20261110c`, branch
  `codex/pre-v4-resume-20261110c`, created first from clean `9d70a39`.
- Main refreshed over HTTPS at `3f4d7fdcf25f3e535c51f1696c5aa880a0f85e86`, unchanged.
  SSH fetch failed with `Permission denied (publickey)`; HTTPS fetch succeeded
  without changing remote configuration. Root checkout remains untouched.
- Passing application integration remains `e71645fbd4822b93c096a5c2c64a5f2dee9ebddf`;
  Package012 recovery `57fcfdcb67f988665d2490a3f911a8ff7bb009ea` is preserved.
- Isolated RED predecessor `509067dc999ba52918f01ef37421e57cce77216d` contains the
  always-false operational scaffold, requirement flow-back and a meaningful test:
  valid plan expects true/eight calls, scaffold returns false/zero calls. It was
  not merged into the passing coordinator. Original test was1failed/6passed;
  later negative assertions were written but not reached.
- Prior merged PRs174 and188 remain merged; no new GitHub mutation this run.

## Active work and usage policy

The same `/root/package_012` agent resumes sequentially, with no other package
agent active. Assigned worktree `/private/tmp/everlast-pre-v4-012-qualification-20261110c`,
branch `codex/pre-v4-012-qualification-20261110c`, starts from RED509067d. It created
the worktree first and immediately pinned `specs/012-long-context-latency-scaling`
using temporary `SPECIFY_FEATURE_DIRECTORY`, then unset it. Current instructions,
Constitution IV/CC09, guardrail procedure, card/README, artifacts and skills/hooks
were loaded before implementation. Exact185 approved migration records remain
the baseline; no new or widened exceptions are allowed.

The five-hour limit reset; initial remaining usage was99%five-hour/13%weekly.
Latest observation before this record:95%five-hour/12%weekly. The weekly window
is limiting. At<=10% in EITHER window, stop starting implementation/tests/checks,
let already-running checks finish and save clean checkpoint/handoff. Never use
reset credits. This reactivation starts a fresh blocked audit; earlier blocked
turns do not count toward this resumed run.

Immediate scope is meaningful Red-to-Green for bounded signed operational probe
orchestration. Signature authorizes exact bounded operations; it never attests
actual provider/runtime/deployment behavior. Validate candidate/boot/runtime/
calibration/actor/scope/expiry/replay before effects, consume IDs before calls,
invalidate old readiness on failure/staleness, and reject late success. Default
startup must remain unqualified until actual trusted observations.

Production private refresh/server wiring and canonical managed-lifecycle proof
adapter are separate missing work. A core-only Green is not operational completion.
Runtime proof must use actual same-boot canonical execution/cleanup evidence;
never add another raw managed create/delete path bypassing scope, cancellation,
publication or orphan cleanup. No paid/provider/cloud/GitHub operations are allowed
in this local implementation; tests use injected local doubles only.

Save the next agent handoff BOTH tracked in the012 feature and in
`/private/tmp/everlast-pre-v4-012-qualification-handoff-20261110c.md`. Do not merge
an unfinished/unverified/failing checkpoint into the passing coordinator. Record
all remaining code explicitly.003GC-E04 remains queued until012 finishes.

## Retained acceptance obligations

See the previous handoff for exact earlier package checkpoints and permissions.
Operational012T053/T064,010T052/T064,011T061,012T046–T048/T060 and all matching live
acceptance remain open. Historical viewer P95 `16.734000000000037ms` and corrected
`16.733999999999924ms` remain FAIL against16ms. Report504/75%validity stays a failure.
Local model/tokenizer/cache doubles and signed authorization do not qualify live
readiness. No schema, denominator, threshold or metric weakening is authorized.

Still required:003refusal browser coverage;001real disposable identity/storage/
signup policy proof;008report reliability;009audio/timestamp/provider fixtures;
qualified managed sandbox/security/cohorts; qualified generation/context/latency;
one common fixed stratified50-case judged run on the immutable candidate; separate
package PRs/CI/explicit merge approval and acceptance-based roadmap reconciliation.
Gatev2 owner override remains an override; Gatev3 is not accepted.

No new cloud observations are made here. The previous stopped SQL/old-image
observation must be refreshed before actual deployment planning. Prepare exact
images/resource plans/fixtures/workload and obtain applicable approval before
cloud apply, deployment or paid calls. Existing four-API approval is not general
cloud/workload authorization. All original preservation requirements remain.
