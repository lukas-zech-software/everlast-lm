# Quickstart Validation: Quantitative Code Execution Sandbox

Scope: FR-GC-08, C-01/C-02, NFR-EVAL-01..04, NFR-SEC-01/02, Gate v3.0 #2. This is a validation guide, not implementation code. D18 selects the managed default and D19 accepts the provider, making R6 obsolete. Normal integration tests and the release gate remain.

## Current runnable checks (CC-01/CC-02)

From this dedicated worktree, verify `.specify/feature.json` selects `specs/010-code-execution-sandbox`. Stage generated planning files before integrity checking, because the checker enumerates Git-tracked files.

```sh
node scripts/check-spec-integrity.mjs
git diff --check
```

Package 3.2 contract, runtime, API, database, browser and aggregation tests are implemented; the dated verification records below distinguish their local-double results from live managed-service acceptance. No API enablement or deployment was performed by this execution. The managed sandbox and live integration results remain UNAVAILABLE until the prerequisites below are supplied. Do not report broad existing suite passes as sandbox acceptance. `pnpm dev` now starts the real local PostgreSQL/API/web/worker path; `pnpm db:migrate` applies migrations. Neither supplies managed sandbox execution or its integration results. `pnpm dev -- --offline` uses a test embedder and returns chat-not-configured errors instead of fabricated answers.

## Implementation-time prerequisites (FR-GC-08, NFR-SEC-01/02)

Require recorded Gate v2 acceptance, package 3.1 C-01/C-02 compatibility, the D18 managed-default runtime design, isolated test project/credentials, OpenTofu-provisioned EU services after owner-approved API enablement, database migration and real API/web startup entrypoints. Pin runtime/package versions and required preinstalled libraries. Configure no-network isolation and strict caps before running untrusted code. Use synthetic fixtures for integration and security tests. A single test service credential stays outside the sandbox; code receives no credentials or bucket URLs.

For each scenario below, derive a failing Vitest/Playwright test with cited IDs before its implementation; record expected failure, implement, rerun and retain evidence. Install pinned workspace dependencies with `pnpm install --frozen-lockfile`. Once the named files exist, run:

```sh
pnpm exec vitest run packages/contracts/test/package-v3-2.test.ts apps/api/test/code-execution.test.ts packages/db/test/code-execution.integration.test.ts
pnpm exec playwright test apps/web/test/code-execution.spec.ts --project=chromium
pnpm eval:deterministic
pnpm eval:judged
```

These test paths exist. A missing target environment means UNAVAILABLE, not success. Use `TEST_DATABASE_URL` for evals and an isolated PostgreSQL instance (`pnpm db:test:up`); real judged runs additionally require approved Vertex/ADC. Never substitute a passing baseline test run for sandbox acceptance.

## Acceptance scenarios (FR-GC-08, NFR-EVAL-01..04)

