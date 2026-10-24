# Gate v3.0 #2 Evidence: Quantitative Code Execution Sandbox (`specs/010-code-execution-sandbox`)

- **SRS / Gate Scope:** `FR-GC-08`, `FR-GC-01/02/03/06`, `FR-SI-03/05`, `FR-WM-04/05`, `C-01`, `C-02`, `NFR-SEC-01/02`, `NFR-EVAL-01..04`, `NFR-PERF-01`, `Gate v3.0 #2`
- **Task Reference:** `[010-code-execution-sandbox] T045`, `[010-code-execution-sandbox] T046`, `[010-code-execution-sandbox] T047`
- **Branch / Worktree:** `feat/v3-010-complete` (`/private/tmp/everlast-impl-010-complete`)
- **Timestamp:** `2026-10-24T13:45:00Z`
- **Architecture Decisions:** `D18` (2 vCPU / 1.5 GB RAM managed default), `D19` (Agent Platform Code Execution accepted as managed dependency; `R6` obsolete), `D20` (provider-documented limits: no network, provider-limited filesystem, ≤100 MB file I/O per request/response, 15.0 s application per-attempt deadline)
- **Overall Gate v3.0 #2 Status:** **UNAVAILABLE (Pending Live Managed Sandbox & Judged Release Run)** — all deterministic local contract, unit, database, API, browser E2E, security-double, and evaluation checks **PASS**; live cloud provider checks (`CODE_EXECUTION_IT=1`), live cold/warm latency cohorts (`pnpm eval:v3-code-execution`), and the once-per-release Vertex AI judged 50-case run (`pnpm eval:judged`) report **`UNAVAILABLE`** (exit code `2`) because no live Agent Engine parent runtime or paid Vertex AI release run is configured/authorized in this environment.

---

## 1. Success Criteria Summary (`SC-001`..`SC-007`)

