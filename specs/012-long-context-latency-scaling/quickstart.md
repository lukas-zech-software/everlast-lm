# Validation Guide (`NFR-PERF-01`, C-02/C-03, NFR-EVAL-01..04)

## Current runnable specification check (`CC-01/02`)

From the dedicated feature worktree using Node.js 26, run:

```sh
node scripts/check-spec-integrity.mjs
git diff --check
```

Expected: traceability/checklist checks and whitespace pass. These validate artifacts only. Existing package.json generic runners include `pnpm test:contract`, `pnpm test:unit`, `pnpm test:integration`, `pnpm eval:deterministic`, `pnpm eval:judged`, and `pnpm test:e2e`; dependencies/runner requirements must be installed first. They do not currently include the package 3.4 deployed benchmark. `pnpm dev` now starts local PostgreSQL plus API/worker and `pnpm db:migrate` really applies numbered SQL. They mutate local infrastructure/data: inspect configuration and use a disposable environment for later validation. Offline mode uses a test-only lexical embedder and unconfigured chat 503, so it cannot prove live model or latency acceptance.

## Implementation prerequisites (`CC-02/06/07`, NFR-PERF-01)

Before implementation, inspect documented Gate v2.0 owner override in `docs/gate-v2-live-evaluation.md`, retaining known failures as limitations (the 2026-10-22 live re-run passes #3 while #1 and FR-GC-07 Shorter still fail); before integrated v3 acceptance, implemented 3.1–3.3, shared contract compatibility, current production SQL-backed C-02 qualified at scale, enterprise EU model/cache adapters, and package 3.2 integration with the owner-accepted managed sandbox (D19; R6 obsolete). D18 accepts 2vCPU/1.5GB only; scratch 64MB/no-network/read-only-input/15.0s actual termination/cleanup requirements remain. No cloud API enablement, IAM change or deployment is authorized by this guide.

After spec-derived Red tests exist, implement and pass contract/DB/worker/chat instrumentation coverage in [plan.md](plan.md). Freeze manifest and envelope/index parameters using calibration data distinct from acceptance data. Read [contracts/interfaces.md](contracts/interfaces.md) and [data-model.md](data-model.md) for timing, scope and report fields.

## Deployed needle scenario (`NFR-PERF-01`, NFR-EVAL-02/04)

1. Prepare a synthetic 41-source fixture using normal ingestion/admission and real C-01 IDs. Manifest maps `chk_needle_77` to schema-valid chunk ID in source 33 containing 142.8 bar; source 41 contains 155.0 bar. Use representative text, tokenizer and locators, not inflated unverified token_count fields. The first 40 sources alone total ≥1,050,000 normalized source tokens; exclude overlap duplication and decoy volume.
2. Select 1–40 explicitly. Record deployed region/revision/model/index/SQL/client/readiness/cache configuration and fixture hashes before collection. Existing /healthz and SQL-only /readyz do not alone prove actual serving-instance readiness; qualify boot/readiness/request identity and dependencies before submitting core requests. A warmup hit to another instance is insufficient; cache state is declared separately and cannot be manipulated mid-run to hide failures.
3. When the planned runner is implemented, invoke `node scripts/eval-v3-scale.mjs --manifest <approved-manifest.json> --profile core --output <private-report-directory>`. **UNAVAILABLE today:** file/flags above are planned CLI contract, not existing working commands. Credentials use existing authenticated session/keyless flow; never paste tokens into logs or commit manifest secrets.
4. Expected: 20 warm sequential answers, nearest-rank 19th latency ≤2,500ms; each exact 142.8 bar with needle citation; no 155.0 bar in answer or any prompt/history/cache context; every attempted request retained. Current status events are retrieving/generating/verifying and do not end the clock. Only fresh non-replayed validated factual content in final SSE can do so; the entire answer is buffered before that event. Failures/refusals cannot be counted as successful timings.
5. Collect wake cohort with full timings and readiness delays separately without latency threshold. Unknown readiness makes acceptance unavailable; slow warm requests stay warm. Run concurrency 2 two-Owner/two-notebook diagnostic separately, never concurrent same Owner/notebook requests.

## Evidence and boundary scenarios (`C-02/C-03`, NFR-PERF-01)

- Broad 40-source question must include 40 matching Source Guides and retrieved original details; detailed follow-up finds original needle. Inject a stale/deselected guide/history turn/cache entry and require no content leakage.
- Test 999,999/1,000,000/1,000,001 source-token corpora with measured full-envelope overhead, at-capacity full original context and above-capacity bounded batches/recursive reductions. Assert every original chunk/segment processed. Inject a missing batch, oversized chunk and reducer overflow; require bounded handling or explicit failed attempt, no Completed partial artifact.
- During generation/cache use, delete/replace a captured revision or revoke access. Require failure without stale output; next selection change only affects next submission. Test another notebook's IDs and changed ACL fingerprint. Citation failure immediately refuses, no stripped-citation draft or silent regeneration.
- Run 300 source valid-quota corpus and include ingestion/media locators, report/map/table outputs and Computed-turn trace compatibility. Core chat latency excludes code/Studio turns but their own package constraints still apply.
- Run deterministic citation-ID/leakage gates each PR; judged hallucination/rejection/semantic support once per release candidate on the fixed deterministic stratified 50-case golden sample, retaining IDs/category composition/dataset hash (Constitution 2.0.0). Expected thresholds: <5% hallucination, 1.0 ID precision, ≥99% unsupported-question refusal, 0 leaked chunks, plus citation semantic support.

## Reporting (`NFR-PERF-01`, Gate v3.0)

Retain immutable manifest, all observations, stage timings, scope/prompt audit, SQL query plans/recall calibration, chunk coverage, separate core/wake/concurrency distributions and eval numerators/denominators. If deployed resources or runner are missing, report UNAVAILABLE and exact missing prerequisite. Current performance, quality, memory, EU cache capacity and full Gate v3.0 remain UNAVAILABLE. No runtime acceptance is established by this planning invocation.

## Latest-main regression boundaries (`NFR-PERF-01`, C-02/C-03, CC-02/06)

Use existing chunks/source_pages, current RequestScopedContextProvider/retrieveScopedChunks and strict ChatService history eligibility. Calibrate current 40 candidate/12 result RRF 60 against exact scoped ranking before tuning; retain notebook/source/revision SQL predicates and C-01 projection. Confirm broad 40 Guide routing uses 3.1's durable revision/language-keyed ports and Studio uses 3.3's durable repository/outbox. Current all-original keyset reads return an array; qualify application-memory and serialized-model bounds separately. Current report baseline 4,000 tokens/8 chunks/concurrency 4 still needs oversized-chunk segmentation and bounded composition/coverage. Do not recreate already-existing embeddings or indexes or claim refreshed designs implemented. Sandbox code/clarification turn projections follow 3.2's actual service/model/draft/verifier/SSE integration.

The planned scripts/eval-v3-scale.mjs runner is absent. No deployed million-token, EU cache/model-envelope, prospective readiness, Studio bounded-memory or integrated v3 pass is established by document checks. Do not invoke infra start/warmup/deploy from this guide during a planning refresh.

## Second-main persistence baseline (`NFR-PERF-01`, C-02/C-03)

Use the deployed PostgreSQL app pool and applied 0005–0008, preserving stored preferences, Guides, notes and reports. Record pool configuration/acquisition costs, schema hash, startup sweep completion and separately frozen database/persisted-record/provider-cache conditions before collection; memory fallback is not acceptance evidence. Add a separate restart diagnostic: Ready guides/reports survive, interrupted legacy reports require explicit retry, orphaned Pending guides regenerate, and remaining 3.1/3.3 dispatch/publication fences are qualified before integrated acceptance. Include all incurred SQL/publication overhead in timing. Sources/history readiness before Send is distinct from serving-instance warm classification; no post-submission reset. Existing repository restart integration tests are baseline coverage, not million-token latency proof.

## Startup migration baseline (`NFR-PERF-01`, D17, CC-06/08)

The current API deployment enables `MIGRATE_ON_START=true`; numbered SQL runs under the migration advisory lock before the API listens. Before collecting the warm cohort, capture Node.js 26 runtime, applied schema/hash, migration completion and startup recovery/dependency readiness tied to the serving instance. Pending migration or lock waits cannot establish warm readiness. Keep all submitted attempts and their original clocks, report wake/startup observations separately under D17, and do not subtract migration time from TTFT. Migration completion alone does not prove model readiness; qualify rolling-version schema compatibility before deploying a benchmark revision. This guide does not execute migrations or deploy resources during planning.

## Task-analysis regression cases (`NFR-PERF-01`, `C-02/C-03`, `NFR-EVAL-04`)

Test process-local cache restart, no orphan reattachment, required finite positive TTL/confirmed expiry, deletion failure and per-use authorization. Failure JSON must round-trip with explicit terminal status and null timing/p95; positive infinity exists only in aggregation. Tests T010/T015 and T023/T028 own these cases. Tasks remain unexecuted; this document supplies validation instructions only.

## Implementation checkpoint 2026-10-26 (NFR-PERF-01, C-02/C-03, CC-02)

Worktree `impl-012`, branch `codex/package-3-4-implementation`, checklist approval
`fa987c0`. Base includes packages 3.1–3.3 (#160/#159/#161). Node 26/pnpm 12 and
isolated local PostgreSQL 16+pgvector are available. Gate v2 owner override remains
authority, not a measured pass. No cloud resources or IAM were changed.

[012-long-context-latency-scaling] T001–T009: shared internal schemas, deterministic
fixture recipe, canonical page token ledger and backpressured C-02 chunk iterator.
Existing array consumers remain compatible. The ledger retains metadata only;
the original text is read one canonical page at a time (a single page still obeys
source admission limits). Page token counts use an injected qualified tokenizer;
local word-tokenizer fixtures are test doubles, not deployed model qualification.

Red: initial three suites failed on missing package-v3-4/scoped-corpus/fixture modules;
expanded tests failed on absent envelope/coverage/sample functions and missing
original locators. Green: 22 suites / 291 tests passed across contracts, new scale
tests, existing scoped retrieval, Studio structure persistence and evidence helpers.
Commands: `TEST_DATABASE_URL=<local disposable test database> node
node_modules/vitest/vitest.mjs run packages/contracts
packages/db/test/scoped-context-scale.integration.test.ts
packages/db/test/scoped-context.integration.test.ts
packages/db/test/studio-structure.integration.test.ts
packages/evals/test/v3-scale.eval.test.ts apps/worker/test/studio-evidence.test.ts`.
Type checking found a cross-package test import and draft-status spelling, corrected
before the next check. Full deployment/latency/cache/memory and judged evidence
remain UNAVAILABLE. No Gate v3 pass or product completion is claimed.

## Implementation completion checkpoint (2026-10-28; NFR-PERF-01, CC-02/06)

Package 3.4 implementation is complete across US1, US2, US3, and verification (T001–T050).
- Pure unit suite: 47 suites / 447 tests PASS (`node node_modules/vitest/vitest.mjs run --project unit`).
- Integration suite: 133 suites passed, 1 skipped (816 passed, 11 skipped) (`node node_modules/vitest/vitest.mjs run --project integration`).
- Deterministic evals: 222 cases; citation precision 160/160 (1.000), scoping leakage 0, 60 adversarial drafts blocked (0 published), Studio reports PASS (4/4, precision 1.000, leakage 0, P95 2.5 ms), Studio structure PASS (`TEST_DATABASE_URL=... node packages/evals/src/cli.ts deterministic`). Release state GatePending per judged/UI requirement.
- Studio context & stress runner: `node scripts/eval-v3-context.mjs` PASS.
- Deployed scale benchmark: `node scripts/eval-v3-scale.mjs` exits with code 2 and outputs `[UNAVAILABLE] eval:v3-scale: Live deployed benchmark environment not configured`, faithfully reporting absence of live cloud infrastructure per Constitution VI / Gate v3.0.
- TypeScript build (`tsc -b --pretty`), `node scripts/lint.mjs`, `node scripts/check-spec-integrity.mjs`, and `git diff --check` all PASS without error or whitespace violations.

## Recovery checkpoint 2026-11-10 (NFR-PERF-01, FR-GC-08, C-01/C-02/C-03, CC-01..CC-09)

This section supersedes historical implementation/acceptance claims above. Dedicated branch codex/pre-v4-012-20261110 starts at3326d8d4e13215f13e1dfab6021d31a14c66bb88. Recovery verifies the archived patch and all55member hashes against the private manifest; [verification](evidence/recovery-20261110/recovery-verification.json) retains exact hashes. Selective three-way review preserved Guide admission/primary-language/startup/config and migration0012,006private Guide errors,009Node26render/npm bootstrap/provider8.10/default-off wiring,010/011changes and admin-only signupD22 (D21 remains architecture). No old lock/package manifests were copied. Reviewer checklists remain16/16 and38/38 unchanged.

Implemented local recovery: bounded C-02 original traversal, per-original Unicode segment coverage/no-finding completion, finite provider cache expiry/rechecks/invalidation, original-byte cache creation with actual serialized-envelope count, bounded report extraction and recursive compose that explicitly refuses non-compressing/oversized evidence. Proportional segment token counts are unqualified estimates; byte caps bound requests and local fixtures do not establish enterprise capacity. The historical008report504 remains a live failure; timeouts were not increased.

Scale collection now requires private same-serving-boot/dependency evidence, exact frozen source_snapshot and scope_manifest_hash, qualified original-page ledger and prompt observations, exact needle citation, bounded SSE/HTTP/evidence collection and retained failed/unknown requests. Profile/import validation rejects mismatches and actual concurrency dispatches ten pairs over separate authenticated Owner notebooks. Even collected reports have release_eligible:false until independent actual deployment/runtime qualification. Old recipe fixtures lacking the frozen original ledger are UNAVAILABLE.

010T064 local integration captures sandbox_created_at immediately before runtime.create invocation (includes RPC/queue/boot/poll), execution_completed_at on runtime.execute settlement before cleanup/publication, and running_code_at on actual controller status emission, all one server clock. Canonical private0600 file snapshots are replaced atomically; existing public-mode, symlink/non-regular or oversized files are rejected. Records bind captured request/owner/notebook/revisions, real recorder boot, configured candidate/revision/runtime/calibration/qualification hashes and the actual durable terminal trace read after publication or abandon. Missing/deleted/active/failed-read canonical state withholds proof; known HTTP attempts remain in the collector denominator. A source replacement after successful chart execution exposed mismatched provisional/durable artifacts; the new real-PG Red→Green regression verifies exact canonical trace equality.

**Operational qualification is still missing.** Mounted metadata/hash/profile matches are necessary bindings, not actual deployed/provider attestation. Startup probes only SQL/migrations/recovery; model/retrieval/cache probes remain absent. Therefore normal startup never opens qualified execution collection, and no production qualified execution record was emitted. Private probe doubles in unit tests prove mechanics only. 010T064 qualification/T052,012T060/newT064 and011T061 remain OPEN. No paid startup probes or client-supplied readiness were added.

Fresh observations under [evidence/recovery-20261110](evidence/recovery-20261110/):

- Recovery Red11failed/11passed before runtime recovery; Green24tests/6files. New exactrevision Red1failed/9passed→Green. Atomic sink Red1failed/4passed; execution boundary Red1failed/21passed→combinedGreen28tests. Canonical publication-fence Red1failed/7passed→Green in realPG.
- Full unit505tests/54files PASS. Final affected16tests/2files PASS after final bounded-request/calibration checks. Focused realPG21tests/4files PASS (scope/retry/chat/cache), plus4tests/3files streaming/scale/report PASS.
- Actual ordinary-API context stress PASS: original whitespace-token counts999999/1000000/1000001, all40chunks at each boundary,40Guides and exact needle follow-up, report/map/table consumption, full300source admission/301rejection and300original coverage, cache miss/hit/expiry/restart/create-failure/revocation. Final process Node26.13.0 with256MiB old-space; RSS before299712512, peak406405120, growth106692608bytes<=256000000. Model/tokenizer/cache/embedding doubles are explicitly LOCAL; release_result:UNAVAILABLE. Failed historical reused-worker memory observation remains in setup-observations.json.
- Same fresh collector also ran real authenticated ordinaryHTTP60requests:40retained core submissions without qualification, plus20requests in ten pairs over two proven local Owners, measured peak model concurrency2. All60raw collector observations remain; missing enterprise/private scope/readiness proof yields UNAVAILABLE, never manufactured warm tokens, owners or zero leakage.
- SCALE-UI-01 fresh original test passed; no new browser Red is claimed. It now waits for source readiness, asserts one selected source and fills the question before asserting Send enabled. Corrected realChromium journey PASS, with final validated answer/citation and404public tuning checks retained. This is local UI evidence, no timing gate.
- Deterministic gate PASS: citation160/160, leakage0,60adversarial invalid drafts/0published; report validity4/4 and structure checks PASS under labelled doubles. No judged run occurred. FR-GC-07 judged-only length metric remains UNAVAILABLE.
- Lint/type/spec integrity PASS;39architecture fixtures, graph0findings/185exact unchanged approved records and changed-feature artifacts0 against origin/main. Manual CC09 reviewed final module paths/exports/ports and source→model→validation→publication ownership; no new app-to-app/shared-to-app edge, no extra wildcard export path or exception widening. Existing worker-local helpers stay in existing modules; existing composition constructor receives structural ports. Static graph checks do not establish runtime semantics.
- Actual Node24.22.2 container engine Red, then Node26.13.0 linux/arm64 image build and network-disabled API+worker native TypeScript import smoke PASS. Bothroot stages use26 and npm pnpm12bootstrap; existingrender fix retained. runtime-image.txt records exact local image identity. No deployment is implied.

The original failed browser viewer P95=16.734000000000037ms and corrected actual120-node P95=16.733999999999924ms both remainFAIL against16ms, unrounded. No metric/population/threshold substitutions. Common fixed stratified50-case judged campaign runs once on the immutable approved cross-package candidate, retaining IDs/categories/dataset hash/errors/denominators. T046–T048 historical checkmarks are reopened. Gatev3 and V4 readiness remain incomplete.

No cloud/resource/apply/deploy/APIenablement/paid model/sandbox/audio/GitHub/external-write action occurred. Local disposable PostgreSQL is shared infrastructure and stays running; test/browser/build processes terminate. Optional Spec Kit Git hooks are disabled in project config and skipped; explicit reviewed checkpoint commit is used.

### Explicit remaining implementation (2026-11-10; FR-GC-08, NFR-PERF-01)

T053 is PARTIAL/OPEN: private persistence is repaired, but no production caller supplies or refreshes actual model/retrieval/cache probes. The current server therefore keeps beginExecution undefined even after an otherwise approved deployment/workload. NewT064 requires a spec/analyze/test-first operational trusted qualification code path, without fabricating readiness or executing unapproved paid probes, before subsequent authorized actual qualification. This is missing code plus missing runtime evidence, not a cloud-only prerequisite. T062 records capture/atomic file/canonical-trace integration mechanics only; local012implementation is not complete at this checkpoint. Parent will resume the same sequential agent after integrating this reviewed checkpoint while usage permits.

## Operational qualification implementation checkpoint 2026-11-10c

Traceability: NFR-PERF-01, FR-GC-08, C-02, NFR-SEC-01/02, NFR-EVAL-02/04, CC-01..CC-09. This section supersedes prior missing-code statements: the bounded operational path is now implemented and locally characterized, not live-qualified. Correct current stop policy is five-hour<=10% OR weekly<=2%, without reset credits.

APIserver composes private feature interfaces only. APIobservability/benchmark.ts owns signed workflow/files/API-owned enterprise cache adapter; APIservices/source-context.ts owns explicit C-02 capture/verify/original stream and injected private effect adapters. No new use of a worker implementation, cross-app/test/type edge or export path;185migration records remain unchanged. APIexecution runtime/controller persist actual managed profile observation with boot/candidate/runtime identity ONLY for approved notebooks, piggybacked on existing required onRunning progress; disabled instrumentation adds no optional SQL failure path. DBread-only proof requires exact current Owner/revisions, fresh sameboot published Succeeded canonical execution, matching trace/attempt IDs/profile and every sandbox Destroyed. It reads existing ordinary warmup evidence independently of qualified beginExecution; no alternate sandbox create/delete or retroactive qualified warmup.

To enable a future explicitly approved deployment/workload, the operator prepares a private process-owned0700directory outside public assets and0600files. Set BENCHMARK_OPERATIONAL_DIRECTORY plus existing approved notebook/execution configuration. trusted-public-key.pem is a separately pinned Ed25519 public key, not taken from the authorization. Process emits challenge.json with actual boot, candidate/runtime identities, measured source-tree/config hashes and exact provider_budget. Operator independently reviews actual immutable deployment/configuration/clock/fixtures and signs exact authorization.json bytes into base64 authorization.sig; private key never enters the server or reports. Required plan binds id, exact boot/revision/candidate/fixture/runtime/calibration/qualification/source-tree/operational-config hashes, provider_budget, issued_at/expires_at<=15min, timeout_ms<=240000, exact four operation names and two distinct Owner/notebook actors with unique sorted exact source revisions. Optional cache_sources are explicit sameOwner/notebook revisions for provider-valid cache fixtures; otherwise primarysources are used exactly. No AllReady fallback, truncation or source sampling. Tinycode fixtures may fail provider cache minimum; actual rejection remains UNAVAILABLE, never fabricated PASS.

The setup deadline is separate from unchanged2500ms/15000ms timed cohorts. Allactors' canonical runtime observations pass before any potentially paid effect. Maximum per authorization:2embedding RPCs,2model generations (512outputtokens each,100000serialized request bytes),2actualcache countTokens calls,2cache creates,2cache deletes,TTL60seconds,32000000original/40000000serialized cache bytes and actual countTokens+18000reserve<=1048576. SDKattempts1 and private embedding maxAttempts1 prevent hidden retry multiplication; ordinary embedding default5application attempts and ordinary model output configuration remain unchanged. Authorized cancellation can still incur provider charges for an already-submitted request; no extra attempts are started after abort. Source/config measurement is binding, signature is authorization only, and client construction is never an observation. Authentication/ADC and SQL are existing infrastructure operations; no new resources/roles/providers are created. Ordinary runtime warmup/candidate collection costs require their own explicit approved workload, not this signature's implicit authorization.

Coordinator polls fixed privatefiles, consumes IDs before effects, refuses replay/expired/malformed/mismatched input, invalidates old readiness and keeps the effect lock until an abort-ignoring operation actually settles. Late cache creation is deleted with finite TTL fallback and cannot qualify. Close aborts/invalidate and stops private polling/reconciliation. Every changed authorization outcome is retained in owner-private atomic observations.json (max100), latest status.json is only a convenience; reports contain IDs/hashes/readiness and release_eligible:false, no prompts/source text/provider handles/credentials. Existing actual HTTP attempts/failures and canonical trace/privacy/publication fences remain intact.

No real paid/cloud/provider probes were executed in this local run. Tests use local SDK/model/cache/runtime doubles, real disposable PostgreSQL/C-02/ordinary API/controller/cleanup. Operational code completion is not proof of immutable deployed runtime/provider behavior, clock calibration, security limits, actual cache minimum/capacity or release latency. T060 and010T052/T064live,011T061 and common50case judged acceptance stayOPEN. Historical viewer16.734000000000037ms FAIL and corrected16.733999999999924ms FAIL remain unchanged; report504 is not erased.

### Target deployment transport gap — explicitly remaining CODE/configuration

The local private-file workflow and actual startApiServer wiring are implemented/tested. CloudRun delivery is NOT complete: challenge/status/canonical evidence live in ephemeral container files, and no secure remote approval inbox/export adapter is implemented. A mounted writable directory by itself does not transport those files to/from the operator host. No currently verified platform bridge can be cited. T068 must implement or verify an actual private deployment channel before target operational completion; T053/T064/T066 remain partial. An existing ObjectStorage/keyless bucket could be assessed for a private candidate/boot prefix with generation-pinned bounded authorization reads, allowlisted JSON export and0600operator downloads, but this is a design option, NOT implemented code, confirmed IAM, or authorization for cloud resources. The pinned public-key trust root must remain separate from the inbox. No public debug/tuning endpoint or signed-URL bypass is acceptable. Actual CloudRun configuration/IAM, immutable images, bootstrap fixture/warmup budget and live probe approval still require concrete owner review; no paid/cloud operation occurred here.
