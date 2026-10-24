# Implementation Evidence: Quantitative Code Execution Sandbox (specs/010)

Scope: FR-GC-08; supporting FR-GC-01/02/03/06, FR-SI-03/05, FR-WM-04/05, C-01/C-02, NFR-SEC-01/02,
NFR-EVAL-01..04, NFR-PERF-01, Gate v3.0 #2. Task references are qualified as `[010-code-execution-sandbox] Tnnn`.

## T001 — Preconditions (FR-GC-08, C-01/C-02, Gate v3.0)

| Item | Recorded value |
| :--- | :--- |
| Worktree / branch | `/Users/luke/Projects/claude/everlast/everlast-lm-worktrees/impl-010`, `feat/v3-010-code-execution-sandbox` |
| Base | `feat/v3-009-multimodal-ingestion-sync` @ `24697d3` (completed package 3.1) |
| Feature pin | `.specify/feature.json` → `specs/010-code-execution-sandbox` (`SPECIFY_FEATURE_DIRECTORY` unset, not persisted) |
| Gate v2 authority | Owner override recorded in `docs/gate-v2-live-evaluation.md` (2026-10-20), limits retained as recorded by package 3.1 (not re-claimed). |
| Package 3.1 handoff | `specs/009-multimodal-ingestion-sync/implementation-evidence.md`: C-01 unchanged (page_span/dom_path/time_span), C-02 exact `(source_id, revision)` snapshots fail verification after re-sync/removal, citation status `updated`, migration 0009 used. Consumed unchanged. |
| D18 / D19 / D20 | Managed default 2 vCPU / 1.5 GB, provider accepted (R6 obsolete), limits follow the managed sandbox (no network, ≤100 MB file I/O, 15.0 s application deadline). |
| Runtime | Node.js `v26.3.0`, pnpm `12.0.0`, Vitest `4.1.11`, OpenTofu `v1.13.1`, local CPython 3.13 (harness self-check only) |
| Test database | PostgreSQL 16 + pgvector container `everlast-pg-test`, `TEST_DATABASE_URL=postgres://everlast:everlast@127.0.0.1:54329/everlast` |
| Managed sandbox | Agent Platform Code Execution: **UNAVAILABLE** (no owner-approved parent runtime, no `CODE_EXECUTION_*` configuration, no paid calls authorized). The REST adapter is exercised against a recording fake of the documented v1beta1 surface; application lifecycle tests use a labelled scripted runtime double. |
| Reviewer checklist | `checklists/requirements.md` 16/16 checked. `checklists/sandbox.md` 0/37 checked: reviewer-owned requirements-quality items were **not** reviewed or approved by this run; the orchestrating agent directed implementation to proceed (same handling as package 3.1). |
| Package boundaries | Package 3.2 only. Packages 3.3 (FR-ST-08/09/18) and 3.4 (NFR-PERF-01) untouched. No deployment, `tofu apply`, API enablement, push or PR. |
| Migration | `0010_code_execution.sql` (after 0001–0009). Package 3.3 starts at `0011`. |

## Red → Green record

Runner: Vitest 4.1.11 (`unit` + `integration` projects, real PostgreSQL 16 + pgvector), OpenTofu `tofu test` (mock
provider), Playwright chromium against `apps/web/test/e2e-server.ts`.

