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