| Scenario | Procedure and expected result |
| --- | --- |
| Exact computation | Upload a supported PDF with 12 monthly values 1 through 12; select it; request population standard deviation and trend chart. Expect sqrt(143/12), numeric representation matching sandbox output, Computed label, chart download, code/stdout and valid citation. Sample variant expects sqrt(13). Use explicit numerical comparison tolerance justified by representation in tests; never compare only model prose. |
| Ambiguous intent | Ask standard deviation without specifying sample/population and omit that information from source. Expect focused question, zero sandbox calls/status; answer population using explicit current source selection and expect correct computation. |
| Units | Two financial report fixtures use millions/billions. CAGR request shows explicit normalization in code comments, exact execution value and both input citations. |
| Retry | First code raises a Python exception, correction succeeds. Exactly two attempts in order after reload; final attempt and outputs marked, failed artifacts not published. Second exception ends with error/no number. |
| Limits | Use the managed limits (D20): 2 vCPU / 1.5 GB profile, 100 MB file I/O cap. Infinite loop abandoned at the 15.0s application deadline with sandbox deletion and late results discarded; OOM/timeout produce zero retry. Test under-limit, boundary and over-limit disk/memory, and verify input cannot be changed. |
| Isolation | Try HTTP, DNS, metadata/private addresses, inbound contact, host filesystem escape and cross-execution state. No successful network call from executed code, no unauthorized bytes and no persisted state; packet capture is not required (D20). Collect actual selected-runtime observations, not only mock exceptions. |
| Scope changes | Empty selection rejected; decoy/unselected/notebook-other data absent. Change checkboxes during execution: original snapshot stays fixed. Replace/delete/revoke captured revision: no late publication or stale charts, including drawer/error snippets. |
| Invalid citation | Corrupt a returned chunk ID before publication; immediate refusal with no stripped draft or answer retry. Citation-ID precision 1.0; leakage 0. |
| History/download | Mere deselection preserves authorized old history; follow-up excludes it. Revoke/delete source: history, both traces, caches and chart URLs become unavailable. Check direct/range download, SVG active content, expired/cross-notebook identifiers. |
| Cancellation | Clear chat during either attempt; terminate execution, fence callbacks using generation_epoch, no re-created message or retained downloadable artifact. |
| UI/latency | Truthful Running code… ≤2.5s from sufficient-intent submission; keyboard-accessible code drawer and download; no computation progress on clarification. |

## Integration and timing evidence (FR-GC-08, NFR-PERF-01, D19)

Record runtime identity/config, versions, region and observed results during normal implementation/release tests. D19 accepts the Google managed sandbox as the service dependency; R6 is obsolete, with no separate provider spike, qualification dossier or pre-implementation test deployment. Use the D18 default profile. Keep the existing behavior, cleanup and timing assertions; this owner decision supplies no fabricated measurement or release pass.

Declare standard-tabular fixtures, cold/warm categories, concurrency, measurement window and percentile estimator before testing. Measure from sandbox creation request through execution completion, including cold/warm boot, and require ≤4.0s P95; report both strata. Measure submission-to-real-running-code independently (≤2.5s). Retry end-to-end time is reported separately and never silently removed from trace evidence. Progress is not answer TTFT; package 3.4 owns integrated NFR-PERF-01 measurements. Judged hallucination <5%, rejection ≥99% and semantic citation support supplement deterministic precision/leakage checks; no isolated package result certifies the full release.

## Updated main validation obligations (2026-10-21; FR-GC-08, NFR-EVAL-01..04)

Derive tests at the actual chat `/chat/turns` route and ChatService/AdkGroundedModel boundary. Cover strict clarification output (zero sandbox calls), status field serialization, persisted/reloaded traces through every current response projection, request replay/overlap/crash fences, and missing-table-row evidence refusal or complete scoped retrieval. Include baseline saved-response conversion compatibility without exposing invalidated trace bytes. Main's current dev/migrate scripts are real; sandbox-specific scenarios listed above are planned and UNAVAILABLE.

Run `pnpm eval:deterministic` on every PR once the isolated DB and harness are available. Run `pnpm eval:judged` once on each release candidate's fixed deterministic stratified 50-case sample, recording case IDs, category composition and dataset hash; the single passing run satisfies that gate. Judged suites are not required per PR. These commands exist but were not executed in this documentation refresh; no new runtime/eval result is claimed.

## Second refresh validation delta (FR-GC-08, FR-GC-06, C-02, NFR-EVAL-04)

Future package tests must use the applied 0005–0008 baseline plus new ordered sandbox migrations. Cover owning-app database context through asynchronous v2 consumers, visible-message projection after restart/revocation, and clear-chat removal/invalidation of trace/chart dependencies alongside feedback/follow-ups. Preserve disabled Send until sources/history load; a later quantitative/clarification reply must use current explicit scope. Exercise sandbox crash/unknown-outcome reconciliation separately from v2 report/Guide startup recovery. Existing v2 durability does not prove sandbox admission, resource enforcement or provider termination. These are future package assertions, not newly executed runtime checks.

