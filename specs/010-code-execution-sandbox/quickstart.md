# Quickstart Validation: Quantitative Code Execution Sandbox

Scope: FR-GC-08, C-01/C-02, NFR-EVAL-01..04, NFR-SEC-01/02, Gate v3.0 #2. This is a validation guide, not implementation code. The owner requires strict-cap R6 qualification before completion; this document cannot certify R6 or the release gate.

## Current runnable checks (CC-01/CC-02)

From this dedicated worktree, verify `.specify/feature.json` selects `specs/010-code-execution-sandbox`. Stage generated planning files before integrity checking, because the checker enumerates Git-tracked files.

```sh
node scripts/check-spec-integrity.mjs
git diff --check
```

No cloud API is enabled or deployed here. Existing test runners exist, but package 3.2 tests, deployed sandbox, production startup/migration wiring and R6 evidence are UNAVAILABLE. Do not report broad existing suite passes as sandbox acceptance. `pnpm dev` and `pnpm db:migrate` currently print placeholder readiness messages; they are not deployment/setup instructions.

## Implementation-time prerequisites (FR-GC-08, NFR-SEC-01/02)

Require recorded Gate v2 acceptance, package 3.1 C-01/C-02 compatibility, resolved runtime design, isolated test project/credentials, OpenTofu-provisioned EU services after owner-approved API enablement, database migration and real API/web startup entrypoints. Pin runtime/package versions and required preinstalled libraries. Configure no-network isolation and strict caps before running untrusted code. Use synthetic fixtures only during qualification. A single test service credential stays outside the sandbox; code receives no credentials or bucket URLs.

For each scenario below, derive a failing Vitest/Playwright test with cited IDs before its implementation; record expected failure, implement, rerun and retain evidence. Install pinned workspace dependencies with `pnpm install --frozen-lockfile`. Once the named files exist, run:

```sh
pnpm exec vitest run packages/contracts/test/package-v3-2.test.ts apps/api/test/code-execution.test.ts packages/db/test/code-execution.integration.test.ts
pnpm exec playwright test tests/e2e/code-execution.spec.ts --project=chromium
pnpm eval:deterministic
pnpm eval:judged
```

These new test paths are planned, not present. Missing files/harness/environment mean UNAVAILABLE, not success. Follow the actual migration/startup commands delivered by implementation, not the current placeholders.

## Acceptance scenarios (FR-GC-08, NFR-EVAL-01..04)

| Scenario | Procedure and expected result |
| --- | --- |
| Exact computation | Upload a supported PDF with 12 monthly values 1 through 12; select it; request population standard deviation and trend chart. Expect sqrt(143/12), numeric representation matching sandbox output, Computed label, chart download, code/stdout and valid citation. Sample variant expects sqrt(13). Use explicit numerical comparison tolerance justified by representation in tests; never compare only model prose. |
| Ambiguous intent | Ask standard deviation without specifying sample/population and omit that information from source. Expect focused question, zero sandbox calls/status; answer population using explicit current source selection and expect correct computation. |
| Units | Two financial report fixtures use millions/billions. CAGR request shows explicit normalization in code comments, exact execution value and both input citations. |
| Retry | First code raises a Python exception, correction succeeds. Exactly two attempts in order after reload; final attempt and outputs marked, failed artifacts not published. Second exception ends with error/no number. |
| Limits | Measure CPU ≤1 vCPU, RAM ≤512 MB, /tmp ≤64 MB. Infinite loop killed at 15.0s, OOM/timeout produce zero retry and confirmed sandbox destruction. Test under-limit, boundary and over-limit disk/memory, and verify input cannot be changed. |
| Isolation | Try HTTP, DNS, metadata/private addresses, inbound contact, host filesystem escape and cross-execution state. No successful network flow/packets, unauthorized bytes or persisted state. Collect actual selected-runtime observations, not only mock exceptions. |
| Scope changes | Empty selection rejected; decoy/unselected/notebook-other data absent. Change checkboxes during execution: original snapshot stays fixed. Replace/delete/revoke captured revision: no late publication or stale charts, including drawer/error snippets. |
| Invalid citation | Corrupt a returned chunk ID before publication; immediate refusal with no stripped draft or answer retry. Citation-ID precision 1.0; leakage 0. |
| History/download | Mere deselection preserves authorized old history; follow-up excludes it. Revoke/delete source: history, both traces, caches and chart URLs become unavailable. Check direct/range download, SVG active content, expired/cross-notebook identifiers. |
| Cancellation | Clear chat during either attempt; terminate execution, fence callbacks using generation_epoch, no re-created message or retained downloadable artifact. |
| UI/latency | Truthful Running code… ≤2.5s from sufficient-intent submission; keyboard-accessible code drawer and download; no computation progress on clarification. |

## R6 and timing evidence (FR-GC-08, NFR-PERF-01)

Record runtime identity/config, versions, region, exact memory units, enforced controls, destruction evidence and packet-observation method. Separate the known managed configuration mismatch from empirical results. Require contract-equivalent testing for fallback; disabling a Python import or JavaScript worker separation is insufficient.

Declare standard-tabular fixtures, cold/warm categories, concurrency, measurement window and percentile estimator before testing. Measure from sandbox creation request through execution completion, including cold/warm boot, and require ≤4.0s P95; report both strata. Measure submission-to-real-running-code independently (≤2.5s). Retry end-to-end time is reported separately and never silently removed from trace evidence. Progress is not answer TTFT; package 3.4 owns integrated NFR-PERF-01 measurements. Judged hallucination <5%, rejection ≥99% and semantic citation support supplement deterministic precision/leakage checks; no isolated package result certifies the full release.
