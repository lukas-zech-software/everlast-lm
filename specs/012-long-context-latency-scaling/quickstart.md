# Validation Guide (`NFR-PERF-01`, C-02/C-03, NFR-EVAL-01..04)

## Current runnable specification check (`CC-01/02`)

From the dedicated feature worktree, run:

```sh
node scripts/check-spec-integrity.mjs
git diff --check
```

Expected: traceability/checklist checks and whitespace pass. These validate artifacts only. Existing package.json generic runners include `pnpm test:contract`, `pnpm test:unit`, `pnpm test:integration`, `pnpm eval:deterministic`, `pnpm eval:judged`, and `pnpm test:e2e`; dependencies/runner requirements must be installed first. They do not currently include the package3.4 deployed benchmark. Existing `pnpm dev` and `pnpm db:migrate` scripts print harness messages, so do not treat them as a running deployment/migration.

## Implementation prerequisites (`CC-02/06/07`, NFR-PERF-01)

Before implementation, documented Gate v2.0 pass; before integrated v3 acceptance, implemented3.1–3.3, shared contract compatibility, production SQL-backed C-02, enterprise EU model/cache adapters, and R6 qualified sandbox controls. D18 accepts2vCPU/1.5GB only; scratch64MB/no-network/read-only-input/15.0s actual termination/cleanup requirements remain. No cloud API enablement, IAM change or deployment is authorized by this guide.

After spec-derived Red tests exist, implement and pass contract/DB/worker/chat instrumentation coverage in [plan.md](plan.md). Freeze manifest and envelope/index parameters using calibration data distinct from acceptance data. Read [contracts/interfaces.md](contracts/interfaces.md) and [data-model.md](data-model.md) for timing, scope and report fields.

## Deployed needle scenario (`NFR-PERF-01`, NFR-EVAL-02/04)

1. Prepare a synthetic41-source fixture using normal ingestion/admission and real C-01 IDs. Manifest maps `chk_needle_77` to schema-valid chunk ID in source33 containing142.8bar; source41contains155.0bar. Use representative text, tokenizer and locators, not inflated unverified token_count fields. The first40sources alone total≥1,050,000normalized source tokens; exclude overlap duplication and decoy volume.
2. Select1–40 explicitly. Record deployed region/revision/model/index/SQL/client/readiness/cache configuration and fixture hashes before collection. Warm service readiness through normal authorized infrastructure flow before submitting core requests; cache state is declared separately and cannot be manipulated mid-run to hide failures.
3. When the planned runner is implemented, invoke `node scripts/eval-v3-scale.mjs --manifest <approved-manifest.json> --profile core --output <private-report-directory>`. **UNAVAILABLE today:** file/flags above are planned CLI contract, not existing working commands. Credentials use existing authenticated session/keyless flow; never paste tokens into logs or commit manifest secrets.
4. Expected:20warm sequential answers, nearest-rank19thlatency≤2,500ms; each exact142.8bar with needle citation; no155.0bar in answer or any prompt/history/cache context; every attempted request retained. No status event ends the clock. Failures/refusals cannot be counted as successful timings.
5. Collect wake cohort with full timings and readiness delays separately without latency threshold. Unknown readiness makes acceptance unavailable; slow warm requests stay warm. Run concurrency2two-Owner/two-notebook diagnostic separately, never concurrent same Owner/notebook requests.

## Evidence and boundary scenarios (`C-02/C-03`, NFR-PERF-01)

- Broad40-source question must include40matching Source Guides and retrieved original details; detailed follow-up finds original needle. Inject a stale/deselected guide/history turn/cache entry and require no content leakage.
- Test999,999/1,000,000/1,000,001source-token corpora with measured full-envelope overhead, at-capacity full original context and above-capacity bounded batches/recursive reductions. Assert every original chunk/segment processed. Inject a missing batch, oversized chunk and reducer overflow; require bounded handling or explicit failed attempt, no Completed partial artifact.
- During generation/cache use, delete/replace a captured revision or revoke access. Require failure without stale output; next selection change only affects next submission. Test another notebook's IDs and changed ACL fingerprint. Citation failure immediately refuses, no stripped-citation draft or silent regeneration.
- Run300source valid-quota corpus and include ingestion/media locators, report/map/table outputs and Computed-turn trace compatibility. Core chat latency excludes code/Studio turns but their own package constraints still apply.
- Run deterministic citation-ID/leakage gates each PR; judged hallucination/rejection/semantic support for retrieval/prompt/chat changes and release. Expected thresholds:<5%hallucination,1.0IDprecision,≥99%unsupported-question refusal,0leaked chunks, plus citation semantic support.

## Reporting (`NFR-PERF-01`, Gate v3.0)

Retain immutable manifest, all observations, stage timings, scope/prompt audit, SQL query plans/recall calibration, chunk coverage, separate core/wake/concurrency distributions and eval numerators/denominators. If deployed resources or runner are missing, report UNAVAILABLE and exact missing prerequisite. Current performance, quality, memory, EU cache capacity and full Gate v3.0 remain UNAVAILABLE. No runtime acceptance is established by this planning invocation.