| Task | Test file(s) | Red observed (requirement-related) | Green |
| :- | :- | :- | :- |
| T004 | `packages/contracts/test/package-v3-2.test.ts` | 12/14 failing: `expected undefined to deeply equal ['CodeGenerating', …]`, trace/attempt/value/manifest schemas absent, `ChatMessageSchema` rejected `code_execution_trace` (V32-C04/C06 passed vacuously before the schema existed) | 14/14 (T008) |
| T005 | `packages/db/test/code-execution.integration.test.ts` | 11/12 failing: migration 0010 absent, `admitCodeExecution` undefined, `kind: clarification` rejected by CHECK, clear did not invalidate charts (CE-DB-03 passed vacuously: tables absent) | 12/12 (T009) |
| T006 | `apps/api/test/code-execution-runtime.test.ts` | 18/18 failing (`runtime.ts` absent: constants, adapter, deadline, size caps, unknown outcome) | 18/18 (T012). RT-18 (local CPython harness self-check) exposed that the published value is the sandbox's own `repr()` (`3.4520525295346633`, correctly rounded `statistics.pstdev`) and differs from the JS formula in the last digit → oracles compare numerically (fixture `NUMERIC_TOLERANCE`), published text stays verbatim. |
| T007 | `apps/api/test/code-execution-manifest.test.ts` | 9/9 failing (`manifest.ts` absent) | 9/9 (T013) |
| T010 | `infra/modules/code_execution/tests/runtime_policy.tftest.hcl` | `tofu test`: 1 failed, 3 skipped (module absent) | 4/4 (T011) |
| T014 | `apps/api/test/code-execution.test.ts` | 8/9 failing: no compute path (answers lacked `(Computed)`, no trace, no `running_code`), clarification kind absent, no complete-snapshot expansion, no 503 when unconfigured (CE-API-05 guard regression passed before and after) | 9/9 (T018–T021) |
| T015 | `apps/api/test/code-execution-model.test.ts` | 8/9 failing: draft schema lacked compute/clarify, verifier had no clarification/compute outcomes or numeric preamble guard, no `composeComputedAnswer`, prompt had no delegation rules, ADK model had no `correctCode` (MOD-06 unchanged-refusal regression green) | 9/9 (T018) |
| T016 | `apps/web/test/code-execution.test.ts`, `apps/web/test/code-execution.spec.ts` | unit 5/5 failing (`code-execution.ts` absent); browser CE-E01 (`Running code…` never shown) and CE-E02 (no clarification kind) failing; CE-E03 readiness regression green | 5/5; Playwright 3/3 (T021/T022) |
| T017 | `apps/api/test/code-execution-output.test.ts` | 7/9 failing (`output.ts` absent; OUT-06/OUT-08 passed vacuously because the undefined validator threw) | 9/9 (T020) |
| T034 (early, needed by the US1 chart/download journey) | `apps/api/test/chat-charts.test.ts` | 4/6 failing (route absent → 404; CH-04/CH-05 passed vacuously as 404s) | 6/6 (T038) |

### T023 — US1 verification (FR-GC-08, FR-GC-02, C-02; SC-001, SC-007)

`pnpm exec vitest run packages/contracts/test/package-v3-2.test.ts apps/api/test/code-execution*.test.ts apps/api/test/chat-charts.test.ts apps/web/test/code-execution.test.ts` and `pnpm exec playwright test apps/web/test/code-execution.spec.ts --project=chromium` (3/3) pass. Verified: population SD of 1..12 within 1e-12 of √(143/12), sample SD of √13, CAGR with explicit `# Unit normalization` comment citing both sources, one `Computed` label per value, `[1]` citation, chart inline + download, collapsed keyboard-accessible "View executed code" drawer, zero sandbox calls and no `running_code` status for a clarification, the follow-up uses the current selection. Model and sandbox are labelled test doubles; the ≤2.5 s browser assertion is against the double (not a provider measurement, see T046).

## Security review findings (2026-10-23) — fixed test-first (CC-02)

| # | Severity | Finding | Resolution | Red → Green evidence |
| :- | :- | :- | :- | :- |
| 1 | HIGH | Citation-badge forgery: `"[[[1]]]".replace(/\[\[/g,"[")` yields `"[[1]]"`, so model text (preamble/answer sentences, clarification question, not-in-sources topic) and sandbox labels/units could forge `[[n]]` badges | Shared `neutralizeMarkers()` (`apps/api/src/chat/sanitize.ts`) collapses `[[`/`]]` until a fixed point and is used by `verifier.ts` (all model text) and `execution/output.ts` (labels/units); the web renderer only turns badge numbers present in the message's own `citations` into buttons | `code-execution-output.test.ts` OUT-10, `code-execution-model.test.ts` MOD-10/MOD-11 Red (`expected 'Sample [[1]]?' not to match /\[\[\d+\]\]/`, two `[[1]]` badges) → Green for `[[[1]]]`, `[[[[1]]]]`, `[ [1] ]`, `[[[[[3]]]]]`. Pre-existing `chat-verifier.test.ts` VER-08 expectation updated from the half-neutralized `"Sneaky [9]] badge."` to `"Sneaky [9] badge."` (stricter, requirement unchanged). |
| 2 | MEDIUM | Fake `(Computed)` label: model/sandbox text containing " (Computed)" would render as a Computed pill | `neutralizeMarkers()` removes any `(Computed)` from model/sandbox text; only `composeComputedAnswer` adds it, and the UI renders pills only for messages whose trace is `Succeeded` | OUT-10, MOD-10/11, `apps/web/test/code-execution.test.ts` WEB-CE-06 Red (2 badges/pill on a trace-less message) → Green |

