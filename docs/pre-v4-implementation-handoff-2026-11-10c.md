# Pre-V4 cutoff handoff — resumed run

Traceability: CC-01..CC-09, C-01/C-02/C-03, NFR-PERF-01, NFR-EVAL-01..04, Gate v3.0.

Stopped at the corrected user cutoff: **30% five-hour /2% weekly remaining**.
Five-hour cutoff remains10%; weekly cutoff is2%, superseding historical10% notes.
No new implementation/tests/checks started after cutoff. Already-running checks
finished; only safe checkpoint integration and handoff records followed. No reset
credits were used. This is the first cutoff observation in this reactivated run.
The goal is incomplete; V4 implementation remains blocked.

## Exact continuation

- Coordinator: `/private/tmp/everlast-pre-v4-resume-20261110c`, branch
  `codex/pre-v4-resume-20261110c`, created first from9d70a39. Root checkout untouched.
- Main refreshed successfully through HTTPS at
  `3f4d7fdcf25f3e535c51f1696c5aa880a0f85e86`, unchanged. SSH failed with
  Permission denied(publickey); HTTPS fetch worked without remote reconfiguration.
- Previous passing application e71645f and recovery57fcfdc remain preserved.
  RED509067d was resolved by tested CODE
  `01383115e522090550518e31b7b367a09e7ed97b`, handoff-only successor
  `e6642640b7faf18c416becf5e48dc79448aadfa6`. These are integrated into this
  coordinator at `ce3cd955c970d9d09dc504a0aedb4c33695e0fe1`. Later coordinator
  commits only update handoff records; source/runtime bytes are unchanged.
- Same agent `/root/package_012` worked sequentially in
  `/private/tmp/everlast-pre-v4-012-qualification-20261110c`, branch
  `codex/pre-v4-012-qualification-20261110c`, from RED509067d. It created the
  worktree first and immediately pinned specs/012-long-context-latency-scaling
  through temporary SPECIFY_FEATURE_DIRECTORY, then unset it. Current AGENTS,
  Constitution IV/CC09, procedure, card+README, artifacts and skills/hooks loaded.
- No package agent or launched test/server/build process remains active. Shared
  disposable PostgreSQL54329/Docker remain available. No new package was started.
- Temporary private handoffs from the previous run vanished. Use Git commits,
  [tracked qualification handoff](../specs/012-long-context-latency-scaling/qualification-handoff-20261110c.md)
  and committed evidence; do not depend on temporary files surviving.

## Implemented locally

Bounded Ed25519 operational qualification now has actual server wiring. Independent
pinned trust root authorizes exact boot/revision/candidate/runtime/fixture/clock/
source-tree/operational-config/provider-budget effects; it does not attest actual
provider behavior by itself. Exact isolated Owner/revision actors, expiry, replay,
consume-before-effects, timeout lock, late-result rejection and close invalidation
are tested. Default startup remains unqualified without actual observations.

API-owned model/cache adapters read original data through explicit C-02 capture,
get, verify and streamOriginals; no new worker implementation use. Source measurement
and adapter wiring remain in server composition.185 exact approved migration records
remain unchanged; no new cross-app/test/type dependency or export path.

Managed runtime proof uses the existing canonical controller and durable ledger,
actual validated profile response, current boot/candidate/runtime/source revisions,
Succeeded published trace, matching attempts and confirmed Destroyed cleanup.
Approved ordinary warmup can provide this observation without retroactively becoming
qualified. Metadata is gated to approved notebooks and piggybacks an existing
required progress write; default-disabled instrumentation adds no SQL/failure path.
No alternate raw sandbox creation or lifecycle bypass was introduced.

Actual startApiServer tests use private in-process provider doubles, without an
extra.benchmark bypass: disabled or missing authorization causes zero probes;
approved warmups traverse the existing controller; signed approval reaches the
C-02/model/cache chain; readiness follows real adapter observations; close invalidates.

Signed provider budget counts actual effects:2embedding RPCs,2model RPCs with512
output tokens/100000request bytes,2cache count/create/delete operations, TTL60,
32MBoriginal/40MBserialized limits and actual countTokens+18kreserve<=1048576,
zero managed creates. Private attempts1; ordinary defaults unchanged. Optional
signed sameOwner/notebook cache_sources supports explicit diagnostic cache fixtures.
Setup deadline<=240s/lifetime<=15min is separate from unchanged2.5s/15s cohort limits.
Actual provider minimums/latency/capacity are still unmeasured and cannot pass.

