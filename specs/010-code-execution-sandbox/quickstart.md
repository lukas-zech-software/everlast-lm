# Quickstart Validation: Quantitative Code Execution Sandbox

Scope: FR-GC-08, C-01/C-02, NFR-EVAL-01..04, NFR-SEC-01/02, Gate v3.0 #2. This is a validation guide, not implementation code. D18 selects the managed default; design is complete, while this document cannot certify R6 or the release gate.

## Current runnable checks (CC-01/CC-02)

From this dedicated worktree, verify `.specify/feature.json` selects `specs/010-code-execution-sandbox`. Stage generated planning files before integrity checking, because the checker enumerates Git-tracked files.

```sh
node scripts/check-spec-integrity.mjs
git diff --check
```

No cloud API is enabled or deployed here. Existing test runners exist, but package 3.2 tests, deployed sandbox, sandbox-specific startup/migration wiring and R6 evidence are UNAVAILABLE. Do not report broad existing suite passes as sandbox acceptance. `pnpm dev` now starts the real local PostgreSQL/API/web/worker path; `pnpm db:migrate` applies migrations. Neither supplies managed sandbox execution or R6 evidence. `pnpm dev -- --offline` uses a test embedder and returns chat-not-configured errors instead of fabricated answers.

## Implementation-time prerequisites (FR-GC-08, NFR-SEC-01/02)

Require recorded Gate v2 acceptance, package 3.1 C-01/C-02 compatibility, the D18 managed-default runtime design, isolated test project/credentials, OpenTofu-provisioned EU services after owner-approved API enablement, database migration and real API/web startup entrypoints. Pin runtime/package versions and required preinstalled libraries. Configure no-network isolation and strict caps before running untrusted code. Use synthetic fixtures only during qualification. A single test service credential stays outside the sandbox; code receives no credentials or bucket URLs.

For each scenario below, derive a failing Vitest/Playwright test with cited IDs before its implementation; record expected failure, implement, rerun and retain evidence. Install pinned workspace dependencies with `pnpm install --frozen-lockfile`. Once the named files exist, run:

```sh
pnpm exec vitest run packages/contracts/test/package-v3-2.test.ts apps/api/test/code-execution.test.ts packages/db/test/code-execution.integration.test.ts
pnpm exec playwright test tests/e2e/code-execution.spec.ts --project=chromium
pnpm eval:deterministic
pnpm eval:judged
```

These new test paths are planned, not present. Missing files/harness/environment mean UNAVAILABLE, not success. Use `TEST_DATABASE_URL` for evals and an isolated PostgreSQL instance (`pnpm db:test:up`); real judged runs additionally require approved Vertex/ADC. Never substitute a passing baseline test run for sandbox acceptance.

## Acceptance scenarios (FR-GC-08, NFR-EVAL-01..04)

| Scenario | Procedure and expected result |
| --- | --- |
| Exact computation | Upload a supported PDF with 12 monthly values 1 through 12; select it; request population standard deviation and trend chart. Expect sqrt(143/12), numeric representation matching sandbox output, Computed label, chart download, code/stdout and valid citation. Sample variant expects sqrt(13). Use explicit numerical comparison tolerance justified by representation in tests; never compare only model prose. |
| Ambiguous intent | Ask standard deviation without specifying sample/population and omit that information from source. Expect focused question, zero sandbox calls/status; answer population using explicit current source selection and expect correct computation. |
| Units | Two financial report fixtures use millions/billions. CAGR request shows explicit normalization in code comments, exact execution value and both input citations. |
| Retry | First code raises a Python exception, correction succeeds. Exactly two attempts in order after reload; final attempt and outputs marked, failed artifacts not published. Second exception ends with error/no number. |
| Limits | Measure CPU ≤2 vCPU, RAM ≤1.5 GB, /tmp ≤64 MB. Infinite loop killed at 15.0s, OOM/timeout produce zero retry and confirmed sandbox destruction. Test under-limit, boundary and over-limit disk/memory, and verify input cannot be changed. |
| Isolation | Try HTTP, DNS, metadata/private addresses, inbound contact, host filesystem escape and cross-execution state. No successful network flow/packets, unauthorized bytes or persisted state. Collect actual selected-runtime observations, not only mock exceptions. |
| Scope changes | Empty selection rejected; decoy/unselected/notebook-other data absent. Change checkboxes during execution: original snapshot stays fixed. Replace/delete/revoke captured revision: no late publication or stale charts, including drawer/error snippets. |
| Invalid citation | Corrupt a returned chunk ID before publication; immediate refusal with no stripped draft or answer retry. Citation-ID precision 1.0; leakage 0. |
| History/download | Mere deselection preserves authorized old history; follow-up excludes it. Revoke/delete source: history, both traces, caches and chart URLs become unavailable. Check direct/range download, SVG active content, expired/cross-notebook identifiers. |
| Cancellation | Clear chat during either attempt; terminate execution, fence callbacks using generation_epoch, no re-created message or retained downloadable artifact. |
| UI/latency | Truthful Running code… ≤2.5s from sufficient-intent submission; keyboard-accessible code drawer and download; no computation progress on clarification. |

