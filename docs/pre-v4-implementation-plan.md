# Pre-V4 implementation and acceptance plan

Prepared 2026-11-07 (Europe/Berlin). Traceability: Gate v1.0/v2.0/v3.0,
NFR-EVAL-01..04, NFR-PERF-01, C-01/C-02/C-03, CC-01..CC-09.

Execution update (2026-11-10): PR #174 is merged at `1957b3a`; refreshed main
is `c7f9b5f`. Local package checkpoints through 011 are integrated into coordinator
`3326d8d`; 012 starts from that ancestry in its own worktree. Numeric exports are
verified locally. Corrected viewer P95 `16.733999999999924ms > 16ms` remains FAIL;
historical `16.734000000000037ms` is preserved. These checkpoints do not establish
release acceptance. See the [candidate record](pre-v4-implementation-candidate.json)
and [continuation handoff](pre-v4-implementation-handoff-2026-11-10.md) for retained
obligations; recheck current usage and agent state before resuming. The inspected
baseline below is historical, rather than a statement that PR #174 remains open.

## Outcome and scope — Gate v3.0, CC-06

Complete the retained v1–v3 implementation and acceptance obligations, integrate the
preserved work, and produce evidence for an immutable release candidate. V4
implementation stays blocked until Gate v3.0 passes. This document is a release
coordination plan; each package retains its own spec, plan, tasks, branch and PR.
Preparing this plan does not execute implementation, deployment or paid evaluations.

The governing sources are the [constitution](../.specify/memory/constitution.md),
[SRS §5](../spec/System_Requirements_Specification_Gemeni_Notebook.md),
[requirements and prerequisites](../spec/requirements/README.md), and
[architecture decisions](solution-architecture.md). Start from the existing
[readiness audit](pre-v4-readiness.md). The detailed recovered runbook remains the
execution reference; this plan adds reconciliation, integration order and completion
criteria rather than replacing its measurement procedures.

## Inspected baseline — CC-01, CC-06

