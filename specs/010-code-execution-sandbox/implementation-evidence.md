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
