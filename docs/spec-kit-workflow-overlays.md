# Spec Kit workflow overlays

The repository already includes the [pipeline workflow](../.specify/workflows/pipeline/workflow.yml). Project-local overlays extend its step list without editing that base file. The installed CLI's `workflow overlay add` command copies and validates an overlay; ordinary YAML copied into `.notes/` is not active workflow configuration.

The [pipeline-verification overlay](../.specify/workflows/overlays/pipeline/pipeline-verification.yml) adds completion checks to the existing sequential pipeline. It does not schedule parallel workers or install additional agent integrations.

## Installed behavior

- Keep the existing lifecycle, clarification gate, analysis gate, and three-cycle convergence/implementation loop.
- Stop the loop when the convergence command fails, instead of continuing through `continue_on_error: true`.
- Run a final append-only convergence assessment after the last implementation pass.
- Require a completion review after that assessment. Remaining tasks, blocking findings, outdated analysis, or required checks without passing evidence prevent approval.
- Use the base workflow's `integration` input instead of hardcoding Claude or rotating across uninstalled integrations.

The final review is a human gate, not an automatic semantic evaluator. The overlay neither creates a test harness nor proves product correctness. A command returning zero can still report unfinished work; the reviewer must inspect the result. The existing loop remains bounded and does not stop early based on semantic convergence.

## Inspection, installation, and execution

These commands inspect the installed composition without executing coding agents:

```bash
specify workflow overlay list pipeline
specify workflow resolve pipeline
```

`resolve` reports layer and step attribution; it is not a dry run of agent behavior. This overlay is stored in the repository, so a checkout containing it needs no separate installation step. To import a reviewed external overlay file into a setup worktree:

```bash
specify workflow overlay add /path/to/reviewed-overlay.yml --priority 10
specify workflow resolve pipeline
```

Do not reinstall the base pipeline merely to add an overlay: its existing project customizations must be preserved. Overlay anchors must exist in the base workflow. Revalidate the composition after a base-workflow upgrade.

Run a composed workflow by installed ID (`pipeline`). Running the base YAML file directly bypasses overlay resolution. A full pipeline begins at specification and can modify artifacts; for an existing feature already at implementation, use its scoped implementation command instead.

Before any actual run, select a registered integration, use the assigned worktree/branch, establish the intended feature context, and verify required tools. Pin core-script resolution with `SPECIFY_INIT_DIR`, `SPECIFY_FEATURE_DIRECTORY`, and `SPECIFY_FEATURE_NO_PERSIST=1` where applicable; check extensions separately. Only `agy` was registered in the audited repository configuration.

In a non-interactive process, the review gate pauses. Inspect the run and resume in an interactive terminal to make the review decision:

```bash
specify workflow status --json
specify workflow resume "RUN_ID"
```

Replace `RUN_ID` with the reported identifier. Resume uses the persisted workflow definition; installing this overlay does not retrofit an existing run. Resume checkpoints describe workflow execution, not transactional rollback or proof that task side effects are safe to repeat.

## Assessment of the proposed parallel overlay

The `Workflow-Overlay.md` and `Workflow-Overlay.yaml` proposal in the local setup notes was inspected without activating it. The useful elements are declarative composition, preservation of the `implement` anchor, dynamic integration expressions, bounded concurrency, and a post-worker assessment. Step IDs must indeed avoid the reserved colon character.

The proposed implementation is not ready for use with Specify CLI `1.2.1.dev0`:

1. **Invalid anchors:** three edits target newly inserted steps (`extract-parallel-tasks`, `implement-parallel`, `join-parallel-wave`). The installed composer validates anchors against the base workflow, so it rejects these edits. Multiple insertions after an existing base anchor can preserve declared order.
2. **Wrong feature selection:** sorting `specs/*/tasks.md` and selecting the last entry chooses package `004` in this repository, regardless of the assigned feature. The extracted `feature_dir` is never used to pin worker dispatch.
3. **Broken output wiring:** a shell step returns `exit_code`, `stdout`, and `stderr`. Structured JSON requires `output_format: json` and is then available under `output.data`; the proposed `output.parallel_tasks` reference resolves to no list and fan-out fails.
4. **No dependency scheduling:** collecting every unchecked `[P]` task ignores prerequisite tasks, phase gates, test-first ordering, and file conflicts. Some parallel candidates depend on non-parallel work that the proposal postpones until after fan-out.
5. **No worker filesystem isolation:** all command steps inherit the workflow project root. Saying “in isolation” in a prompt creates no worktree and supplies no worker-specific environment. Workers can race on source files and `tasks.md`.
6. **Unverified integrations:** the proposal hardcodes Claude/Codex/Gemini while the project registers only Antigravity. CLI availability alone does not establish integration registration or working authentication.
7. **Incorrect fan-in summary:** `fan_in.results` collects upstream step outputs, including the fan-out aggregate. It does not contain the assumed `result.status` records. Fan-in aggregates results after fan-out; it does not merge worker commits or validate the combined code.
8. **Incomplete instructions:** the Markdown names a different installation filename, uses the wrong `SPECIFY_NO_PERSIST` variable, and ends before giving a resume command. Its claim of exact resumption at unfinished task IDs exceeds workflow checkpoint guarantees.

Fixing the YAML syntax alone would not fix scheduling or isolation. Parallel execution additionally needs reviewed dependency waves, assigned worktrees/branches, exact feature and file ownership, canonical task ownership, isolated test resources, and integration verification. The verification overlay deliberately adds none of that machinery.

## Verification evidence

Checked with the installed Specify CLI `1.2.1.dev0`:

- The proposed overlay parsed as YAML but failed base-anchor validation with three errors.
- Its read-only extraction selected four tasks from package `004`; evaluating its fan-out returned a failed result because `items` resolved to `None`.
- The installed verification overlay composed and passed the workflow validator.
- Engine tests with inert replacements for all coding-agent commands verified that convergence errors halt execution, final assessment runs after the last implementation, non-interactive completion review pauses, approval resumes without rerunning agent commands, and rejection returns an abort outcome.

These checks establish configuration and control-flow behavior. No implementation agents were launched, and end-to-end product or multi-provider execution was not validated.