| Item | Verified state on 2026-11-07 | Planning consequence |
| --- | --- | --- |
| Requested branch | `codex/pre-v4-finalization` at `7216179f3c416a5c17fb773a93e59d842c4e833b`, incorporates main `8835c5c` | Four changed files: audit, roadmap synchronizer/tests and CI. No recovered application fixes are included. |
| [PR #174](https://github.com/lukas-zech-software/everlast-lm/pull/174) | Open, mergeable; CI run 42373387917 and spec-integrity run 42373387916 completed successfully for that head | Handoff's “CI running” observation is superseded. Green CI does not establish Gate v3 acceptance. |
| Package 006 | Clean at `4fd99c08d275866badcf853e4f7c7ccfc68cce2a` | Integrate the completed checkpoint; do not repeat prompt repair from an older audit row. |
| Recovered coordinator | `0e00bf8`, dirty candidate/runbook/lockfile and untracked cloud/execution records | Preserve all records and distinguish incidental lockfile churn from dependency changes. |
| Package 012 | `0e00bf8`, 46 modified tracked files and nine untracked files | Preserve and review the existing patch before implementing anything new. Open T051–T060 markers do not mean no code exists. |
| Release evidence | Historical/local results, failed live report and pending cloud qualification in the handoff | No newly measured release pass is asserted by this planning review. |

Local recovery references (temporary storage; archive them before cleanup):

- `/private/tmp/everlast-pre-v4-open-work-2026-11-07.md` and companion
  `/private/tmp/everlast-pre-v4-handoff-2026-11-07.md`.
- `/private/tmp/everlast-lm-pre-v4-execution-20261105/docs/pre-v4-completion-plan.md`
  including its uncommitted owner decisions; adjacent execution record, candidate
  manifest, API plan and cloud prerequisites.
- `/private/tmp/pre-v4-package-3-4-brief.md` and
  `/private/tmp/everlast-lm-pre-v4-package-3-4-20261105/docs/gate-v3-live-evaluation.md`.
- Package 006's committed `specs/006-source-guide-chat-control/evidence/pre-v4-20261107/`
  on `codex/pre-v4-006`; its final validation section and saved handoff.

The inventory's 16 open task markers are a starting list. Non-marker defects,
missing runtime proof and reviewer-owned checklists remain separate obligations.

## Execution model and dependency order — CC-01/02/06, C-01..03

Use this sequence:

`preserve → integrate 006 → 001 → 008 → 009 → 010 → 011 → 012 → deploy/qualify → accept/sync`

This moves the known identity, report and admission prerequisites ahead of expensive
release measurements. Inspect and preserve 012 immediately; its integration and
qualification stay last because it consumes the combined system. Existing v1/v2
gate acceptance remains in force, including the recorded v2 owner override.

For implementation continuation, use exactly one subagent per package, sequentially,
with only one package subagent active at a time. The coordinator owns the shared-file
merge order and release manifest. Each agent first creates a dedicated worktree from
the preceding completed package checkpoint. Pass the target feature using temporary
`SPECIFY_FEATURE_DIRECTORY`, write it to `.specify/feature.json`, then unset the
variable before package commands. Existing dirty worktrees are recovery inputs;
do not reset, clean, regenerate or silently continue editing them.

Keep package fixes in separate PRs. Carry dependent checkpoints through stacked
branches, integrate through PRs, and reconcile the stack against merged main before
freezing the release. The documentation coordinator branch is not a combined feature
branch. Never blindly merge the recovered coordinator lineage into one package PR:
it contains several packages and infrastructure changes.

Each package reads its FR card with the requirements README and existing feature
artifacts. Use package-local converge to inventory gaps, then separate flow-back to
spec/plan/upstream cards/SRS/architecture, refine tasks, analyze, and implement.
Preserve IDs; append missing tasks rather than assigning old IDs to new work.
Require spec-derived Red evidence before fixes. Evaluate CC-01..CC-09 in the
package plan and analysis. Do not approve reviewer-owned checklists on their behalf.

## Work packages — CC-01, CC-06

### 0. Preserve recovery inputs and establish lineage — C-01..03, NFR-PERF-01

Owner: release coordinator. No application implementation in this step.

1. Record heads, ancestry, status, changed-file manifests and hashes for 006,
   recovered coordinator and 009–012 worktrees. Save binary-capable tracked patches
   and copies/hashes of every untracked file in private recovery storage. Sanitize
   evidence before putting it in Git; preserve originals privately.
2. Classify recovered commits: `77bac2b` audio; `a6a38e5` sandbox;
   `e7436b5` mindmap; `7e87bb2` ingestion infra; `0e00bf8` sandbox infra.
   Check merge/parent commits and already-merged equivalents before selecting changes.
3. Inventory 012 changes against its exact base, not against main alone. Separate
   implementation, shared contracts/spec flow-back, image alignment and evidence.
   Review its local reports as diagnostics, not release proof.
4. Create a durable, sanitized evidence index and candidate manifest referencing
   these recovery hashes and the later package integration commits. Preserve the
   saved API approval/apply scope and owner decisions.

Exit: a new worktree can reconstruct every intended change without losing dirty
work or silently importing unrelated package changes. Recheck remote/main drift
before choosing the integration base.

### 1. Integrate completed Package 2.2 repairs — FR-SI-02, FR-GC-07

Feature `006-source-guide-chat-control`; issues #7/#40/#43. Card:
[Package 2.2](../spec/requirements/v2/package_2_2_proactive_context_intelligence_chat_control.md).

- Review and transfer the delta from clean checkpoint `4fd99c0`, excluding its
  already-inherited main changes. Keep its committed tests, attempt manifests and
  measured evidence. The latest Guide cohort is 20/20 ready; the earlier overall
  judged report still fails and must retain that status.
- Review the bounded transient-error behavior against the measurement contract:
  retain errors, attempt counts and elapsed time; no citation-validation retries
  into a passing answer. Add tasks/failing tests only for remaining gaps.
- Re-run affected deterministic and integration checks after transfer. Verify
  Guide bounds, eligible response-length ratios, grounding and refusal behavior;
  document why any prior live evidence still applies to the new checkpoint.
- Flag `apps/worker/src/package-v2-2-gemini.ts` for the later 012 three-way merge:
  retain both trusted Guide instructions and cache/private-error handling.

Exit: isolated reviewed PR with applicable evidence. Remove synchronizer failure
overrides only after merged acceptance proof; a local commit does not close issues.

### 2. Finish Package 1.1 retained work — FR-WM-01/04/07, NFR-SEC-01/02

Feature `001-workspace-foundation`, T046. Card:
[Package 1.1](../spec/requirements/v1/package_1_1_workspace_foundation.md).

- Replace stale test-path references with discoverable coverage; inspect existing
  identity and notebook-cleanup tests before adding explicitly gated real-service
  suites. Use disposable approved tenant/accounts and storage only.
- Verify revocation, notebook isolation, every retained object generation, active
  uploads/resumable sessions, cleanup retry recovery and deletion-status privacy.
  Prove object absence after cleanup, not just acceptance of deletion.
- Flow back and implement the saved admin-created-only account policy. Enforce
  registration restrictions in the authoritative identity configuration; removing
  the visible Create account button alone is insufficient. Preserve existing
  users' sign-in and test both allowed access and rejected direct signup.
- Prepare any required concrete IaC/configuration change for approval before apply.

Exit: T046 has passing real-service evidence or remains explicitly UNAVAILABLE with
the exact missing prerequisite. Signup enforcement has integration evidence before
broader sharing; no production deletion tests or link distribution.

### 3. Finish Package 2.4 retained work — FR-SI-02, FR-ST-10/11, C-03

Feature `008-studio-text-reports`, T061 plus newly traced reliability tasks. Card:
[Package 2.4](../spec/requirements/v2/package_2_4_studio_text_synthesis_reports.md).

- Flow back the saved decision: configurable maximum two concurrent extra-language
  Guide runs and 20 starts per notebook per rolling hour. Ordinary ingestion is
  excluded; deduplicated requests consume no new admission. Failed admitted starts
  remain in the hourly population.
- Add adversarial concurrent admission tests, then implement atomic persisted
  accounting using existing PostgreSQL/runtime paths. Verify terminal-state slot
  release, crash/restart recovery, quota-window boundaries, error responses and
  legitimate multilingual suggestions. Recheck migrations before allocating the
  previously reserved `0012`; never alter applied migrations.
- Reproduce the report 504/75% validity failure and isolate model, worker and HTTP
  deadline behavior before changing timeouts. Fix the measured cause with failing
  tests; preserve validation-before-publication and truthful failure states.
- Route missing OCR configuration to owning Package 1.2/feature 002 if required
  configuration alone does not resolve it. Add a separate package worktree/agent
  before continuing dependent tests; do not implement OCR under 008. Confirm existing
  approval scope before provisioning its dependencies.

Exit: admission limits and all four report templates have applicable verification;
OCR/report prerequisites no longer invalidate the final judged run. Closed #9 does
not erase T061. The v2 override remains labelled as an override.

### 4. Recover and finish Package 3.1 — FR-SI-01/04/05, C-01/C-02

Feature `009-multimodal-ingestion-sync`, T049/T050; #10/#51/#52/#83. Card:
[Package 3.1](../spec/requirements/v3/package_3_1_multimodal_ingestion_sync.md).

- Review and integrate `77bac2b` and the package-specific `7e87bb2` infrastructure
  changes. Verify ordinary Office/web/video/audio, Drive refresh, screening, SSRF,
  re-sync failure preservation and authorized media delivery with current contracts.
- Freeze the audio plan, fixture/provider hashes, queue timing boundary and at least
  20 attempts before running the runbook's 30-minute-audio cohort. Require the
  declared queue-inclusive P95 ≤45 seconds and retain every attempt/failure.
- Verify `Interview.mp3` citation click at 04:15 through the deployed application;
  provider timing alone cannot prove timestamp navigation.
- T049 references the final common fixed 50-case judged run, not an extra run here.

Exit: live adapter and locator evidence on the candidate, with T049 pending until
the common run qualifies. Missing provider prerequisites remain named blockers.

### 5. Recover and finish Package 3.2 — FR-GC-08, NFR-SEC-01/02

Feature `010-code-execution-sandbox`, T052; #11/#53. Card:
[Package 3.2](../spec/requirements/v3/package_3_2_code_execution_sandbox.md).

- Review `a6a38e5` and package-specific `0e00bf8` infra. The recovered collector
  honestly reports unavailability; implement real collection if still absent,
  with a failing configured-but-no-measurements regression first.
- Use the accepted managed sandbox under D18–D20: no obsolete R6 qualification
  project. Verify network denial, scoped input copies, correct results/plots,
  authorization, cleanup, late results, 15-second deadline and allowed retry rules.
- Collect provenance-backed application observations for all four declared
  cold/warm × one-user/two-user cohorts, at least 20 samples each. Verify Running
  code status ≤2.5 seconds and creation-to-completion P95 ≤4 seconds under the card's
  timing definitions, retaining failed/time-out samples.

Exit: live security/integration checks and complete cohorts pass; T052 links the
common judged report. Environment flags and skipped tests are not live evidence.

### 6. Recover and finish Package 3.3 — FR-ST-08/09/18, C-03

Feature `011-studio-mindmaps-data-tables`, T061 plus #153 repair; #12/#54/#55/#56.
Card: [Package 3.3](../spec/requirements/v3/package_3_3_studio_structure_data_extraction_mindmaps_tables.md).

- Review/integrate `e7436b5` collector and drag support. Preserve the recorded
  120-node P95 16.734 ms failure. Diagnose the frame population, timing method,
  browser/hardware and actual rendering cost before optimizing; do not round it
  into a pass or silently relax the ≤16 ms criterion.
- Before #153 implementation, replace the contradictory text-only/inline-citation
  export wording in 011 spec/plan/contracts, FR card and architecture with the
  saved numeric-value/separate-citation-column decision. If a shared schema breaks,
  supply the SRS amendment, decision, migration plan and consumer tests required
  by Constitution IV. Preserve canonical data and current conflict/missing semantics.
- Add Red regressions in `apps/api/test/studio-table-export.test.ts` and affected
  contract/browser tests. Implement in `apps/api/src/studio/table-export.ts` and
  owning schemas: XLSX numeric cells, plain numeric CSV fields, separate citation
  columns; keep formula neutralization for text/headers/labels. CSV has no cell
  types: verify numeric import behavior on declared consumers. Reject ambiguous
  numeric coercion; identifiers and conflicting/missing values retain their semantics.
- Inspect actual generated XLSX cell types and CSV round trips, including negative,
  zero and decimal values, malicious formula strings/whitespace bypasses, conflicts,
  citations, sorting and live export authorization.
- Obtain declared N≥20 submission-to-Completed mindmap samples (P95 ≤20 seconds)
  and 120-node viewer evidence (P95 ≤16 ms), plus exports/recovery/scope tests.

Exit: #153 has product and spec fixes; required real generation/viewer/export evidence
passes. No invented table-generation latency threshold; cite the common judged run.

### 7. Recover and finish Package 3.4 — NFR-PERF-01, C-01..03

Feature `012-long-context-latency-scaling`, T051–T060; #13/#57. Card:
[Package 3.4](../spec/requirements/v3/package_3_4_long_context_latency_scaling.md).

Review the preserved patch task by task against the exact execution brief. Existing
code and reports are inputs to verification; do not rewrite them from main.

| Tasks | Required review and remaining implementation |
| --- | --- |
| T051–T053 | Prove serving-instance/readiness qualification, private evidence persistence, actual scoped token ledger and observable prompt/citation leakage. Reject missing/mismatched evidence. Preserve first fresh validated SSE final timing and exact needle citation. |
| T054 | Prove real simultaneous concurrency-2 with separate Owner credentials/notebooks/scopes. Missing second inputs and malformed profile/import provenance must fail unavailable; no serial or same-token fallback success. |
| T055–T057 | Verify ordinary API/Postgres stress using actual 999999/1000000/1000001 original tokens, 300-source admission/301st rejection, all 40 Guides plus original-detail follow-up, bounded complete original coverage, cache hit/miss/expiry/restart/revocation and attempt fences. |
| T058 | Retain actual Node engine Red evidence, align API and render build/runtime images with Node26, build and smoke-test final image runtime where available. Separate incidental lockfile churn. |
| T059 | Reconcile quickstart/analysis/handoff/tasks and gate draft against actual tests and preserved failures. Merge shared schemas, SRS/README/architecture serially and resolve Guide/cache overlap with 006 explicitly. |
| T060 | Qualify approved EU enterprise model/tokenizer/cache, deployed readiness/clock and memory evidence, scale/core/concurrency profiles and integrated release acceptance. |

Local doubles can verify mechanics; local reports must continue to say enterprise
capacity/latency UNAVAILABLE. For release measurement use the declared 41-source
fixture with at least 1,050,000 original active tokens in sources 1–40, excluding
overlap and the decoy. Predeclare 20 eligible warm submissions in at most 40 total
attempts; any valid warm failure fails acceptance. Require warm P95 ≤2,500 ms,
correct needle citations and zero leakage. Classify warm state before measurement;
record wake delays separately without resetting submission time.

Exit: reviewed implementation and applicable local evidence are committed; cloud
qualification remains open until the final deployed candidate meets T060.

## Deployment and final acceptance — Gate v3.0, NFR-EVAL-01..04

Owner: release coordinator, after package checkpoints and deterministic checks.

1. Recheck the actual cloud inventory. Freeze source SHA, schema/migrations, Node
   runtime, images by digest, API/worker/render revisions, model/tokenizer/cache
   versions, configuration, readiness signals, fixture hashes and golden dataset.
   Do not deploy the old v2 image or use a mutable branch name as candidate identity.
2. Prepare a saved OpenTofu plan and deployment/workload manifest: exact resources,
   EU region, IAM, API changes, account/fixture needs, invocation caps, estimated
   paid scope, stop conditions and rollback. Four prior API registrations are
   already approved/applied; that API-only plan is not a full resource deployment
   plan. Obtain required project-owner approval only once the new proposal is
   concrete and reviewable. Do not execute new billable resources or paid cohorts
   on the strength of this planning request.
3. Build/smoke-check the integrated images and run `pnpm build`, `pnpm lint`,
   `pnpm typecheck`, unit/contract/integration/browser suites, deterministic evals,
   spec integrity and whitespace checks. Use disposable local PostgreSQL for
   destructive tests. Restore or replace GC-E04 refusal coverage with a traced
   package-003 regression; if product work is needed, route it to its own package.
   Verify SCALE-UI-01 fills a question before asserting Send enabled while retaining
   readiness coverage. Required live skips cannot count as passing acceptance.
4. Deploy the authorized candidate and run bounded smoke tests before the declared
   audio, sandbox, map/viewer, context/cache and warm-scale cohorts. Keep real
   provider results separate from doubles; record exact commands and exit statuses.
5. After known deterministic, configuration and reliability failures are resolved,
   run one common fixed deterministic stratified 50-case judged release sample.
   Record case IDs, category composition, dataset hash, all errors and denominators.
   Require hallucination <5%, rejection ≥99%, citation precision 1.0, semantic
   support under the spec and leakage zero. Link this qualifying run across packages.
6. A candidate change invalidates affected evidence. Re-run affected checks and
   record applicability for evidence reused unchanged; no expensive unchanged run
   is repeated solely because another package links it.

All observations use PASS / FAIL / UNAVAILABLE / NOT_RUN with candidate, time,
environment, fixture, attempt population and immutable report/hash. Keep historical
failures, including the earlier overall judged failure and memory/viewer diagnostics.

Exit: requirement-by-requirement evidence supports Gate v3.0 and the retained v1/v2
backlog. Missing required evidence leaves acceptance pending. Only then update the
gate record and use the roadmap sync workflow: review overrides and dry-run diff,
apply authorized changes, verify an idempotent dry run. Update #7/#10–13/#40/#43/
#51–57/#83/#86/#153 only where merged implementation and applicable acceptance
support closure. Add evidence-backed acceptance rules so the synchronizer does not
reopen accepted work or infer future release completion.

## Scope triage and unresolved review — CC-06/07/08

- PR143 (workflow docs), PR152 (Google sign-in), Dependabot PR175–185 and future
  v4–v6 issues are review queues, not automatic pre-V4 blockers. Review provider
  major bumps against recovered IaC; do not mass-merge them into the candidate.
- Assess the reported transitive uuid alert against the final lockfile, callers and
  upstream fix. Security remediation, if required, gets a separately scoped change
  and compatibility checks; no unsupported dismissal or blanket major override.
- Preserve D5/DEV-03 deferrals, owner-only v1–v5 authorization, enterprise no-training
  endpoints and europe-west4 residency. New services/region exceptions follow the
  existing approval/decision rules.
- The 006/009/010 unchecked requirement-review checklists retain reviewer ownership.
  Obtain their review disposition before claiming those reviews complete.

## Constitution checks for execution — CC-01..CC-09

These are planning constraints, not certification of the recovered code. Every
package must repeat its checks before research and after design, and in analyze.

| Gate | Required evidence before implementation/acceptance |
| --- | --- |
| CC-01 | Qualified task/requirement mapping, governing cards and synchronized spec/plan/upstream flow-back; especially #153, signup and Guide admission. |
| CC-02 | Spec-derived Red tests before remaining code fixes; inspect existing recovery Red evidence instead of inventing a new history. |
| CC-03 | All source reads through C-02, explicit Ready-source snapshots and fresh access checks across cache/Studio/sandbox. |
| CC-04 | Validate before publication; exact citations, refusal and zero leakage; restored refusal browser coverage and final judged sample. |
| CC-05 | One shared C-01/C-02/C-03 definition; deterministic generators and existing Studio lifecycle; no alternate processing stack. |
| CC-06 | One package per branch, serialized dependent agents, retained gate override and evidence-backed Gate v3 before V4 implementation. |
| CC-07 | Owner authorization, atomic admission, revocation/purge, no secrets in evidence, enterprise EU endpoints and exact approval scope. |
| CC-08 | Node26/pnpm locked stack, existing PostgreSQL and Cloud Run; IaC review without unrecorded datastore/framework/idle-cost additions. |
| CC-09 | Load current Constitution IV and architecture procedure; refresh resumed package boundary inventories and analyze before code. Require actual graph/artifact checks, behavior evidence and manual responsibility review. Preserve exact approved legacy exceptions; no new or widened violations. Governance-only records do not certify runtime architecture. |

The first implementation action is recovery preservation and lineage review, followed
by the already-completed 006 checkpoint integration. No fresh V4 feature is part of
this plan. Completion means a reproducible accepted candidate, not an empty checkbox
inventory.