| Criterion | SRS / Gate IDs | Deterministic / Local Verification (Test Doubles + Real API/DB/Browser) | Live Managed Provider / Release Verification | Effective Status |
| :--- | :--- | :--- | :--- | :--- |
| **SC-001**: 12-month standard deviation (`sqrt(143/12)` population, `sqrt(13)` sample), inline PNG/SVG trend chart + download, `Computed` pill, `[1]` citation, inspectable code/stdout, and two-source unit-normalized CAGR (`(1200/850)^(1/4)-1`) | `FR-GC-08`, `FR-GC-02`, `Gate v3.0 #2` | **PASS** — `apps/api/test/code-execution.test.ts` (`CE-API-01..03`), `apps/web/test/code-execution.spec.ts` (`CE-E01`), `packages/evals/test/code-execution.eval.test.ts` (`CE-EVAL-01`) | **UNAVAILABLE** — `apps/api/test/code-execution-runtime.integration.test.ts` (`LIVE-01`) skipped without `CODE_EXECUTION_IT=1` | Local **PASS** / Live **UNAVAILABLE** |
| **SC-002**: Zero outbound/inbound network connections from executed code (HTTP, DNS, metadata, private IP, pip); no credentials/tokens in sandbox; scoped input copies only | `FR-GC-08`, `NFR-SEC-01/02`, `Gate v3.0 #2`, `D20` | **PASS** — `apps/api/test/code-execution-runtime.test.ts` (`RT-01..18`), `apps/api/test/code-execution-manifest.test.ts` (`MAN-01..09`), `apps/api/test/code-execution-retry.test.ts` (`RTY-07`, `RTY-09`), `infra/modules/code_execution` (`tofu test` 4/4) | **UNAVAILABLE** — `apps/api/test/code-execution-runtime.integration.test.ts` (`LIVE-02..04`, 7 cases) skipped without `CODE_EXECUTION_IT=1` | Local **PASS** / Live **UNAVAILABLE** |
| **SC-003**: Submission → real `running_code` status ≤ 2.5 s (`2,500 ms`); sandbox create → execution completion ≤ 4.0 s (`4,000 ms`) nearest-rank P95 across predeclared `cold_1u`, `warm_1u`, `cold_2u`, `warm_2u` cohorts ($N = 20$ each); progress never counted as answer TTFT | `FR-GC-08`, `NFR-PERF-01` | **PASS** (Harness & Aggregation) — `packages/evals/test/code-execution-performance.test.ts` (`CE-PERF-01..07`, 7/7); E2E double progress check in `apps/web/test/code-execution.spec.ts` (`CE-E01`) | **UNAVAILABLE** — `pnpm eval:v3-code-execution` exits `2` (`[UNAVAILABLE]`) without live `CODE_EXECUTION_REASONING_ENGINE` or collected provider observations | Harness **PASS** / Live **UNAVAILABLE** |
| **SC-004**: 1.5 GB memory limit (`MemoryLimitExceeded`), 100 MB file-transfer cap, and 15.0 s per-attempt application deadline (`ExecutionTimeout` + sandbox deletion + late-result discard); 1 retry on Python exception, 0 retries on timeout/OOM/storage/transport/citation/output errors; no guessed numbers | `FR-GC-08`, `D18`, `D20` | **PASS** — `apps/api/test/code-execution-retry.test.ts` (`RTY-01..09`), `apps/api/test/code-execution-recovery.test.ts` (`REC-API-01..08`), `packages/db/test/code-execution-recovery.integration.test.ts` (`REC-DB-01..05`), `apps/web/test/code-execution-retry.test.ts` (`WEB-RTY-01..05`) | **UNAVAILABLE** — `apps/api/test/code-execution-runtime.integration.test.ts` (`LIVE-05..07`) skipped without `CODE_EXECUTION_IT=1` | Local **PASS** / Live **UNAVAILABLE** |
| **SC-005**: Citation-ID precision `1.0` and scoping leakage `0` across active-source snapshots, deselection, mid-flight source replacement/deletion, history, v2 saved-response/overview/studio projections, and private chart delivery | `C-02`, `FR-SI-03/05`, `FR-GC-02/03/06`, `NFR-EVAL-02/04` | **PASS** — `apps/api/test/code-execution-scope.test.ts` (`CE-SCP-01..08`), `packages/db/test/code-execution-history.integration.test.ts` (`CE-HIST-DB-01..06`), `apps/api/test/chat-charts.test.ts` (`CH-01..08`), `apps/api/test/code-execution-v2-compatibility.test.ts` (`CE-V2-01..03`), `packages/evals/test/code-execution.eval.test.ts` (`CE-EVAL-01..02`), `pnpm eval:deterministic` (`160/160` precision, `0` leakage) | N/A (deterministic metric) | **PASS** |
| **SC-006**: Golden dataset (`v1.0.0`) lineage preserved; once-per-release judged evaluation on the fixed deterministic stratified 50-case sample (`hallucination_rate < 0.05`, `negative_rejection_rate >= 0.99`, `semantic_support_rate == 1.0`) | `NFR-EVAL-01..04`, `Gate v3.0` | **PASS** (Lineage & Deterministic Gate) — `packages/evals/test/code-execution.eval.test.ts` (`CE-EVAL-04`), `pnpm eval:deterministic` (exit `0`) | **UNAVAILABLE** — `pnpm eval:judged` exits `2` (`[UNAVAILABLE] eval:judged: VERTEX_PROJECT (or GCP_PROJECT_ID) is required for Vertex AI`) | Deterministic **PASS** / Judged **UNAVAILABLE** |
| **SC-007**: Ambiguous statistical intent asks a focused clarification with 0 sandbox calls and no `running_code` status; follow-up computes with current selection; two-attempt retry preserves both ordered attempts across reload and publishes only final outputs | `FR-GC-08`, `FR-GC-06` | **PASS** — `apps/api/test/code-execution.test.ts` (`CE-API-04`), `apps/api/test/code-execution-retry.test.ts` (`RTY-01..02`), `apps/web/test/code-execution.spec.ts` (`CE-E02`), `apps/web/test/code-execution-history.spec.ts` (`CE-HIST-E01..03`), `packages/evals/test/code-execution.eval.test.ts` (`CE-EVAL-03`) | **UNAVAILABLE** (live model/sandbox not configured) | Local **PASS** / Live **UNAVAILABLE** |

---

## 2. Declared Performance Benchmark Plan & Status (`[010-code-execution-sandbox] T043`, `T044`, `T046`)

- **Runner:** `pnpm eval:v3-code-execution` (`node scripts/eval-v3-code-execution.mjs`)
- **Aggregation Module:** `packages/evals/src/code-execution-performance.ts`
- **Declared Fixture:**
  - `id`: `latency-12m-pstdev-v1` (version `1`)
  - `sha256`: `fe22026f73e9e4c8557c047664028d10588d8267f0df23ca6024cb3fb6002b28` (`LATENCY_TABLE_PAGE`)
  - `question`: `"What is the exact population standard deviation of the monthly latency? Plot the trend."`
- **Declared Provider Profile (`D18`, `D19`, `D20`):**
  - `service`: `aiplatform.googleapis.com/AgentEngineSandbox`
  - `region`: `europe-west4`
  - `cpu`: `2 vCPU`
  - `memory`: `1.5 GB`
