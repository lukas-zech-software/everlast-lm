# Validation Guide (`NFR-PERF-01`, C-02/C-03, NFR-EVAL-01..04)

## Current runnable specification check (`CC-01/02`)

From the dedicated feature worktree, run:

```sh
node scripts/check-spec-integrity.mjs
git diff --check
```

Expected: traceability/checklist checks and whitespace pass. These validate artifacts only. Existing package.json generic runners include `pnpm test:contract`, `pnpm test:unit`, `pnpm test:integration`, `pnpm eval:deterministic`, `pnpm eval:judged`, and `pnpm test:e2e`; dependencies/runner requirements must be installed first. They do not currently include the package3.4 deployed benchmark. `pnpm dev` now starts local PostgreSQL plus API/worker and `pnpm db:migrate` really applies numbered SQL. They mutate local infrastructure/data: inspect configuration and use a disposable environment for later validation. Offline mode uses a test-only lexical embedder and unconfigured chat503, so it cannot prove live model or latency acceptance.

## Implementation prerequisites (`CC-02/06/07`, NFR-PERF-01)

Before implementation, inspect documented Gate v2.0 owner override in `docs/gate-v2-live-evaluation.md`, retaining known failures/no post-fix live rerun as limitations; before integrated v3 acceptance, implemented3.1–3.3, shared contract compatibility, current production SQL-backed C-02 qualified at scale, enterprise EU model/cache adapters, and R6 qualified sandbox controls. D18 accepts2vCPU/1.5GB only; scratch64MB/no-network/read-only-input/15.0s actual termination/cleanup requirements remain. No cloud API enablement, IAM change or deployment is authorized by this guide.

After spec-derived Red tests exist, implement and pass contract/DB/worker/chat instrumentation coverage in [plan.md](plan.md). Freeze manifest and envelope/index parameters using calibration data distinct from acceptance data. Read [contracts/interfaces.md](contracts/interfaces.md) and [data-model.md](data-model.md) for timing, scope and report fields.

## Deployed needle scenario (`NFR-PERF-01`, NFR-EVAL-02/04)

1. Prepare a synthetic41-source fixture using normal ingestion/admission and real C-01 IDs. Manifest maps `chk_needle_77` to schema-valid chunk ID in source33 containing142.8bar; source41contains155.0bar. Use representative text, tokenizer and locators, not inflated unverified token_count fields. The first40sources alone total≥1,050,000normalized source tokens; exclude overlap duplication and decoy volume.
2. Select1–40 explicitly. Record deployed region/revision/model/index/SQL/client/readiness/cache configuration and fixture hashes before collection. Existing /healthz and SQL-only /readyz do not alone prove actual serving-instance readiness; qualify boot/readiness/request identity and dependencies before submitting core requests. A warmup hit to another instance is insufficient; cache state is declared separately and cannot be manipulated mid-run to hide failures.
3. When the planned runner is implemented, invoke `node scripts/eval-v3-scale.mjs --manifest <approved-manifest.json> --profile core --output <private-report-directory>`. **UNAVAILABLE today:** file/flags above are planned CLI contract, not existing working commands. Credentials use existing authenticated session/keyless flow; never paste tokens into logs or commit manifest secrets.
4. Expected:20warm sequential answers, nearest-rank19thlatency≤2,500ms; each exact142.8bar with needle citation; no155.0bar in answer or any prompt/history/cache context; every attempted request retained. Current status events are retrieving/generating/verifying and do not end the clock. Only fresh non-replayed validated factual content in final SSE can do so; the entire answer is buffered before that event. Failures/refusals cannot be counted as successful timings.
5. Collect wake cohort with full timings and readiness delays separately without latency threshold. Unknown readiness makes acceptance unavailable; slow warm requests stay warm. Run concurrency2two-Owner/two-notebook diagnostic separately, never concurrent same Owner/notebook requests.

## Evidence and boundary scenarios (`C-02/C-03`, NFR-PERF-01)

- Broad40-source question must include40matching Source Guides and retrieved original details; detailed follow-up finds original needle. Inject a stale/deselected guide/history turn/cache entry and require no content leakage.
- Test999,999/1,000,000/1,000,001source-token corpora with measured full-envelope overhead, at-capacity full original context and above-capacity bounded batches/recursive reductions. Assert every original chunk/segment processed. Inject a missing batch, oversized chunk and reducer overflow; require bounded handling or explicit failed attempt, no Completed partial artifact.
- During generation/cache use, delete/replace a captured revision or revoke access. Require failure without stale output; next selection change only affects next submission. Test another notebook's IDs and changed ACL fingerprint. Citation failure immediately refuses, no stripped-citation draft or silent regeneration.
- Run300source valid-quota corpus and include ingestion/media locators, report/map/table outputs and Computed-turn trace compatibility. Core chat latency excludes code/Studio turns but their own package constraints still apply.
- Run deterministic citation-ID/leakage gates each PR; judged hallucination/rejection/semantic support once per release candidate on the fixed deterministic stratified50-case golden sample, retaining IDs/category composition/dataset hash (Constitution2.0.0). Expected thresholds:<5%hallucination,1.0IDprecision,≥99%unsupported-question refusal,0leaked chunks, plus citation semantic support.

## Reporting (`NFR-PERF-01`, Gate v3.0)

Retain immutable manifest, all observations, stage timings, scope/prompt audit, SQL query plans/recall calibration, chunk coverage, separate core/wake/concurrency distributions and eval numerators/denominators. If deployed resources or runner are missing, report UNAVAILABLE and exact missing prerequisite. Current performance, quality, memory, EU cache capacity and full Gate v3.0 remain UNAVAILABLE. No runtime acceptance is established by this planning invocation.

## Latest-main regression boundaries (`NFR-PERF-01`, C-02/C-03, CC-02/06)

Use existing chunks/source_pages, current RequestScopedContextProvider/retrieveScopedChunks and strict ChatService history eligibility. Calibrate current40candidate/12result RRF60 against exact scoped ranking before tuning; retain notebook/source/revision SQL predicates and C-01 projection. Confirm broad40Guide routing uses3.1's durable revision/language-keyed ports and Studio uses3.3's durable repository/outbox. Current all-original keyset reads return an array; qualify application-memory and serialized-model bounds separately. Current report baseline4,000tokens/8chunks/concurrency4 still needs oversized-chunk segmentation and bounded composition/coverage. Do not recreate already-existing embeddings or indexes or claim refreshed designs implemented. Sandbox code/clarification turn projections follow3.2's actual service/model/draft/verifier/SSE integration.

The planned scripts/eval-v3-scale.mjs runner is absent. No deployed million-token, EU cache/model-envelope, prospective readiness, Studio bounded-memory, R6 or integrated v3 pass is established by document checks. Do not invoke infra start/warmup/deploy from this guide during a planning refresh.

## Second-main persistence baseline (`NFR-PERF-01`, C-02/C-03)

Use the deployed PostgreSQL app pool and applied0005–0008, preserving stored preferences, Guides, notes and reports. Record pool configuration/acquisition costs, schema hash, startup sweep completion and separately frozen database/persisted-record/provider-cache conditions before collection; memory fallback is not acceptance evidence. Add a separate restart diagnostic: Ready guides/reports survive, interrupted legacy reports require explicit retry, orphaned Pending guides regenerate, and remaining3.1/3.3 dispatch/publication fences are qualified before integrated acceptance. Include all incurred SQL/publication overhead in timing. Sources/history readiness before Send is distinct from serving-instance warm classification; no post-submission reset. Existing repository restart integration tests are baseline coverage, not million-token latency proof.