### Security review round 2 (2026-10-23, shared sanitizer) — fixed test-first

| # | Severity | Finding | Resolution | Evidence |
| :- | :- | :- | :- | :- |
| 3 | HIGH | Deletion-order recombination: removing `(computed)` after bracket collapsing turned `"[(computed)[1](computed)]"` into `"[[1]]"`; `output.ts` stripped `<>` after the helper, so `"[<[1]>]"` became `"[[1]]"` | `neutralizeMarkers()` now only REPLACES (ASCII `[`/`]` → fullwidth `［`/`］`, `<`/`>` → `‹`/`›`, control chars → space, any `(computed)` → `computed`) inside one fixed-point loop; `output.ts` uses the shared `plainLabel()` (helper + whitespace fold + cap) instead of its own ordering. No ASCII bracket survives in model/sandbox text, so no later step can rebuild a badge. | `apps/api/test/chat-sanitize.test.ts` SAN-R2-01/02 Red (`'[(computed)[1](computed)]' → '[[1]]'`, `'sd [[1]]'`) → Green; SAN-R2-03 property test (2,000 generated strings): idempotent, never `/\[\[\d+\]\]/`, never `(Computed)`. The coordinator's literal `"[(computed)[1]]"` happened to be neutralized by the old order (`"[[1]"`), so the variant above was added to observe Red. Expectations of VER-08 and MOD-03 updated to the fullwidth mapping (stricter, requirement unchanged). |


## Partial implementation recovery (2026-10-24; FR-GC-08, FR-GC-06, NFR-EVAL-02/04)

Recovered from Claude's `feat/v3-010-code-execution-sandbox` at `b24e81b` into
`feat/v3-010-recovery` (`/private/tmp/everlast-impl-010-recovery`). The feature pin is
`specs/010-code-execution-sandbox`. The older detached Codex checkout was not the implementation base.
The original Claude checkout and its uncommitted changes were preserved unchanged.

Five uncommitted files were recovered byte-for-byte: API server wiring, DB terminal candidate invalidation,
`apps/api/src/chat/execution/reconcile.ts`, API recovery tests and web retry tests. Their original hashes are
recorded in [recovery-source-manifest.json](evidence/recovery-source-manifest.json).
An additional exact local snapshot is `/private/tmp/everlast-010-claude-recovery-snapshot`.

### Restored behavior and task status

- [010-code-execution-sandbox] T029 is implemented: startup/periodic reconciliation ends expired executions,
  destroys recorded child sandboxes without replay, retries failed deletions, and purges invalidated charts.
  Configured API startup now supplies the managed runtime and storage to ChatService.
- Recovered T026 API and T027 UI tests are retained. Four recovery assertions failed against `b24e81b`
  before restoration (REC-API-02/06/07/08); all 13 recovered assertions pass afterward. The five UI tests
  already passed against the inherited implementation; no new UI Red result is claimed.
- Fixed inherited TypeScript errors: the operation-poll JSON uses the same operation type as creation;
  eval reports explicitly represent a compute intent with empty observation content rather than treating
  it as an executed answer. The published case response remains intact. A new FR-GC-08/NFR-EVAL-02
  regression failed before the report fix (`undefined.content`/`.slice`) and passes afterward.