- **Targets & Aggregation Rules:**
  - Sufficient-intent submission → real `running_code` status: **$\le 2,500\text{ ms}$** (`RUNNING_CODE_TARGET_MS`)
  - Sandbox creation request → execution completion: **$\le 4,000\text{ ms}$** nearest-rank P95 (`Math.ceil(0.95 * N)`, `BOOT_EXECUTION_P95_TARGET_MS`)
  - Failed or timed-out samples remain in the cohort as `+Infinity` and fail their cohort (`pass = false`, `status = "FAIL"`).
  - Retries are tracked separately (`retriedSampleCount`, `totalExtraAttempts`, `retryEndToEndMs`) without resetting the submission clock.
  - `countsAsAnswerTtft`: `false` (`running_code` progress never counts as validated answer TTFT under `NFR-PERF-01`).

### Cohort Results Table

| Cohort | Warm / Cold | Concurrency | Declared Samples ($N$) | Observed Samples | Submission → `running_code` Max | Create → Completion P95 | Failed / Timeout Samples | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `cold_1u` | Cold | 1 user | 20 | 0 | — | — | — | **UNAVAILABLE** |
| `warm_1u` | Warm | 1 user | 20 | 0 | — | — | — | **UNAVAILABLE** |
| `cold_2u` | Cold | 2 concurrent users | 20 | 0 | — | — | — | **UNAVAILABLE** |
| `warm_2u` | Warm | 2 concurrent users | 20 | 0 | — | — | — | **UNAVAILABLE** |

Command output:
```text
$ node scripts/eval-v3-code-execution.mjs
[UNAVAILABLE] eval:v3-code-execution: Agent Platform Code Execution sandbox is not configured (set CODE_EXECUTION_IT=1 and CODE_EXECUTION_REASONING_ENGINE in europe-west4, or supply --observations)
(exit code 2)
```

---

## 3. Golden Dataset & Fixed 50-Case Stratified Sample (`[010-code-execution-sandbox] T045`)

- **Dataset Version:** `v1.0.0`
- **Dataset SHA-256:** `35f54e2553cd70f380242ad16e917adde9cd87def9401a9e75def1ec790efe29`
- **Corpus SHA-256:** `df229d252d1065c8c52591d3a47aa900563a6e381feec64fa3b6160e289359cd`
- **Full Dataset Category Counts (222 cases):**
  - `unanswerable`: 110
  - `deselection` (`deselected_source` + `history_carryover`): 52 (`history_carryover`: 20)
  - `synthesis`: 60
- **Deterministic Evaluation (`pnpm eval:deterministic`):**
  - Status: **PASS** (exit `0`)
  - `citation_precision`: `1.0` (`160/160`, failing cases: `none`)
  - `scoping_leakage_count`: `0` (including 60-draft adversarial out-of-prompt citation attack: `0` published)
  - Package 3.2 deterministic suite (`packages/evals/test/code-execution.eval.test.ts`): **PASS** (`4/4` tests)
- **Once-Per-Release Judged Sample (`RELEASE_SAMPLE_SIZE = 50`, `stratified-largest-remainder-v1`):**
  - Category composition: `{"unanswerable": 25, "deselection": 11, "history": 4, "synthesis": 14, "total": 50}` (`DES-*`: 7, `HIS-*`: 4)
  - Exact 50 Case IDs:
    `NEG-003`, `NEG-007`, `NEG-012`, `NEG-016`, `NEG-020`, `NEG-025`, `NEG-029`, `NEG-034`, `NEG-038`, `NEG-042`, `NEG-047`, `NEG-051`, `NEG-056`, `NEG-060`, `NEG-064`, `NEG-069`, `NEG-073`, `NEG-078`, `NEG-082`, `NEG-086`, `NEG-091`, `NEG-095`, `NEG-100`, `NEG-104`, `NEG-108`, `DES-003`, `DES-007`, `DES-012`, `DES-017`, `DES-021`, `DES-026`, `DES-030`, `HIS-003`, `HIS-008`, `HIS-013`, `HIS-018`, `SYN-003`, `SYN-007`, `SYN-011`, `SYN-016`, `SYN-020`, `SYN-024`, `SYN-028`, `SYN-033`, `SYN-037`, `SYN-041`, `SYN-046`, `SYN-050`, `SYN-054`, `SYN-058`
  - Judged Run Output (`pnpm eval:judged`):
    ```text
    $ env -u GEMINI_API_KEY -u GOOGLE_API_KEY -u GOOGLE_GENAI_API_KEY node packages/evals/src/cli.ts release
    [UNAVAILABLE] eval:judged: VERTEX_PROJECT (or GCP_PROJECT_ID) is required for Vertex AI
    (exit code 2)
    ```

