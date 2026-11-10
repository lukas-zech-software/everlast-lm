# Pre-V4 continuation — 2026-11-10, second worktree

Traceability: CC-01..CC-09, C-01/C-02/C-03, NFR-EVAL-01..04, NFR-PERF-01, Gate v3.0.

Stopped at the user usage cutoff: 9% five-hour /14% weekly remaining was observed.
No new implementation or checks were started after cutoff; already-running checks
finished and clean handoffs were saved. Reset credits were not used. This is the
first cutoff observation in the current resumed goal run; do not mark the goal
complete. The later PR #188 approval authorizes that merge, not implementation
resumption or a change to the cutoff. This is not release acceptance. The goal is still
incomplete and V4 implementation remains blocked. See the [implementation plan](pre-v4-implementation-plan.md),
[candidate index](pre-v4-implementation-candidate.json) and
[previous handoff](pre-v4-implementation-handoff-2026-11-10.md) for earlier package evidence.

## Exact state

- Coordinator worktree `/private/tmp/everlast-pre-v4-resume-20261110b`, branch
  `codex/pre-v4-resume-20261110b`; integrated application checkpoint
  `e71645fbd4822b93c096a5c2c64a5f2dee9ebddf`. Later coordinator commits only update records.
- Root `/Users/luke/Projects/claude/everlast/everlast-lm` remains untouched.
  All new repository tasks begin by creating another dedicated worktree; never
  edit root/main. Pin the target feature immediately through temporary
  `SPECIFY_FEATURE_DIRECTORY`, write `.specify/feature.json`, then unset.
- Latest fetched main is `3f4d7fdcf25f3e535c51f1696c5aa880a0f85e86`, the approved
  PR #188 documentation merge; it is also merged into coordinator. Application
  code remains the passing `e71645f` tree. Recheck main before final candidate freeze.
- Exactly one package subagent may be active. Reuse the existing package agent
  when resuming. Dependent packages branch from the previous integrated checkpoint.
- Cutoff observation: 9% five-hour /14% weekly remaining. This is a snapshot,
  not permission to assume availability later. Recheck usage at every major phase;
  at <=10% in either window stop starting implementation/tests, let running checks
  finish, save a clean checkpoint and update this handoff. Never use reset credits.

## Published changes and approval

- PR #174 merged with explicit user authorization; merge
  `1957b3aa99c8c7faeb085b7e48fb6f369ea49f1f`. A duplicate approval reply does not require another merge.
  Roadmap acceptance and unresolved failures remain preserved; no Gate v3 pass.