- Other task markers retain their prior status. This is recovery of the unfinished increment, not a full
  package implementation/convergence assessment. T024–T028, T030–T048 remain unchecked, including broader
  history/scope coverage, benchmark/evaluation work and release evidence. Some code/tests already exist;
  they require verification against those tasks before marking them complete. Package 3.3 remains paused.

### Current verification

Runtime: workspace Node 26.12.1, pnpm 12.0.0, Vitest 4.1.11; local PostgreSQL 16 + pgvector on port 54329.
Model and sandbox in local application tests are test doubles. No cloud provisioning or paid model call.

| Check | Result |
| --- | --- |
| Recovered API recovery and web retry suites | PASS: 13/13; baseline 4 failures / 9 passes |
| Package contract/runtime/model/manifest/output/retry/recovery/DB/UI/chart/sanitization regression | PASS: 127 tests; 11 real-provider tests skipped as UNAVAILABLE |
| Runtime adapter plus eval report unit regression | PASS: 28 tests (18 runtime, 10 report) |
| `pnpm lint` (spec integrity + TypeScript) | PASS after the two inherited type errors were fixed |
| Playwright `apps/web/test/code-execution.spec.ts --project=chromium` | PASS: 3/3; Chromium required execution outside the filesystem sandbox |
| `pnpm eval:deterministic` | PASS deterministic assertions: citation precision 160/160 = 1.0, leakage 0; overall GatePending because judged evidence is unavailable |
| Real managed sandbox / judged Vertex / live performance | UNAVAILABLE, not release acceptance |

Commands use `TEST_DATABASE_URL=postgres://everlast:everlast@127.0.0.1:54329/everlast` for isolated test databases:

```sh
pnpm exec vitest run apps/api/test/code-execution-recovery.test.ts apps/web/test/code-execution-retry.test.ts
pnpm exec vitest run packages/contracts/test/package-v3-2.test.ts apps/api/test/code-execution apps/api/test/chat-charts.test.ts apps/api/test/chat-sanitize.test.ts packages/db/test/code-execution apps/web/test/code-execution
pnpm exec vitest run --project unit packages/evals/test/release-v1.test.ts apps/api/test/code-execution-runtime.test.ts
pnpm lint
E2E_PORT=4329 pnpm exec playwright test apps/web/test/code-execution.spec.ts --project=chromium
pnpm eval:deterministic
```

Local command logs: `/private/tmp/everlast-010-recovery-{red,green,regression,browser,eval}.log`,
`/private/tmp/everlast-010-recovery-lint-final.log`, and `/private/tmp/everlast-010-report-{red,green,final}.log`.
No upstream requirement or acceptance limit changed. The reviewer-owned checklist remains unchanged.

## Complete Package 3.2 Implementation, Hardening & Gate Evidence (2026-10-24; `[010-code-execution-sandbox] T024`–`T048`)

Completed in dedicated worktree `/private/tmp/everlast-impl-010-complete` on branch `feat/v3-010-complete` (branched from `497c21e36c66b0b11103bfc575464973115dc6bc`).

### US2, US3, and Phase 6 Red → Green Record (`CC-02`)