---

## 4. Package 3.2 Test & Verification Matrix (`[010-code-execution-sandbox] T047`)

| Suite / Command | Scope | Result |
| :--- | :--- | :--- |
| `packages/contracts/test/package-v3-2.test.ts` | DTOs, trace/attempt/value/manifest schemas, failure codes | **PASS** (14/14) |
| `apps/api/test/code-execution-runtime.test.ts` | Agent Platform v1beta1 REST adapter, 15.0 s deadline, 100 MB caps, CPython harness self-check | **PASS** (18/18) |
| `apps/api/test/code-execution-manifest.test.ts` | Scoped `data.json` manifest builder, size caps, credential/URI exclusion | **PASS** (9/9) |
| `apps/api/test/code-execution-output.test.ts` | `everlast_result.json` parser, PNG/SVG validator, active-SVG rejection, label/unit neutralization | **PASS** (10/10) |
| `apps/api/test/code-execution-model.test.ts` | Grounded draft schema, numeric preamble guard, `composeComputedAnswer`, ADK `correctCode` | **PASS** (11/11) |
| `apps/api/test/chat-sanitize.test.ts` | Fixed-point bracket/marker neutralization (`[[n]]`, `(Computed)`) | **PASS** (3/3) |
| `packages/evals/test/code-execution-performance.test.ts` | Nearest-rank P95, cohort validation, failure accounting, separate retry reporting | **PASS** (7/7) |
| `packages/db/test/code-execution.integration.test.ts` | Migration `0010_code_execution.sql`, single-flight admission, atomic publish, clear invalidation | **PASS** (12/12) |
| `packages/db/test/code-execution-recovery.integration.test.ts` | Expired lease reconciliation, orphan sandbox selection, chart purge | **PASS** (7/7) |
| `packages/db/test/code-execution-history.integration.test.ts` | Nullable legacy/clarification traces, reload fidelity, deselection/invalidation, cross-pool isolation | **PASS** (6/6) |
| `apps/api/test/code-execution.test.ts` | US1 exact SD/CAGR, clarification, whole-table retrieval expansion, unconfigured 503 | **PASS** (9/9) |
| `apps/api/test/code-execution-retry.test.ts` | US2 1 retry on Python exception, 0 retries on timeout/OOM/storage/transport/citation/NaN | **PASS** (9/9) |
| `apps/api/test/code-execution-recovery.test.ts` | US2 startup/periodic reconciler, in-flight clear/delete cancellation, controller error lease release | **PASS** (8/8) |
| `apps/api/test/code-execution-scope.test.ts` | US3 empty/foreign scope, mid-flight checkbox/sync/delete fences, invalid citation refusal, cache keys | **PASS** (8/8) |
| `apps/api/test/code-execution-v2-compatibility.test.ts` | US3 saved-response conversion, feedback/follow-ups, overview/studio isolation from traces | **PASS** (3/3) |
| `apps/api/test/chat-charts.test.ts` | US3 private PNG/SVG delivery, auth, byte-range `206`/`416`, immediate invalidation | **PASS** (8/8) |
| `apps/web/test/code-execution.test.ts` & `apps/web/test/code-execution-retry.test.ts` | Web DOM unit tests for Computed pills, chart card, code drawer, 2-attempt retry, revocation | **PASS** (7/7, 5/5) |
| `apps/web/test/code-execution.spec.ts` & `apps/web/test/code-execution-history.spec.ts` | Playwright Chromium E2E journeys (`CE-E01..03`, `CE-HIST-E01..03`) | **PASS** (6/6) |
| `packages/evals/test/code-execution.eval.test.ts` | Deterministic & semantic code-execution eval suite + golden dataset lineage | **PASS** (4/4) |
| `infra/modules/code_execution` (`tofu test`) | OpenTofu parent runtime policy & opt-in gating (`enable_v3_code_execution`) | **PASS** (4/4) |
| `apps/api/test/code-execution-runtime.integration.test.ts` | Live Agent Platform sandbox isolation & resource limits (`CODE_EXECUTION_IT=1`) | **UNAVAILABLE** (11 skipped) |
| `pnpm eval:v3-code-execution` | Live cold/warm 1u/2u latency cohorts ($N = 20$ per cohort) | **UNAVAILABLE** (exit 2) |
| `pnpm eval:judged` | Live Vertex AI 50-case stratified judged evaluation | **UNAVAILABLE** (exit 2) |
