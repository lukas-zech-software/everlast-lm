# Refining and replanning existing release packages

These are project-local operating rules and lessons from updating v3 packages 3.1–3.4 against main `0a94f3fca01395922fa788ea8cbb4286e8500f4a` on 2026-10-21. They support `CC-01..08`, shared contracts `C-01..03` and `NFR-EVAL-01..04`. They do not amend product requirements or waive release gates.

[Spec Kit's methodology](https://github.com/github/spec-kit/blob/main/spec-driven.md) treats specifications, research and design as continuously refined artifacts. It supports revisiting affected intent and plans as reality changes. It does not prescribe a special “refresh all packages” command or require a particular Git merge/rebase strategy. The protocol below applies that method to this repository's package, worktree and authority rules.

The reusable definitions are in [the agent catalog](../.codex/agents/README.md). They include one controller, eight lifecycle specialists and a combined single-package refresh specialist. The latter is useful when the same package needs spec review, clarification checks, planning and checklist generation in one bounded assignment.

## What the refresh taught us

A clean Git merge is insufficient. Main had implemented PostgreSQL ingestion, canonical viewer text and hybrid retrieval, while old v3 plans still described some of those as missing. Meanwhile Studio and Guide repositories still had process-local wiring. Verify actual runtime composition, imported implementations, routes, SQL migration application, serialization and publication paths. A repository class or draft migration existing on disk does not establish deployed persistence. Update the plan to extend what exists and assign the missing work to a named package.

Preserve intent while replacing stale assumptions. Previously answered questions remain accepted unless the user explicitly supersedes them. Updating a technical baseline is not permission to reopen numeric limits or relax isolation. For example, the accepted managed sandbox CPU/RAM envelope did not prove network isolation, scratch enforcement, termination or EU qualification. Treat design completion, reviewer approval and runtime acceptance as separate claims.

Refresh every affected artifact, not just plan.md. A changed route or persistence boundary can invalidate research, data models, contracts, quickstart commands, acceptance wording, tasks and prior analysis. Record the dependency chain. Preserve artifact identifiers, contract compatibility, completed-task history and useful rationale. Read the live constitution: main changed the judged-evaluation cadence, so old instructions copied into plans had become wrong even without code conflicts.

Resolve identity collisions semantically. Independent branches had reused D15, D16 and DEV-04 for different meanings. Preserve published main identities; the controller coordinates a documented mapping for unpublished branch-local references and checks all affected documents. Never globally replace an ID without distinguishing its meaning. This is collision reconciliation, not permission to renumber published architecture decisions.

Keep shared prerequisites explicit. Package 3.1 owned durable revision-keyed Guide work, 3.3 owned Studio persistence/jobs, and 3.4 consumed those designs for integrated performance qualification. Avoid duplicated migrations or claiming a predecessor's design is already implemented. Shared-file flow-back must be serialized or integrated by a designated owner.

Checklists have different purposes. The built-in requirements.md is revalidated after relevant spec edits under the installed specify/clarify procedure. Custom checklists contain reviewer-owned requirements-quality questions: preserve their content, append nonduplicate change-related questions, and leave generated items unchecked. Their creation is neither reviewer approval nor runtime testing. A later implementation command may require an explicit decision about unchecked items; do not tick them just to pass that gate.

Capture reproducible evidence. In this refresh, Markdown integrity and diff checks passed, but absent dependencies prevented TypeScript compilation. The shell Node version also differed from the project target. Record those limits precisely. Historical reports and owner overrides are not fresh passing measurements. A package's finished planning stage does not mean the package is implemented or the release gate passed.

## Controller procedure

1. Create the coordination worktree before repository exploration or execution. Read current governance there. Fetch the requested latest main, record the immutable SHA and previous package/checklist commits, and inspect the delta. Do not mutate the original checkout.
2. Resolve the milestone from the SRS to cards and feature directories; read README prerequisites. Allocate package paths, worktree/branch names, shared-file ownership and integration ownership centrally. Do not select features by branch name, largest directory number or a stale pin.
3. Decide which stages are stale. Review existing specification and accepted answers first; clarify only new material uncertainty. Replan affected technical design. Refresh tasks and analysis only if already present and authorized. Preserve the user's stopping point.
4. Dispatch exactly one package worker per package for the assigned workflow. Interdependent packages run sequentially; the next starts only after the previous agent has completely finished and its commit is verified. Each new worker branches from that completed HEAD. Independent stages may run concurrently only with an explicit dependency/ownership justification and no shared uncommitted prerequisite.
5. Designate one main integration. Preserve handed-off branch history with a new refresh lineage and explicit merge by default; do not repeatedly merge in every worker. Preserve both upstream changes and accepted package decisions. Never discard conflicting meaning with blanket ours/theirs resolution.
6. Independently verify each handoff and the cumulative result. Report the exact baseline used, not an unqualified claim that the branch will always be latest. All package artifacts/checklists must be present in the final lineage; parallel agents returning summaries is not integration.

Ordinary clarify/checklist assignments can sometimes be parallel even when implementation has dependencies. Reassess independence for the specific stage. Broad replanning, shared-contract changes and integrated performance work generally require sequencing under AGENTS.md. Worktree separation alone does not isolate shared database state, ports, credentials, cloud resources or permission policy.

## Choosing the next step

| Current state | Authorized response | Stop condition |
| --- | --- | --- |
| New package | Specify, clarify when needed, plan, then requested subsequent stages. | User-assigned stage, not automatically deployment. |
| Existing intent valid; main changed implementation | Review preserved spec, refresh affected research/design and requirements-quality questions. | Phase 1/checklist if no task work authorized. |
| Main changed governing requirements | Reconcile spec first, gather new questions, flow back, then replan affected design. | Unresolved material answer blocks dependent work only. |
| Existing tasks depend on stale design | Record affected IDs; update tasks only within authority; preserve completed IDs/history and rerun analysis. | Current task set and analysis, or assigned earlier stage. |
| No tasks.md | Do not invoke full speckit-analyze; use documented focused spec/design review. | Design refresh; do not manufacture tasks to satisfy analyze. |
| Analysis found defects | Return read-only findings; controller obtains/uses remediation authorization. | No silent edits during analyze. |
| Waiting for answers or permission | Keep assignment/worktree and complete independent work; resume there after response. | Do not assume elapsed time is approval. |
| Runtime qualification unavailable | Separate implemented/unbuilt/unverified states and return concrete missing evidence. | No invented PASS or release-complete claim. |

A plan refresh runs the installed plan setup and Phase 0/1 process. Save/review prior contents before setup copies a template. Do not reinstall the CLI, recreate a feature directory, replay the entire pipeline or edit managed templates. Read extension hooks on every relevant stage and execute required hooks; an announcement is not execution. Overlay resolution and worker orchestration are separate concerns; see [the overlay guide](spec-kit-workflow-overlays.md).

## Worker dispatch contract

Provide concrete values; the example below is a shape, not an executable configuration or a claim of environment inheritance.

```yaml
repository_path: /absolute/path/to/repository
release: v3.0
package_id: '3.1'
package_card: spec/requirements/v3/package_3_1_multimodal_ingestion_sync.md
feature_directory: specs/009-multimodal-ingestion-sync
worktree_path: /absolute/path/to/new-package-worktree
branch: codex/v3-package-3-1-refresh
base_commit: <verified completed predecessor SHA>
requested_stage: refresh
mode: refresh
fetched_main_commit: <fetched immutable main SHA>
prior_artifact_commit: <previous package artifact SHA>
integration_owner: this-worker # or already-integrated-by-predecessor
custom_checklist_sources:
  - source_commit: <exact checklist commit SHA>
    path: specs/009-multimodal-ingestion-sync/checklists/ingestion-sync.md
accepted_decisions:
  - id: '3.1-Q1'
    answer: <literal accepted answer and any explicit supersession>
shared_file_ownership:
  - own feature directory and package card
  - narrow assigned SRS/README/architecture flow-back
question_policy: collect # recommended only for delegated routine decisions
stop_after: design-and-checklist
commit_policy: commit-assigned-artifacts
```

For implementation, also assign isolated test resources, release/checklist gate evidence and external-action permissions, if any. For read-only analyze, specify report-only delivery. A decision table should include status, meaning, source and supersession; do not pass just ambiguous “Option A” without its question/options.

The controller supplies the exact feature path via SPECIFY_FEATURE_DIRECTORY. If the tool cannot inject env, explicitly instruct this shell assignment in bootstrap step two. The worker's first repository action is creating its assigned worktree; its immediately following action must perform the export, JSON write, unset and assertion in one shell invocation. Preserve unrelated feature.json keys, validate the specs path and verify actual resolution before setup. Never persist that variable or import another worktree's pin. A script's BRANCH field can describe the feature slug; verify the real Git branch separately.

For a new specify assignment only, the pin may target the controller-allocated directory before creation. Resume of an interrupted assignment reuses its existing worktree; a new stage/package assignment gets a new one. Coordination does not choose an arbitrary active feature.

## Questions and continuation

With collect policy, workers gather every independently identifiable question literally, using package/stage IDs, complete options and recommendations, and continue all work that does not depend on those answers. They return WAITING_FOR_ANSWERS rather than asking the human directly. The controller presents one agent's questions verbatim at a time, relays all answers unchanged by ID to that agent, and waits for completion before advancing a dependent package. Answers can expose further questions; return another literal batch when needed.

With recommended policy, routine delegated choices use recorded recommendations without user interruption. This does not authorize changed scope, weakened product/security controls, deployment, API enablement or bypassing a required human gate. An explicit user supersession is encoded in artifacts before dependent design proceeds. Use existing session authorization; do not ask repeatedly.

## Handoff and acceptance

Workers return the following evidence, compactly:

```yaml
status: COMPLETE # or WAITING_FOR_ANSWERS / BLOCKED
package_id: '3.1'
stage: refresh
worktree: <absolute path>
branch: <actual Git branch>
feature_directory: <exact JSON pin>
base_commit: <supplied SHA>
head_commit: <result SHA>
main_commit: <integrated target SHA>
main_is_ancestor: true
changed_artifacts: []
decision_mapping: []
checks: [] # command, PASS/FAIL/UNAVAILABLE/NOT_RUN, evidence
questions_verbatim: []
remaining_risks: []
next_permitted_stage: tasks
```

The controller verifies, rather than merely repeating, the branch/worktree/pin, commits and ancestry, package-only scope plus declared shared flow-back, required artifacts, preservation of original custom questions and stable IDs, current built-in quality state, integrity/diff checks and honest evidence limits. Check combined artifacts again after integration. Read-only analysis returns findings without modifying or committing feature artifacts; identify any local bootstrap pin change separately.

The final cumulative branch can inherit earlier package changes. “One package per branch” means each worker's new processing/edit scope is one package; inherited prerequisites do not license that worker to rewrite all packages. Report stage completion separately from package completion and full release acceptance. Do not push/open a PR/deploy merely because local refreshes are done.