## R6 and timing evidence (FR-GC-08, NFR-PERF-01)

Record runtime identity/config, versions, region, exact memory units, enforced controls, destruction evidence and packet-observation method. The former managed CPU/RAM mismatch is resolved by D18; exact retained-control enforcement still needs empirical evidence. Verify the default profile, not the larger optional machine. Fallback requires contract-equivalent qualification; disabling a Python import or JavaScript worker separation is insufficient.

Declare standard-tabular fixtures, cold/warm categories, concurrency, measurement window and percentile estimator before testing. Measure from sandbox creation request through execution completion, including cold/warm boot, and require ≤4.0s P95; report both strata. Measure submission-to-real-running-code independently (≤2.5s). Retry end-to-end time is reported separately and never silently removed from trace evidence. Progress is not answer TTFT; package 3.4 owns integrated NFR-PERF-01 measurements. Judged hallucination <5%, rejection ≥99% and semantic citation support supplement deterministic precision/leakage checks; no isolated package result certifies the full release.

## Updated main validation obligations (2026-10-21; FR-GC-08, NFR-EVAL-01..04)

Derive tests at the actual chat `/chat/turns` route and ChatService/AdkGroundedModel boundary. Cover strict clarification output (zero sandbox calls), status field serialization, persisted/reloaded traces through every current response projection, request replay/overlap/crash fences, and missing-table-row evidence refusal or complete scoped retrieval. Include baseline saved-response conversion compatibility without exposing invalidated trace bytes. Main's current dev/migrate scripts are real; sandbox-specific scenarios listed above are planned and UNAVAILABLE.

Run `pnpm eval:deterministic` on every PR once the isolated DB and harness are available. Run `pnpm eval:judged` once on each release candidate's fixed deterministic stratified 50-case sample, recording case IDs, category composition and dataset hash; the single passing run satisfies that gate. Judged suites are not required per PR. These commands exist but were not executed in this documentation refresh; no new runtime/eval result is claimed.

## Second refresh validation delta (FR-GC-08, FR-GC-06, C-02, NFR-EVAL-04)

Future package tests must use the applied 0005–0008 baseline plus new ordered sandbox migrations. Cover owning-app database context through asynchronous v2 consumers, visible-message projection after restart/revocation, and clear-chat removal/invalidation of trace/chart dependencies alongside feedback/follow-ups. Preserve disabled Send until sources/history load; a later quantitative/clarification reply must use current explicit scope. Exercise sandbox crash/unknown-outcome reconciliation separately from v2 report/Guide startup recovery. Existing v2 durability does not prove sandbox admission, resource enforcement or provider termination. These are future package assertions, not newly executed runtime checks.

## Final main baseline (ce3626b; FR-GC-08, CC-02, CC-08)

Use the workspace-selected Node 26 runtime. API infrastructure sets `MIGRATE_ON_START=true`: pending application migrations run at startup before traffic admission; the advisory-locked runner applies each file once. Future sandbox migrations must extend the numbered migration sequence and preserve compatibility with the previous revision when a new revision fails readiness. General startup migration wiring is present; sandbox-specific schema and recovery remain unimplemented. The changed dev project example is configuration guidance, not an approval to enable APIs or deploy the sandbox.