## Final main baseline (ce3626b; FR-GC-08, CC-02, CC-08)

Use the workspace-selected Node 26 runtime. API infrastructure sets `MIGRATE_ON_START=true`: pending application migrations run at startup before traffic admission; the advisory-locked runner applies each file once. Future sandbox migrations must extend the numbered migration sequence and preserve compatibility with the previous revision when a new revision fails readiness. General startup migration wiring is present; sandbox-specific schema and recovery are implemented in migration 0010 and the execution reconciler. The changed dev project example is configuration guidance, not an approval to enable APIs or deploy the sandbox.

## Task-analysis command and timing corrections (FR-GC-08, CC-01/02)

Task generation reserves 0010_code_execution.sql after predecessor 0009. New browser files belong in apps/web/test under the existing Playwright config. Validation uses the exact task paths; the eval/performance suites and scripts/eval-v3-code-execution.mjs exist. The script aggregates supplied observations and does not itself collect live measurements. Freeze cohort sample counts, fixtures and runtime configuration before collecting data; nearest-rank P95 uses ceil(0.95*N), any failed/timeout attempt fails its cohort, and missing declared samples are UNAVAILABLE. Record all attempts and retry totals; never drop failures/reset the submission clock or treat progress as answer TTFT. These are ordinary integration/release tests under D19.

## Implementation prerequisites record (2026-10-23; [010-code-execution-sandbox] T001, T003)