## Evidence actually observed

Feature evidence: specs/012-long-context-latency-scaling/evidence/qualification-20261110c/.

- Original meaningful Red1failed/6passed resolved; additional Red/Green covers
  abort-ignoring timeout lock, canonical DB proof, disabled profile instrumentation,
  model512token/singleRPC and embedding5attempts to private1attempt behavior.
- Latest focused units45tests/3files PASS; PostgreSQL regressions28tests/3files PASS;
  expanded actual-server file12tests PASS. Counts overlap and must not be summed.
- Types/lint PASS, including39architecture fixtures, graph0findings/185 unchanged,
  changed-feature artifacts0 versus origin/main. Manual boundary findings resolved.
- Fresh deterministic PASS: citation160/160, leakage0,60invalid drafts/0published;
  report/structure checks use labelled local doubles. No judged/provider run or
  redundant full505unit repetition. Staged integrity208Markdown/55SRS/39features
  and whitespace passed before cutoff. No new check suite followed cutoff.
- Historical viewer P95=16.734000000000037ms and corrected16.733999999999924ms
  remain FAIL against16ms, without rounding/population/metric substitution.
  Historical report504/75%validity and live Gatev3 failures remain unresolved.

## Next missing implementation

**012T068 is missing CODE/configuration:** target CloudRun has no implemented secure
challenge retrieval, authorization inbox or private evidence export bridge. Container
files do not automatically reach the operator host. The tested private-file mechanism
is local; do not claim full CloudRun operational completion. T053/T064/T066 remain
partial for target deployment, plus T060 and matching010/011live obligations.

In a permitted usage window, reuse the SAME012agent in a NEW dedicated worktree
from the current integrated checkpoint, immediately pin012, load instructions,
current T068/spec/plan/card/README and rerun analysis before implementation. Evaluate
existing keyless ObjectStorage for private candidate/boot prefixes, bounded
signed/generation-bound inbox and allowlisted evidence export, separately pinned
trust root and0600operator downloads. This is a design option, not implemented or
cloud-authorized. Preserve C-02/private trace/durable cleanup and no public debug
endpoint or new raw managed-create path. Capture actual RPC budgets/expiry/cleanup
and tests before implementation; do not weaken scope to obtain a convenient pass.

003GC-E04 apps/web/test/chat.spec.ts:86 remains test.fixme and queued. After012,
restore refusal/no-badge/explicit-selection browser coverage in its own sequential
package worktree. Existing003 checklists had no unchecked items at earlier inspection.
README pre-V4 architecture work also remains:185 exact records,97 assigned004T035,
88 assigned004T036. A separate004 coordination agent must map edges to owning
packages, then resume those package workflows sequentially. Guardrails do not waive
extraction; do not lump all packages into004 or create/widen exceptions.

See the [previous complete handoff](pre-v4-implementation-handoff-2026-11-10b.md),
[implementation plan](pre-v4-implementation-plan.md) and
[candidate index](pre-v4-implementation-candidate.json) for exact earlier package
checkpoints and all retained obligations:001identity/storage/signup proof,
008report reliability,009audio/timestamp/adapter prerequisites,010managed security
and cohorts,011generation/viewer acceptance,012context/latency and the single common
fixed stratified50-case judged release run. Gatev2 owner override stays an override;
Gatev3 acceptance/issue closure cannot follow merely from local checks or merges.

## Cloud and publication boundary

Fresh read-only gcloud checks confirmed API everlast-dev-api-00013-kzh still uses
image everlast:51f78ab; SQL everlast-dev-pg POSTGRES16 is STOPPED/activationNEVER.
Worker/API-registration observations were not refreshed this run. Recheck all needed
resources before deployment planning. No cloud create/apply/deploy/API enablement,
paid model/cache/sandbox/audio, GitHub mutation or external message occurred this run.
PRs174/188 remain previously merged; fixes remain local and need separate package
PRs/CI/explicit final merge approval. SSH push authentication remains unverified;
GitHub connector Git-data tools are available if HTTPS/SSH writing is unavailable.

Before actual deployment/paid calls, prepare immutable target images, exact saved
resource/configuration plan, private fixtures, canonical warmup/probe workload and
rollback; obtain applicable owner approval. Four-API approval is not general
resource/workload authorization. Keep credentials in private/keyless flows. Never
use reset credits. No new tests/checks are authorized while the cutoff persists.