| Task | Test file(s) | Red / Baseline Observed | Green |
| :--- | :--- | :--- | :--- |
| `T024`, `T028` | `apps/api/test/code-execution-retry.test.ts` | Inherited from base commit (`9/9` passing against `controller.ts`); verified against all 9 retry/deadline/OOM/storage/transport/citation/network/create-failure/immutable-input assertions | 9/9 |
| `T025` | `apps/api/test/code-execution-runtime.integration.test.ts` | Live managed sandbox opt-in (`CODE_EXECUTION_IT=1` + `CODE_EXECUTION_REASONING_ENGINE`); truthfully skipped with `UNAVAILABLE` warning when unconfigured | 11 skipped (`UNAVAILABLE`) |
| `T026`, `T029` | `packages/db/test/code-execution-recovery.integration.test.ts`, `apps/api/test/code-execution-recovery.test.ts` | 4/8 failing before recovery (`REC-API-02/06/07/08`); hardened `controller.ts` with `try/catch` lease abandonment (`this.abandon(...)`) on unexpected storage/runtime errors and `ChatService.abortNotebook(notebookId)` on `DELETE /api/notebooks/:id` (`T039`) | 5/5 DB, 8/8 API |
| `T027`, `T030` | `apps/web/test/code-execution-retry.test.ts` | Inherited 5/5; verified ordered attempts, `Final attempt` badge, `Published` chart badge, and escaped stderr/error rendering | 5/5 |
| `T032`, `T036` | `apps/api/test/code-execution-scope.test.ts` | Created 8 scoped publication tests (`CE-SCP-01..08`): empty/foreign scope, unselected/removed/foreign decoys (`OBSIDIAN`), mid-flight checkbox changes, mid-flight `commitSyncReplacement` and `deleteSource` fences, invalid citation refusal, Overview/Guide cache-key isolation, deselected history exclusion | 8/8 |
| `T033`, `T036`, `T037` | `packages/db/test/code-execution-history.integration.test.ts` | Created 6 DB history/projection tests (`CE-HIST-DB-01..06`): nullable legacy/clarification traces, reload fidelity, deselection viewability vs `listEligibleHistory` exclusion, synchronous `deleteSource` chart invalidation (`packages/db/src/source-sync.ts`), atomic publish + `clearThread` hygiene (feedback/follow-ups), cross-pool isolation | 6/6 |
| `T034`, `T038`, `T040` | `apps/api/test/chat-charts.test.ts`, `apps/web/test/code-execution.test.ts` | Added `CH-07` (revoked source → `410`) and `CH-08` (unsatisfiable byte range → `416` with `Content-Range: bytes */N`); added `WEB-CE-07` (`disposeCodeExecution` revokes blob URLs and clears DOM via `clear(element)` in `apps/web/src/chat/code-execution.ts`, which initially failed in `MockElement` when using `replaceChildren()`) | 8/8 API, 7/7 Web |
| `T035`, `T037`, `T040` | `apps/api/test/code-execution-v2-compatibility.test.ts`, `apps/web/test/code-execution-history.spec.ts` | Created `CE-V2-01..03` (saved-response note conversion strips badges and excludes traces/code/chart URLs; feedback/follow-ups on computed turns; overview/studio isolation) and Playwright `CE-HIST-E01..03` (2-attempt retry reload + save-to-note, overlap draft preservation during `running_code`, clear-chat cancellation) | 3/3 API, 3/3 Playwright |
| `T042` | `packages/evals/test/code-execution.eval.test.ts` | Initial run: 2/4 failed (`CE-EVAL-02` trace shape on post-execution `CitationInvalid`, `CE-EVAL-03` repair hook `correctCode` vs `generate`); updated to match exact `ChatService`/`GroundedModel.correctCode` contracts | 4/4 |
| `T043`, `T044` | `packages/evals/test/code-execution-performance.test.ts`, `packages/evals/src/code-execution-performance.ts`, `scripts/eval-v3-code-execution.mjs` | **Red observed**: 7/7 tests failed (`CE-PERF-01..07`) against stubbed `code-execution-performance.ts` before implementing nearest-rank P95 (`Math.ceil(0.95 * N)`), cohort plan validation, failure-fails-cohort accounting, `UNAVAILABLE` on missing samples, and separate retry summary | 7/7 unit; CLI exits `2` (`[UNAVAILABLE]`) without live sandbox |

### Hardening & Implementation Refinements (`[010-code-execution-sandbox] T036`–`T040`, `T044`, `T045`)