- [PR #188](https://github.com/lukas-zech-software/everlast-lm/pull/188), head
  `2c54da370fad8abba7ba6bc133532c75927bbcd0`, corrected only README/journal unsupported
  release-complete claims. After separate explicit user approval, head and green CI/
  spec results were revalidated and the PR was squash-merged at
  `3f4d7fdcf25f3e535c51f1696c5aa880a0f85e86`. No bypass or unrelated authorization.
- Package fixes are local checkpoints. Publish separate package PRs, preserving
  one package per feature branch/diff and required CI. A coordinator branch is
  an integration/recovery record, not a combined feature PR.

## Completed local work in this continuation

### Package 011

Commit `d5697e8b30812e7280a11b7c52954564f88177a5` on
`codex/pre-v4-011-20261110`, worktree `/private/tmp/everlast-pre-v4-011-20261110`;
integrated at `3326d8d`. Exact handoff:
`/private/tmp/everlast-pre-v4-011-handoff-20261110.md`.

Implemented owner-approved numeric CSV/XLSX exports with separate citation fields,
row/header/conflict provenance, strict precision/identity/formula protections,
literal OOXML control handling and canonical payload preservation. Selectively
recovered drag/collectors; rendered-node assertions exposed the old root-toggle
defect, now corrected with a predeclared branch-selection policy.

Focused units, 10 real PostgreSQL tests, four actual Chromium journeys,
independent CSV/OOXML inspection, lint/types/spec and architecture checks passed.
Canonical minimum two logical columns makes citation footer width valid.
No actual provider cohort or judged release run was executed.

T061 stays open. Historical P95 `16.734000000000037ms` and corrected actual
P95 `16.733999999999924ms` are both FAIL against 16ms. Entire failed frame
populations are preserved in the feature evidence directory. Do not round,
widen thresholds, substitute CPU timing or change the population post hoc.

### Package 012 recovery

Commit `57fcfdcb67f988665d2490a3f911a8ff7bb009ea` on
`codex/pre-v4-012-20261110`, worktree `/private/tmp/everlast-pre-v4-012-20261110`;
integrated at `e71645f`. Exact handoff:
`/private/tmp/everlast-pre-v4-012-handoff-20261110.md`.

Verified original base `0e00bf88bb73a92163c57887a5d77f666b7648ac` patch and all
55 archive-member hashes in `/private/tmp/everlast-pre-v4-recovery-20261107-implementation/`.
Used selective three-way recovery; did not overwrite modern manifests, locks,
contracts or predecessor fixes. Seven missing loose files were retained in the
archive. Original directories and archives remain intact.

Recovered bounded original-evidence streaming, finite/rechecked provider cache,
bounded recursive report reduction, exact scope/revision-bound scale imports,
real paired ordinary HTTP collection and Node26 Docker runtime. Historical
report504 remains a failure; timeouts were not blindly increased. T046–T048
historical acceptance checkmarks were reopened.

Actual checks: 505 unit tests, 21 real PostgreSQL regressions, four stream/report
regressions, citation160/160/leakage0/60 adversarial invalid drafts with0published,
lint/types/spec, 39 architecture fixtures and graph/artifacts0 findings with185
exact unchanged exceptions. No new cross-app/test/type/shared-to-app dependency.
Actual ordinary API stress covers999999/1000000/1000001 original whitespace-token
boundaries,40Guides,300-source admission, cache/restart/revocation. Sixty ordinary
HTTP attempts include ten pairs/two distinct authenticated Owners with measured
peak model concurrency2. All use labelled local doubles and report releaseUNAVAILABLE.

Node24.22.2 engine Red was observed. Node26.13.0 local `linux/arm64` image
`sha256:56b30d24965ae2c249eb7dba25f143133812c580e90da4011b4906bcd370e11b`
passed network-disabled API/worker native TypeScript imports. This is a local
code-build identity, not a final target-platform/deployed release attestation.

## Unfinished Package 012 operational qualification — do not merge

Same agent `/root/package_012` resumed after the clean recovery integration.
Assigned new worktree `/private/tmp/everlast-pre-v4-012-qualification-20261110`,
branch `codex/pre-v4-012-qualification-20261110`, base exact `e71645f`.
Pin `specs/012-long-context-latency-scaling`. The agent has now finished its safe
cutoff checkpoint; no package agent or test/build/browser command remains active.
Shared disposable PostgreSQL remains available.

Partial RED commit `509067dc999ba52918f01ef37421e57cce77216d` is clean on that
branch and MUST NOT be merged into the passing coordinator. It adds only typed
operational ports, a disabled always-false scaffold and upstream design/T065–T067.
Activation, signature/schema validation, exact bindings, replay/expiry handling,
bounded orchestration, real server adapters and refresh are still unimplemented.
The meaningful test is 1 failed/6 passed: valid plan expects true and eight port
calls; scaffold returns false and zero calls. Later negative assertions were
written but not reached; they are not executed evidence. Already-started lint/
types/spec/39 architecture fixtures, graph0/185 unchanged and artifacts0 finished
PASS. No further tests or implementation started after cutoff.

Signature authorizes exact bounded operations only; it cannot attest actual
provider/runtime behavior by itself. Runtime proof must use authoritative same-boot
canonical execution/cleanup evidence. Do not create a second raw managed create/
delete path bypassing durable lifecycle, cancellation or orphan cleanup.

The recovery added real lifecycle capture and private atomic0600 scoped files.
`sandbox_created_at` is immediately BEFORE runtime.create (RPC/queue/boot/poll
included); `execution_completed_at` is runtime.execute settlement before cleanup;
`running_code_at` is actual controller emission. Canonical terminal trace is read
from durable storage after publication/abandon; a real source-replacement Red
exposed provisional chart artifacts that abandon had cleared. Missing/deleted/
active/failed-read terminal state withholds proof while HTTP attempts stay retained.

**Remaining code:** T053 is partial and new012T064 records missing operational
trusted model/retrieval/cache qualification. Startup currently only probes SQL,
migrations/recovery, so deployment/workload alone cannot activate beginExecution.
Mounted hashes/profile literals/COMMIT_SHA/K_REVISION bind declared metadata;
they do not prove actual immutable deployment/provider behavior. Private test
probe doubles prove mechanics only.

The same agent must flow requirements/design upstream, analyze, add meaningful
Red tests and implement a bounded trusted operational path. Real potentially
paid probe calls require an exact approved plan/fixtures/workload; implement/test
with doubles only now. Default startup stays unqualified until actual trusted
observations. No public bypass, fabricated readiness, constructed-client proof,
source contents or raw provider handles in ordinary reports. Live qualification,
012T060,010T052/T064 and011T061 remain separate unfinished acceptance obligations.

Exact partial-agent handoff:
`/private/tmp/everlast-pre-v4-012-qualification-handoff-20261110.md`.
Read it before continuation. In a permitted usage window, reuse the same012 agent
and explicitly choose the RED509067d lineage in a NEW worktree; never accidentally
replace the passing coordinator with it. Bring newer documentation ancestry forward
separately as needed. Finish/analyze/TDD the missing operational code and applicable
checks before integrating it or starting the next package. The prepared003 brief
remains queued and was not dispatched.

## Remaining work after operational code

- 003GC-E04 `apps/web/test/chat.spec.ts:86` remains `test.fixme`. Its separate
  sequential agent should restore real local browser/API/PG refusal/zero-badge/
  explicit-source-selection coverage. Existing003 checklists had no unchecked
  items at this inspection. Prepared brief `/private/tmp/everlast-pre-v4-003-dispatch-20261110.md`;
  do not weaken assertions or hardcode a question-specific fixture answer.
- 001T046/T061: actual disposable identity/storage revocation/purge/signup policy
  proof and resumable applicability remain pending. Signup policy was not applied.
  Signed PUT expiry is not arbitrary admin-created resumable-session cancellation.
- 008T076: historical report504/75%validity and common judged acceptance remain
  unresolved. Preserve trusted006Guide fixes,008admission/primary-language/startup/
  config and allocated migration0012 throughout further integration.
- 009T049/T050: approved30-minute audio fixture with>=20attempts/timestamp
  navigation and adapter prerequisites; no600-minute paid campaign was run.
  Preserve provider8.10 locks, default-off ModelArmor and render npm bootstrap.
- 010T052/T064: actual qualified managed sandbox/security/four>=20cohorts and
  matching trusted evidence. Timing/config hashes do not replace provider proof.
- 011T061 and012T046–T048/T060: qualified real generation/frame/context/performance
  and integrated acceptance, plus the single common fixed stratified50-case
  judged release run retaining IDs/categories/dataset hash/errors/denominators.
- Preserve Gatev2 owner override as override; Gatev3#86 and known failures stay
  open. Do not close issues from local checks or merged implementation alone.
  D5/DEV03 and futurev4–v6 items remain intentionally deferred/open. Legacy
  R1/R2/R3 migration debt and004T035/T036 are not waived or certified by this work.

## Cloud and authorization boundary

[Fresh read-only observation](pre-v4-cloud-observation-20261110.json): project
`lukas-gcloud-playground`, region `europe-west4`. API `everlast-dev-api-00013-kzh`
and worker `everlast-dev-worker-00009-5m2` still image `everlast:51f78ab`; SQL
`everlast-dev-pg` PostgreSQL16 is STOPPED/activationNEVER. Ready revision metadata
does not establish dependency readiness. Previously approved Drive/ModelArmor/
Speech/YouTube API registrations are all enabled. No new cloud mutation occurred.

No general cloud/apply/deploy/paid benchmark permission exists. Before requesting
approval, prepare the exact saved resource/configuration plan, final immutable
target-platform images, schema/migration inventory, activation/rollback window,
private disposable fixture IDs and bounded workload. Existing EU DocumentAI
processor is projects/865450204790/locations/eu/processors/7e8fb3b073398d36; verify
before use, do not create a duplicate to remedy a missing environment value.
Drive OAuth/Picker/SecretManager/upstream fixtures remain inputs. Keep credentials
in existing private/keyless/SecretManager flows; never request them in chat.

No reset credit, paid model/sandbox/audio run, resource creation, deployment or
identity-policy apply was used. Shared local disposable PostgreSQL54329 remains
available. Each agent must report any remaining test/build process at checkpoint.

Final handoff-only edits and the approved two-file PR #188 ancestry merge were
saved after cutoff; no new test/check suite was launched. Before cutoff, staged
coordinator integrity covered208Markdown/55SRS/39features and artifacts had0findings.
