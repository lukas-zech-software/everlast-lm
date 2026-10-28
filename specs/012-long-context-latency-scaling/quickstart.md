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
