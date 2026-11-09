# Pre-V4 continuation — 2026-11-09

Traceability: CC-01, CC-06, CC-09, Gate v3.0, NFR-EVAL-01..04.

The user authorized refreshing main and completing all pre-V4 implementation,
release gates and tests before V4 work begins. The goal remains active.

## Refreshed baseline

Worktree: `/private/tmp/everlast-pre-v4-resume-20261109`.
Branch: `codex/pre-v4-resume-20261109`.

Fetched origin/main at `5f44947` and merged it with preserved checkpoint `a937b9e`
at `abe17ff`. The root/main checkout was not modified. Main adds dependency and
provider updates plus Constitution 2.1 / CC-09 architecture guardrails.

Main's canonical D21 is architecture enforcement. The provisional unmerged signup
label D21 was explicitly superseded under D22; DEV-06, current signup comments
and quickstart reference D22. Historical evidence remains historical. The signup
policy did not change.

## New prerequisite before package recovery

The architecture scan against origin/main reported 15 findings in inherited local
changes. The artifact scan reported 16 missing CC-09 fields across 001, 006, 008
and 009. No approved exception inventory was widened. Reconciliation proceeds
sequentially under the existing package agents:

001 public interfaces/authentication → 006 boundary evidence → 008 test fixture
and boundary evidence → 009 infrastructure recovery → 010 → 011 → 012 → final
deployment and immutable candidate qualification.

Each agent must read refreshed AGENTS.md, Constitution IV / CC-09 and
`docs/agent-architecture-guardrails.md`, receive its feature path and allowed files,
and create a new worktree from its predecessor's completed checkpoint.

## Verified package checkpoints

| Package | Checkpoint | Evidence and remaining obligations |
| --- | --- | --- |
| 001 | `935eabe` | Explicit db/testing and six testkit exports; same pinned Firebase URLs now literal. 39 architecture fixtures, 31 targeted tests, two provider tests, typecheck/build, spec integrity and deterministic citation160/160/leakage0 pass. Two live tests remain skipped; signup apply and disposable-fixture acceptance stay open. |
| 006 | `3d02a51` | Boundary inventory, task traces and analysis refreshed; 66 focused tests, typecheck, spec and diff checks pass. Actual diff is docs/evidence only; unchanged checker/build/deterministic evidence is reused with rationale. |
| 008 | `fb75e72` | API-owned suggestion fixture replaces the worker import. Same 51 focused tests pass before/after; typecheck/spec/diff and scoped artifacts pass. No production changes. |
| 009 | `62b2974` | Ingestion/Model Armor wiring recovered default-off; five provider locks consistently select 8.10.0. Seven mock runs, affected module validation/policy tests, 33 focused tests, lint/type/spec/deterministic/CC-09 checks pass. Render image build and network-disabled smoke pass. T049/T050 remain open. |

The parent independently confirmed all 186 retained architecture exception records
exactly match main: zero new or edited records, 107 removals corresponding to actual
interface repairs (two computed loads, two wildcards, 103 public-entrypoint records).
After 009: the graph and changed-feature artifact checks have zero findings, with
the same 186 approved records. This does not retrospectively certify untouched
historical features. Package 010 recovery continued from `62b2974` and stopped at the usage cutoff.

Handoffs:
`/private/tmp/everlast-pre-v4-001-cc09-handoff-20261109.md` and
`/private/tmp/everlast-pre-v4-006-cc09-handoff-20261109.md` and
`/private/tmp/everlast-pre-v4-008-cc09-handoff-20261109.md`.

## External state

Gate v3 issue #86 remains open with acceptance unchecked. PR #174 remains open;
the connector reports it not mergeable, so recheck and repair publication before
attempting a merge. No GitHub state was changed in this continuation.

Read-only cloud inventory on 2026-11-09 found API revision
`everlast-dev-api-00013-kzh` and worker revision `everlast-dev-worker-00009-5m2`
still using image `51f78ab`. API environment names lack V3 sandbox/benchmark
configuration. PostgreSQL 16 is STOPPED with activationPolicy NEVER. Cloud Run
control-plane readiness does not establish application readiness. Deployed OCR
configuration names are present; the older local judged CLI lacked OCR settings.

No cloud resources or model calls changed in this refresh. gcloud needed its normal
credentials/log database outside the workspace; the approved read-only inspection
succeeded. Do not run tests against cloud SQL or infer paid-run authorization.

The inherited provider constraint intersection now requires 8.10. Package 009
reproduced rejection of the old 6.50 locks and regenerated all five tracked locks
consistently to 8.10.0 without importing older recovered constraints.

## Recovery source revalidation

Old temporary recovery directories no longer contain their .git links. Seven 012
source/test files are absent from the loose directory. Existing snapshot members
have no content drift. All private recovery archive members were revalidated
against their saved SHA256 hashes and include every missing file.

Recover into a NEW 012 worktree using preserved base `0e00bf8` and the verified
archive. Apply tracked changes by a reviewed three-way patch; do not overwrite
modern manifests, locks, shared specs or earlier package fixes with old snapshots.
Copy recovered untracked source files selectively. Do not restore/edit originals.

Missing loose files retained in the archive:

- `apps/api/test/v3-context-local.ts`
- `apps/worker/src/studio/context-session.ts`
- `apps/worker/src/studio/context-vertex.ts`
- `apps/worker/test/studio-context-session.test.ts`
- `apps/worker/test/studio-context-vertex.test.ts`
- `packages/evals/src/v3-scale-import.ts`
- `packages/evals/test/v3-scale-runner.test.ts`

## Usage stop rule

Initial remaining usage was 99% five-hour / 59% weekly. Check regularly. At 10%
or less remaining in any relevant available window, stop new work, safely
checkpoint active agents and prepare a handoff. Do not use reset credits.

## Package 009 image evidence and live limits

Local tag `everlast-pre-v4-render-009:20261109`, manifest-list digest
`sha256:53e67574d1995b3c6fd60c6a420f79995fbf5661016480d9c979b45c79d8a082`.
This is a native local smoke artifact, not a declared Cloud Run deployment image.
Final deployment must build for its target platform and freeze fresh digests.

Node 26 lacks Corepack (actual Red exit127); the render Dockerfile now installs
pinned pnpm12 using npm. Later 012 must retain this repair and separately align
the main API/worker image from Node24 to Node26. No model/pipeline change here.

Live T049/T050 still require the authorized audio cohort, integrated timestamp
navigation and common fixed 50-case judged release report on the final candidate.
Offline mock plans are not saved cloud plans. Resource deployment/paid runs remain
unexecuted and require a concrete reviewable plan under existing approval scope.

Further work includes 010, 011 numeric export #153, recovered 012, restored 003
GC-E04 refusal browser coverage, retained 001 live/signup acceptance, 008 report
reliability/live acceptance, final candidate qualification and roadmap reconciliation.
Use one package agent at a time; do not start V4 implementation before Gate v3 passes.

## Final usage cutoff and partial 010 checkpoint

Cutoff observed at 9% five-hour remaining /45% weekly. All agents are finished;
no new implementation or tests started after the cutoff. Package 010 stopped clean
at `a922c6382fb8034a43668f7a428a439ac2380dda`. Its strict evaluator/CLI recovery passes 14 tests after
seven actual Red failures, typecheck/lint/spec/diff, architecture graph and artifacts.
Optional parent infrastructure T062, real collector T063 and live T052 remain open.
Resume 010 before 011; the user goal is not complete.

Overall handoff: `docs/pre-v4-implementation-handoff-2026-11-09.md`, also copied to
`/private/tmp/everlast-pre-v4-implementation-handoff-2026-11-09.md`.