1. **Controller Lease Safety (`apps/api/src/chat/execution/controller.ts`)**: Wrapped the execution loop in `try/catch` so unexpected storage or runtime exceptions call `this.abandon(admitted.execution.id, admitted.execution.lease_token, activeHandle)` and release the single-flight notebook lease immediately.
2. **Synchronous Chart Invalidation on Source Deletion (`packages/db/src/source-sync.ts`)**: `deleteSource` now synchronously marks `chart_artifacts` in that notebook whose `source_snapshot` references the deleted `sourceId` as `state = 'invalidated'`, matching `deleteNotebook`'s synchronous invalidation.
3. **Notebook Deletion Active Cancellation (`apps/api/src/chat/service.ts`, `apps/api/src/routes/notebooks.ts`)**: Added `ChatService.abortNotebook(notebookId)` and wired `DELETE /api/notebooks/:id` to abort any in-flight code execution before deleting the notebook.
4. **Web Revocation Cleanup (`apps/web/src/chat/code-execution.ts`)**: `disposeCodeExecution` uses `clear(element)` from `../lib/dom.ts` after revoking `blob:` object URLs so both browser DOM and `MockElement` unit tests cleanly remove rendered chart/trace nodes.
5. **Judged Eval Precheck (`packages/evals/src/cli.ts`)**: `pnpm eval:judged` validates `vertexConfigFromEnv()` before opening the test database and exits `2` with `[UNAVAILABLE]` when `VERTEX_PROJECT`/`GCP_PROJECT_ID` is unset.

### Final Verification Summary (`[010-code-execution-sandbox] T047`)

Full Gate v3.0 #2 evidence, cohort tables, and the 50-case stratified sample are recorded in [gate-v3-code-execution.md](evidence/gate-v3-code-execution.md).

| Command | Result |
| :--- | :--- |
| `node scripts/check-spec-integrity.mjs` | **PASS** |
| `git diff --check` | **PASS** |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | **PASS** / **PASS** / **PASS** |
| `pnpm test:contract` | **PASS** (15 files / 252 tests, including `package-v3-2.test.ts` 14/14) |
| `pnpm test:unit` | **PASS** (28 files / 382 tests, including all Package 3.2 unit & performance suites) |
| Package 3.2 integration suites (`packages/db/test/code-execution*.ts`, `apps/api/test/code-execution*.ts`, `apps/api/test/chat-charts.test.ts`, `apps/web/test/code-execution*.ts`, `packages/evals/test/code-execution.eval.test.ts`) | **PASS** (86 passed across 12 files; 11 live-sandbox tests in `code-execution-runtime.integration.test.ts` skipped as `UNAVAILABLE`) |
| `E2E_PORT=4329 pnpm exec playwright test apps/web/test/code-execution.spec.ts apps/web/test/code-execution-history.spec.ts --project=chromium` | **PASS** (6/6) |
| `pnpm eval:deterministic` | **PASS** (exit `0`; `citation_precision = 1.0` `160/160`, `scoping_leakage_count = 0`) |
| `pnpm eval:v3-code-execution` | **UNAVAILABLE** (exit `2`: live Agent Platform sandbox not configured) |
| `pnpm eval:judged` | **UNAVAILABLE** (exit `2`: `VERTEX_PROJECT` / live Vertex release environment not configured) |
| `(cd infra/modules/code_execution && tofu init -backend=false && tofu test)` | **PASS** (4/4) |


## PR #159 review fixes (2026-10-24; FR-GC-08, NFR-SEC-02, D20)

- Fixed SVG external-resource checks bypassed by XML character references and split style tokens. Decode before validation and reject ambiguous style token boundaries; retain safe local references and escaped labels.
- Fixed premature cleanup confirmation: DELETE operation acceptance or an operation error no longer marks a sandbox destroyed. Poll to successful completion or keep cleanup pending.
- Bounded deletion to 5 seconds, including stalled credential acquisition and response reads, so execution timeout reporting and reconciliation cannot hang on the provider delete call.
- Red: new regression tests reproduced encoded resource acceptance, split style tokens, premature deletion confirmation, failed-operation acceptance, and stalled deletion. Green: 381 unit tests (28 files), 86 integration tests (12 files), and 6 Chromium journeys pass. Unit coverage includes the contract suites.
- Build, lint/type checking, spec integrity (190 Markdown files / 55 SRS IDs / 39 feature artifacts), and whitespace checks pass. Deterministic eval: citation precision 160/160, scope leakage 0, adversarial out-of-prompt drafts published 0/60.
- Live sandbox integration: UNAVAILABLE (11 tests skipped; no configured Agent Platform runtime). Judged Vertex metrics and live provider performance remain unverified; this review does not assert release-gate completion.