Recorded in [implementation-evidence.md](implementation-evidence.md#t001--preconditions-fr-gc-08-c-01c-02-gate-v30): Gate v2 owner override (limits retained), package 3.1 handoff consumed unchanged, D18/D19/D20 in force. UNAVAILABLE: the managed Agent Platform sandbox (no owner-approved parent runtime/configuration), judged evals (no authorized paid Vertex run), live latency cohorts.

Exact commands (T003; unit and integration projects stay separate, Playwright `testDir` is `apps/web/test`):

```sh
export TEST_DATABASE_URL=postgres://everlast:everlast@127.0.0.1:54329/everlast   # pnpm db:test:up
pnpm exec vitest run --project unit packages/contracts/test/package-v3-2.test.ts apps/api/test/code-execution-runtime.test.ts apps/api/test/code-execution-manifest.test.ts apps/api/test/code-execution-output.test.ts apps/api/test/code-execution-model.test.ts packages/evals/test/code-execution-performance.test.ts
pnpm exec vitest run --project integration packages/db/test/code-execution.integration.test.ts packages/db/test/code-execution-recovery.integration.test.ts packages/db/test/code-execution-history.integration.test.ts apps/api/test/code-execution.test.ts apps/api/test/code-execution-retry.test.ts apps/api/test/code-execution-recovery.test.ts apps/api/test/code-execution-scope.test.ts apps/api/test/code-execution-v2-compatibility.test.ts apps/api/test/chat-charts.test.ts apps/web/test/code-execution.test.ts apps/web/test/code-execution-retry.test.ts packages/evals/test/code-execution.eval.test.ts
pnpm exec vitest run --project integration apps/api/test/code-execution-runtime.integration.test.ts   # live sandbox; UNAVAILABLE unless CODE_EXECUTION_IT=1 + approved runtime
pnpm exec playwright test apps/web/test/code-execution.spec.ts apps/web/test/code-execution-history.spec.ts --project=chromium
(cd infra/modules/code_execution && tofu init -backend=false && tofu test)
```


## Recovery checkpoint (2026-10-24; FR-GC-08, NFR-EVAL-02/04)

The interrupted package 3.2 increment is recovered on `feat/v3-010-recovery`.
See [implementation evidence](implementation-evidence.md#partial-implementation-recovery-2026-10-24-fr-gc-08-fr-gc-06-nfr-eval-0204)
for source provenance, Red/Green results, exact validation commands and remaining task boundaries.
This checkpoint does not establish completion of package 3.2 or Gate v3.0.

## US2, US3, and Phase 6 Verification Record (2026-10-24; [010-code-execution-sandbox] T031, T041, T045, T047)

Executed on branch `feat/v3-010-complete` (`/private/tmp/everlast-impl-010-complete`) against PostgreSQL 16 + pgvector (`TEST_DATABASE_URL=postgres://everlast:everlast@127.0.0.1:54329/everlast`). Full Gate v3.0 #2 report is retained in [gate-v3-code-execution.md](evidence/gate-v3-code-execution.md).

### US2 Verification (`[010-code-execution-sandbox] T031`; `FR-GC-08`, `NFR-SEC-01/02`; `SC-002`, `SC-004`, `SC-007`)

- `pnpm exec vitest run apps/api/test/code-execution-retry.test.ts apps/api/test/code-execution-recovery.test.ts apps/web/test/code-execution-retry.test.ts packages/db/test/code-execution-recovery.integration.test.ts`: **PASS** (29/29 tests across 4 files).
  - Verified: 1 automatic self-correction retry after a first Python exception in a fresh sandbox with byte-identical `data.json`; both attempts retained in execution order with only the final attempt published; 2nd exception is terminal without a 3rd attempt; 0 retries on 15.0 s deadline (`ExecutionTimeout`), `MemoryLimitExceeded`, `TemporaryStorageLimit`, `ExecutionOutcomeUnknown`, `InvalidOutput` (`NaN`), or `CitationInvalid`; controller `try/catch` abandons the lease on unexpected storage/runtime errors; startup/periodic reconciliation expires stale leases, destroys orphan sandboxes idempotently without Python replay, and purges invalidated chart blobs.
- `pnpm exec vitest run apps/api/test/code-execution-runtime.integration.test.ts`: **UNAVAILABLE** (11/11 live provider tests skipped with warning `UNAVAILABLE: managed sandbox integration (set CODE_EXECUTION_IT=1 and CODE_EXECUTION_REASONING_ENGINE)`). Owner acceptance under D19 is not treated as measured runtime pass.

### US3 Verification (`[010-code-execution-sandbox] T041`; `FR-GC-08`, `FR-GC-06`, `C-02`, `NFR-EVAL-02/04`; `SC-005`, `SC-007`)

- `pnpm exec vitest run apps/api/test/code-execution-scope.test.ts packages/db/test/code-execution-history.integration.test.ts apps/api/test/chat-charts.test.ts apps/api/test/code-execution-v2-compatibility.test.ts apps/web/test/code-execution.test.ts`: **PASS** (32/32 tests across 5 files).
  - Verified: empty scope rejected (`400`), foreign/unowned source scope rejected (`403`), unselected/removed/foreign decoys (`OBSIDIAN`) never enter retrieval, prompt, `data.json`, code, or response; mid-flight checkbox changes do not mutate the captured snapshot; mid-flight source re-sync or deletion aborts publication (`StaleSnapshot`) and invalidates candidate charts; synchronous `deleteSource` marks dependent `chart_artifacts` as `invalidated` (`410`) and hides historical messages/traces in `listVisibleMessages`; `DELETE /api/notebooks/:id` aborts in-flight executions; direct and byte-range (`206`/`416`) chart downloads enforce owner auth and `no-store`; saved-response note conversion strips `[[n]]` badges and never leaks Python code, stdout, stderr, or private chart URLs; two independent app DB pools have zero cross-pool visibility.
- `E2E_PORT=4329 pnpm exec playwright test apps/web/test/code-execution.spec.ts apps/web/test/code-execution-history.spec.ts --project=chromium`: **PASS** (6/6 Chromium E2E tests: `CE-E01..03`, `CE-HIST-E01..03`).

### Phase 6 Integrated Evaluation & Benchmark Verification (`[010-code-execution-sandbox] T045`, `T046`, `T047`)

- `pnpm exec vitest run packages/evals/test/code-execution-performance.test.ts`: **PASS** (7/7 unit tests; Red observed on all 7 tests before implementing `packages/evals/src/code-execution-performance.ts`).
- `pnpm exec vitest run packages/evals/test/code-execution.eval.test.ts`: **PASS** (4/4 integration eval tests: exact population/sample SD and two-source CAGR, decoy non-leakage, forged citation refusal, clarification + 2-attempt retry trace, golden dataset `v1.0.0` hash `35f54e2553cd70f380242ad16e917adde9cd87def9401a9e75def1ec790efe29` and 50-case stratified sample).
- `pnpm eval:deterministic`: **PASS** (exit `0`; `citation_precision = 1.0` `160/160`, `scoping_leakage_count = 0` including 60-draft adversarial pass; Studio Gate v2.0 #3 deterministic PASS).
- `pnpm eval:v3-code-execution` (`node scripts/eval-v3-code-execution.mjs`): **UNAVAILABLE** (exit `2`: `[UNAVAILABLE] eval:v3-code-execution: Agent Platform Code Execution sandbox is not configured`).
- `pnpm eval:judged`: **UNAVAILABLE** (exit `2`: `[UNAVAILABLE] eval:judged: VERTEX_PROJECT (or GCP_PROJECT_ID) is required for Vertex AI`). Fixed 50-case stratified sample IDs and category counts (`unanswerable: 25`, `deselection: 11`, `history: 4`, `synthesis: 14`) are recorded in [gate-v3-code-execution.md](evidence/gate-v3-code-execution.md).


## Current benchmark import contract (2026-11-05; FR-GC-08, NFR-PERF-01, Gate v3.0 #2)

Historical 2026-11-05 aggregator-only checkpoint: configuration alone writes UNAVAILABLE and exits2. The 2026-11-10 collector below now submits ordinary authenticated SSE requests, but requires an explicitly approved frozen scope and a trusted private producer. Merely setting CODE_EXECUTION_IT=1 still cannot start or accept a live benchmark.

```sh
node scripts/eval-v3-code-execution.mjs --plan <predeclared-plan.json> --observations <observations.json> --out <private-output-directory>
```

Freeze the plan before collection: accepted AgentEngineSandbox `europe-west4`, 2 vCPU / 1.5 GB profile, fixture ID/version/SHA-256/question and four cold/warm 1u/2u cohorts, each N≥20. Use canonical UTC timestamps (`YYYY-MM-DDTHH:mm:ss.sssZ`). Each `(cohort, sampleIndex)` is unique, 1-based and within the declared range. Creation-request, real-running, completion and validated-publication events are chronological after submission/declaration. Successful samples require every event; failures retain nullable events. Record one or two attempts; retries require a finite nonnegative end-to-end duration. Invalid imported evidence yields FAIL (exit 1), missing cohorts UNAVAILABLE (exit 2), and complete threshold-compliant observations PASS (exit 0). Reports retain original observations, plan/input SHA-256, source revision and dirty state; failed unbounded durations serialize as `"Infinity"` rather than an ambiguous JSON null.

An imported PASS verifies consistency and thresholds only. Release acceptance also needs the collector implementation/version, immutable raw observations, fixture hashes, deployed revisions, model/runtime/configuration and declared readiness/cohort classification. Do not treat manually generated unit-test samples as live measurements.

Live prerequisites confirmed by controller on 2026-11-05: project `lukas-gcloud-playground` has no Agent Engine parent runtime in `europe-west4`; Cloud SQL `everlast-dev-pg` is STOPPED with activation NEVER; API/worker still run image `51f78ab`. Prepare the existing opt-in OpenTofu code-execution module with `enable_v3_code_execution`, its EU parent runtime and API configuration, plus a matching candidate deployment and migration/readiness check. Obtain owner approval before new billable resources/API enablement. No R6 qualification gate is reinstated. T052 remains open until the authorized live application cohorts, normal isolation/limits tests and common judged report actually pass.


## Execution checkpoint (2026-11-05; [010-code-execution-sandbox] T049–T052)

Candidate parent: `77bac2b62586bce6bf81c9a7efbb42febc862a22`; isolated branch `codex/pre-v4-package-3-2-20261105`, worktree `/private/tmp/everlast-lm-pre-v4-package-3-2-20261105`. Node26/pnpm12 frozen install; disposable PostgreSQL16/pgvector at local port54331, separate test schemas. The package commit contains the repaired runner and this checkpoint; no cloud candidate deployment occurred.

| Check | Outcome |
| --- | --- |
| `pnpm exec vitest run --project unit packages/evals/test/code-execution-performance.test.ts` before repair | RED: 7 newly added tests failed on intended gaps; 7 legacy tests passed. |
| Same focused command after repair | PASS: 14/14 tests. |
| Package contract/runtime/API/DB/web/eval regressions using TEST_DATABASE_URL | PASS: 18 suites, 172 tests. |
| `E2E_PORT=4332 pnpm exec playwright test apps/web/test/code-execution.spec.ts apps/web/test/code-execution-history.spec.ts --project=chromium` with local TEST_DATABASE_URL | PASS: 6/6 tests, 14.4s (after resolving sandbox Chromium launch restriction). |
| `pnpm eval:deterministic` with local TEST_DATABASE_URL | PASS: citation precision 160/160, leakage 0; package structure/reports deterministic gates pass. Judged metrics remain UNAVAILABLE. |
| `pnpm typecheck`, `pnpm lint`, `node scripts/check-spec-integrity.mjs`, `git diff --check` | PASS. |
| Unconfigured runner | UNAVAILABLE: writes report and exits 2. |
| Configured runner without observations (CLI regression) | UNAVAILABLE: writes report and exits 2; no successful no-op. |
| Live managed service, all four real N≥20 application cohorts, common fixed50 judged gate | UNAVAILABLE: no approved parent runtime or matching deployment; T052 remains open. |

T049–T051 complete the local evidence safeguards and documentation reconciliation. Original T044–T047 checkmarks record historical implementation/check attempts, including their documented unavailability; they do not imply live acceptance. T052 is the current open acceptance obligation. The benchmark import contract and exact command are in the quickstart; reports retain original valid observations plus plan/input hashes, source revision and dirty state. A passing aggregate of supplied samples alone is not real-service proof.


## Ordinary-application collector — 2026-11-10 (FR-GC-08, T063, CC-09)

The HTTP adapter calls the existing POST /api/notebooks/{id}/chat/turns with normal
Bearer authentication, explicit source IDs and a fresh request UUID. Public finals
use the actual VisibleMessage projection (no invented request_id). Correlation is
through the initiated stream, replayed=false, matching running execution identity,
canonical trace digest and private request/scope evidence. Two-user cohorts submit
actual paired requests with distinct proven Owner notebooks; one-user cohorts are
serial. There are no replacement successes after failures. An unqualified batch
stops further dispatch and retains every request already attempted.

Prepare a fixed plan and collection manifest before measurement. The manifest
contains two actors (application owner UUID, notebook UUID, exact source/revision
snapshot, expected citation chunk IDs, credential environment-variable name),
api_base_url, candidate_commit, serving_revision, classification_basis, expected
computed-result string and max_total_requests. At least20 samples per each of the
four cohorts are still required; the default qualifying population is80 requests.
The manifest also binds qualification_sha256, runtime_config_sha256 and a retained
clock_calibration plus its SHA256. Calibration fields are offset_ms (server minus
client), uncertainty_ms, measured_at_ms, expires_at_ms and measurement_id. Hash the
parsed calibration object using the documented collectionDigest helper. It must
predate the plan and cover every client submission; no zero uncertainty is inferred.

Use CodeExecutionRuntimeConfigSchema from @everlast/contracts to canonicalize the
actual server config before hashing: reasoning_engine, region=europe-west4,
vcpu=2, memory_gb=1.5, network=none, file_io_mb=100, deadline_ms=15000. SHA256 of
JSON.stringify(parsedConfig) binds the exact parent without putting its provider
handle in reports. The CLI verifies its configured engine/profile matches this
digest, and the producer must emit the digest of its actual serving configuration.

The private producer file implements CodeExecutionPrivateEvidenceFileSchema from
@everlast/contracts, in a regular owner-private0600 file, written atomically. Its
header binds candidate, revision, fixture, classification basis, qualification,
runtime and calibration hashes plus approved notebook IDs. Each measurement uses
CodeExecutionPrivateMeasurementSchema: exact request/owner/notebook/source snapshot,
real boot ID, measured readiness/qualification times, actual create/running/complete/
publication times, safe attempt summaries and canonical trace hash. No prompts,
Python, stdout, bearer tokens or raw provider handles belong in this file.

Classification is declared before collection. Application-serving-readiness and
managed-runtime-readiness are distinct bases; neither is silently substituted for
the other. Warm requires ready and qualified before submission minus measured
uncertainty; cold requires readiness after submission plus uncertainty. Unknown or
post-hoc qualification is UNAVAILABLE. Server times are mapped using the retained
calibration; actual client submission and monotonic status-receipt clocks are never
reset. Boot/execution durations remain server-domain differences. Slow receipt is
retained even if server execution was fast.

Trusted API producer integration remains T064, owned jointly with012 qualification.
It must observe the real runAttempt create boundary, first Running-code emission,
execution completion, canonical trace and final publication/failure under the same
authorization/snapshot. It must emit failed/unknown attempts too, including zero
actual attempts, without inventing end times. The normal final stream or SSE error
can be retained as a failed observation when authoritative private evidence proves
failure. Missing evidence never becomes a passing zero. The producer must probe
real dependencies and retain immutable qualification evidence; environment flags,
constructed clients and client-provided IDs are not qualification. No producer
or public telemetry endpoint was added by this consumer implementation.

Only after approval of the concrete plan, manifest, runtime and bounded paid scope:

```sh
node scripts/eval-v3-code-execution.mjs --collect --plan /private/plan.json \
  --collection-manifest /private/manifest.json --private-evidence /private/evidence.json \
  --out /private/results
```

Securely inject CODE_EXECUTION_IT=1, the matching CODE_EXECUTION_REASONING_ENGINE,
both actor token variables and CODE_EXECUTION_BENCHMARK_APPROVED_PLAN_SHA256 /
CODE_EXECUTION_BENCHMARK_APPROVED_MANIFEST_SHA256 (hashes of exact frozen file bytes).
Never put tokens in CLI arguments or ordinary env files. No approval is inferred
from this example. Preflight rejects missing/mismatched producer data before HTTP;
HTTP/SSE and private reads are bounded and redirects are not followed. CLI outputs
are owner-private and retain provenance, attempts, partial observations and failures.
Live T052 acceptance remains open until the actual qualified deployment and cohorts.

## Optional parent IaC — T062 (FR-GC-08, D18-D20)

The existing Google8.10 module now supports create_parent_runtime, default false.
Dev exposes create_code_execution_parent_runtime. Enabled mode requires exactly
one existing parent name or managed-parent creation, never both; disabled mode
cannot create a parent. The typed EU parent omits agent code/spec/context; it adds
no role or machine override. Existing8.10 locks, ingestion and render wiring remain.
Run node scripts/test-v3-code-execution-infra.mjs after backend-disabled init for
the seven mocked dev policy checks. A mock plan is not a saved cloud-state plan or
approval to create the resource.


### Exact timing capture contract for T064 (FR-GC-08 SC-003)

Despite its historical name, sandbox_created_at is the **creation-request start**,
not a created/ready notification. Capture on the server immediately BEFORE
runAttempt calls input.runtime.create(input.attemptId, input.signal) in
apps/api/src/chat/execution/runtime.ts. The onCreated callback is AFTER awaiting
creation and MUST NOT start this clock: that would remove provider RPC, queue,
boot and polling cost. AttemptOutcome.startedAt is set before validation; it is
only a trace consistency bound and MUST NOT be silently substituted for the exact
create capture point. Preserve null when creation was never invoked.

Capture execution_completed_at immediately after the runtime.execute result
settles inside runAttempt, using the SAME server clock as creation; never use a
post-create timestamp or subtract creation time. The interval therefore includes
creation/boot plus execution and remains the unchanged <=4.0s P95 population.
Capture first running_code_at at ExecutionController's actual onStatus emission
(onRunning); client Running-code receipt remains a separate monotonic interval
from actual sufficient-intent HTTP submission, including the network. Publication
and cleanup have their own milestones and do not redefine either start point.
Map server epoch timestamps to the client epoch only through the retained measured
calibration; duration differences use the original same-domain server captures.
A producer that cannot capture these points is UNAVAILABLE, not a passing proxy.

### Campaign inputs and T075 handoff (FR-GC-08, NFR-PERF-01, NFR-SEC-02)

Use the versioned 12-month latency table and population standard deviation plus
plot question in `packages/testkit/src/code-execution-fixtures.ts`. Bind the exact
table hash, expected decimal representation, expected citations and final
authenticated chart to two distinct Owner notebooks with independent
source/revision snapshots. The collector verifies the number and citation scope
in the private/public correlation. The live acceptance run must also retain
the authenticated chart response and confirm its plotted series against the
fixture. Freeze the candidate and serving revision, target/runtime identity,
fixture/scope IDs and approved classification basis in the plan and manifest.

| Cohort | Requests | In-flight limit | Evidence |
| --- | ---: | ---: | --- |
| cold_1u | 20 | 1 | Measured cold readiness for every submission |
| warm_1u | 20 | 1 | Prior measured readiness and qualification |
| cold_2u | 20 | 2 | Distinct simultaneous Owners with cold readiness evidence |
| warm_2u | 20 | 2 | Distinct simultaneous Owners with prior readiness and qualification |

This is 80 timing submissions in 60 serial batches at minimum. The separately
approved ordinary security population covers HTTP, DNS, metadata, private
address, inbound socket and install attempts, credential and cross-sandbox file
isolation, timeout and deletion, memory/output caps, foreign access and final
chart authorization. Record the attack and its observed result separately from
timing. An unrelated setup or provider failure cannot attest blocked networking.
Retain execution and publication failures and any attempted peer in its original
cohort. Preserve declared counts when collection stops on unavailable evidence.

The 010 consumer exposes the synchronous
`CollectionPorts.assertClockCurrent(calibration, instanceBootId?)` seam. T075
must run it on the client process that acquired and verified the signed clock
proof. Assert continuity and the exact calibration before dispatch. After each
private measurement, additionally bind the recorded server boot to that proof.
Guard the final export with the same continuity state. The collector rejects
late client receipts and server events at or after calibrated expiry minus
uncertainty. It retains the attempt and parsed private record for diagnostics.
A standalone CLI launch cannot establish acquisition-to-export continuity.

On prepared base `14c88ee`, the API's `beginExecution` records
`qualified_at_ms` at request entry. That value cannot prove qualification
before warm submission. T064/012 must use the actual prior successful
qualification time and the readiness time for the frozen basis. Since the
serving recorder opens only after verified boot calibration and qualification,
application-serving readiness needs an explicit cold setup that can prove the
required ordering. A managed-runtime basis would require distinct measured
managed-runtime readiness from the producer. T075 must prove that the complete
approved setup, all batches and export fit the conservative single-boot
validity window or deliver verified renewal. These integration and live
acceptance steps remain open.
