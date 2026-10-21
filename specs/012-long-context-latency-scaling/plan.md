# Implementation Plan: Long-Context and Latency Scaling

**Branch**: `codex/v3-refresh2-3-4-20261021` | **Date**: 2026-10-21 | **Spec**: [spec.md](spec.md)
**Package Source**: `spec/requirements/v3/package_3_4_long_context_latency_scaling.md`
**SRS IDs in Scope**: `NFR-PERF-01`, supporting `C-01/C-02/C-03`, `FR-SI-01/02/03/05`, `FR-GC-01/02/06/08`, `FR-WM-04/07`, `NFR-SEC-01/02`, `NFR-EVAL-01..04` | **Release Gate**: Gate v3.0 #3 capacity component

## Summary (`NFR-PERF-01`, `C-01..C-03`)

Benchmark and tune the existing PostgreSQL C-02 hybrid retrieval path, adding scoped Source Guide routing; preserve full original-chunk processing for asynchronous Studio. Establish reproducible million-token correctness and validated-answer latency evidence. This is package3.4 only; ingestion, code execution, maps and tables remain prerequisite packages. The inherited 3.2 plan accepts the default 2vCPU/1.5GB sandbox under D18; R6 qualification remains pending. Planning completes without claiming runtime acceptance.

## Technical Context (`NFR-PERF-01`, `C-01..C-03`, `NFR-SEC-01/02`)

**Language/Version**: Existing TypeScript5.x strict ESM, Node.js24 and pnpm workspaces.
**Primary Dependencies**: Shared Zod contracts, existing Google ADK TypeScript grounded-chat integration and `@google/genai` enterprise adapter, Cloud Run/Cloud Tasks. Deterministic context planning and benchmarks use no new framework.
**Storage**: Single Cloud SQL PostgreSQL with pgvector cosine HNSW, `simple` PostgreSQL FTS/GIN and RRF; existing Cloud Storage for private normalized text and attempt evidence. The existing physical table is `chunks` with non-null vector(768), generated simple FTS, HNSW/GIN indexes and revision metadata; canonical viewer text is `source_pages` (D15). Do not create a second retrieval store or rewrite migration0002.
**Authentication & Residency**: Generic OIDC/SAML Identity Platform, Owner-only v3, notebook/document ACL rechecks, `europe-west4` enterprise no-training endpoints. Region exceptions: None. A benchmark runs only on approved deployed resources; no API enablement/deployment is performed here.
**Testing**: Existing Vitest, Playwright and deterministic eval runners; judged runner is guarded. Production hybrid retrieval and enterprise ADK model wiring already exist. New scaled fixture, private context-cache adapter, broad-guide routing and deployed benchmark runner remain planned/UNAVAILABLE. Local deterministic adapters cannot establish runtime latency or model quality.
**Execution Model**: Existing ADK chat loop receives C-02-owned evidence. Query classification, retrieval/ranking, token budgeting, cache eligibility, Studio batching and benchmark aggregation are deterministic TypeScript. Model calls extract/compose structured evidence inside deterministic Studio pipelines.
**Performance Goals**: 20 warm standard-chat runs; nearest-rank P95≤2,500ms (19th sorted value), submission→first validated answer token. Every run must answer142.8bar with the needle citation and zero decoy leakage. Wake-up measurements are separate without blocking latency threshold (D17/DEV-05). Code turns and Studio have their own package constraints.
**Constraints**: At least1,000,000 active tokens; needle fixture selected sources1–40≥1,050,000 tokens excluding source41. Million tokens is not a notebook quota cap: up to300 sources, each≤200,000,000bytes and≤500,000extracted words. All original chunks participate in Studio above capacity (D12). No silent token truncation or scope widening.
**Within-Release Prerequisites**: Inherit completed3.1,3.2,3.3 plans/contracts in that order; integrate existing v1 chat/C-02 and v2 Source Guides/C-03. `docs/gate-v2-live-evaluation.md` records Gate v2.0 approval by owner override with known failures and no post-fix live re-run; preserve this authority/evidence distinction. Full Gate v3.0 depends on every v3 package, including R6 qualification.

## Constitution Check (`CC-01`..`CC-08`)

Pre-research and post-design checks assess design compliance. Runtime gate outcomes remain unavailable.

| Gate | Principle | Pre-Research | Post-Design | Evidence |
| :--- | :--- | :--- | :--- | :--- |
| CC-01 | Traceability | PASS | PASS | SRS IDs on every design area; refinements mirrored in spec/card/architecture. |
| CC-02 | Test-first | PASS | PASS | Coverage below requires spec-derived Red before changes, Green/refactor after; tasks deferred. |
| CC-03 | Scope/snapshot | PASS | PASS | C-02-only source reads; exact snapshot/ACL/revision checks on retrieval, caches and publication. |
| CC-04 | Citations/leakage | PASS | PASS | Fully buffered factual answer validates before first answer event; zero leakage across retrieval/history/cache; no citation-stripped draft or retry. |
| CC-05 | Contracts/pipelines | PASS | PASS | Shared additive contracts only; unchanged C-01/C-02 public signature/C-03 lifecycle; deterministic Studio batches. |
| CC-06 | Release/package order | PASS | PASS | Inherited refreshed3.1–3.3 plans; documented v2 owner override disclosed without claiming measured pass; v3 gate/R6 pending. |
| CC-07 | Security/residency | PASS | PASS | Owner/document checks, EU enterprise processing and private evidence; no new source-admission path. |
| CC-08 | Platform/cost | PASS | PASS | Same TypeScript/Cloud Run/single SQL/GCS stack, scale to zero; no new service or fixed cost. |

## Project Structure and Ownership (`C-02`, `C-03`, `NFR-PERF-01`)

Artifacts here: spec.md, plan.md, research.md, data-model.md, contracts/interfaces.md, quickstart.md and existing requirements checklist. No tasks.md or executable implementation is created.

| Planned implementation boundary | Work and serialization |
| :--- | :--- |
| `packages/contracts/src/package-v3-4.ts`, `src/index.ts` | Add shared benchmark/internal evidence records; reuse existing C-01/C-02/C-03 and source-guide schemas, no duplicate chunk types. |
| `packages/db/src/scoped-context.ts`, `scope-guard.ts` | Reuse current `retrieveScopedChunks`, exact snapshot verification, SQL ranking and keyset `listAllSnapshotChunks`; qualify/tune existing indexes and add scoped exact fallback only if calibration requires it. No duplicate schema/index migration; any justified later change gets a new numbered migration. Guide storage already exists in applied0006;3.1 owns remaining re-sync dispatch and publication fencing. |
| `apps/api/src/services/source-context.ts`, `chat/service.ts`, `chat/model.ts`, `chat/verifier.ts`, `chat/draft.ts`, `routes/chat.ts`, `app.ts`/`server.ts` | Extend request-bound C-02 for broad Guide evidence; preserve current strict history eligibility, buffered enterprise ADK draft, verifyDraft/publishTurn and SSE `final` envelope. Add private serving-instance/readiness/stage observations without a replacement chat stack. |
| `apps/worker/src/studio/reports/batching.ts`, `pipeline.ts`, shared `studio/runner.ts`; `apps/api/src/v2/runtime.ts` composition | Add complete model-envelope budgeting, chunk segmentation, bounded reductions/private cache/coverage via shared helpers preserving reports and3.3 plugins. Existing keyset enumeration returns a whole array; page-sized SQL alone is not bounded application memory. Applied0008 and PostgresStudioArtifactRepository already persist reports;3.3 owns remaining new-kind admission/outbox, leases and publication fencing. Consume its ports without recreating storage. |
| `packages/evals/fixtures/v3/`, `src/latency.ts`, `src/report.ts`, tests; `scripts/eval-v3-scale.mjs` | Deterministic manifest, redaction-safe observations, percentile aggregator and deployed benchmark orchestration. Script/path are planned and UNAVAILABLE today. |
| `infra/` existing service/SQL configuration only | Record measured sizing/query config after qualification via existing OpenTofu flow; no new service or enablement. |

## Phase0 Research (`NFR-PERF-01`, `C-02/C-03`)

[research.md](research.md) resolves production gaps, scoped HNSW behavior, context budgets, complete evidence and benchmark statistics. Research is inline to honor one active package agent and no nested agents. No unresolved owner or technical planning questions remain. Capacity/latency qualification is implementation evidence, not an unresolved design choice.

## Phase1 Design (`NFR-PERF-01`, `C-01..C-03`)

1. Reuse migration0002's existing `chunks` (vector768, generated `simple` tsvector, cosine HNSW/GIN) and `source_revisions.embedding_model`. Ingestion already persists embeddings with canonical `source_pages`; do not recreate an index generation or invent a `document_chunks` migration. Qualify the deployed embedding model/dimensions and extension version in the benchmark manifest. Preserve applied migrations and existing content.
2. Reuse `RequestScopedContextProvider` and `retrieveScopedChunks`: snapshot verification in transaction, notebook/source/revision predicates on vector and FTS, deterministic RRF60, current defaults40candidates/12results, transaction-local iterative_scan relaxed_order/ef_search100, and defense-in-depth membership. Existing FTS builds a bounded OR lexeme query; do not replace it with a supposed existing websearch query. Calibrate ANN against exact scoped distance ranking, then freeze configuration before acceptance. Underfilled/low-recall scoped candidates justify additive exact fallback or tuning; never broaden filters. Keep current defaults until evidence supports a change rather than importing old64/16 settings as fact.
3. Deterministically classify explicit whole-collection synthesis requests as broad; ambiguous/detail requests retain detailed retrieval. Broad40-source fixture includes all40 matching Source Guides and original detail references. Guides are routing aids, cannot replace detailed evidence. Enforce a complete model envelope budget including instructions, eligible history, guide provenance, chunk markers and output reserve. If context cannot fit, return explicit capacity failure or use an already-approved complete-evidence Studio path; never truncate or silently drop a required guide/chunk.
4. Studio computes normalized-source token total independently from guide/decoy tokens. At≤1,000,000source tokens use full original text with private context caching only when full envelope fits the qualified model. Configure an approved model envelope large enough for this boundary; if unavailable, fail qualification rather than claim support. Above1,000,000 process every original chunk starting from current report bounds4,000source tokens/8chunks and extract concurrency4, further reduced for the actual model envelope; recursively reduce bounded structured findings retaining original references. An oversized individual chunk is subdivided with parent-chunk ID and offsets, never emitted as an over-budget exception. Coverage manifest must match every original chunk and every segment before publication. No unbounded all-findings compose request.
5. Caches include notebook, canonical exact source/revision set, effective authorization fingerprint, language, generation parameters, model/version and content digest. Recheck ACL/revisions before creation, every use/read and publication; invalidate on deletion/replacement/revocation. Same Owner with changed ACL cannot reuse the prior entry. Cache miss/expiry rebuilds from the same authorized original scope; failure cannot substitute a summary-only context. Provider cache creation/usage is enterprise EU only; do not store private content in generic logs.
6. Preserve D13 full-answer buffering/validation; start client monotonic timing immediately before submission dispatch and stop when the client receives the `final` SSE message containing the first non-replayed validated factual answer (current transport buffers the whole answer). There is no raw answer token stream; statuses are retrieving/generating/verifying. A replay cannot serve as a fresh measured generation. Include transport, queue, embedding/retrieval, generation, citation validation and persistence overhead on that path. Instrument stage durations diagnostically without subtracting them. Invalid citation refuses immediately; no valid answer timestamp is manufactured from status, raw model token or refusal.
7. Freeze benchmark manifest/configuration and the fixed20warm sample size before collection; this small acceptance fixture is not a statistical assurance of production P95. Use20warm sequential needle runs on one Owner notebook; nearest-rank P95=x[ceil(.95×20)]=x[19]. Every run must give142.8bar/needle citation, zero155.0bar prompt/answer decoy. Missing/failed answer records failure and infinite timing for aggregation; never drop failures. Additional two-Owner/two-notebook20-run concurrency2 profile diagnoses expected small-team usage, reports separate results and does not redefine the card's core acceptance. Separate wake cohort and 300-source quota-scale correctness/coverage scenarios are required reports; no invented wake threshold.

## Test Strategy and Evidence (`CC-02`, `NFR-PERF-01`, `NFR-EVAL-01..04`)

Create spec-derived failing tests before implementation for all FR001–010 and SC001–005:

| Test group | Required result |
| :--- | :--- |
| C-02 SQL/contract integration | Empty/foreign scope rejected; mixed revisions, hostile query, sparse ANN filter matches and exact fallback leak zero chunks. Existing C-01/C-02 consumers remain compatible. |
| Chat and cache boundaries | All40guides broad routing; detailed needle retained; history without known eligible provenance excluded; ACL/revision/delete races invalidate cache and publication; effective ACL changes alter keys. |
| Studio envelope/coverage | 999,999/1,000,000/1,000,001token boundaries; overhead budgets; oversized chunk segments; every original processed; missing/duplicate batch and missing segment fail; recursive reductions remain bounded; report/map/table lifecycle regressions. |
| Instrumentation/statistics | Status/raw tokens cannot end TTFT; full validation before event; prospective warm/wake classification, 20observations/19th statistic, 2,500/2,501ms, failed/missing outcomes, no denominator manipulation. |
| Million-token deployed acceptance | Sources1–40≥1,050,000tokens, real C-02/model/publication, all20correct needle/citations, P95≤2,500ms, decoy leakage0; record all attempted runs and wake cohort. |
| Integrated quality/security | Hallucination<5%; citation-ID precision1.0 with semantic support; out-of-source rejection≥99%; leakage0; multimodal locators, scope mutation, no summary-only evidence and sandbox admission status included. |

Deterministic citation/leakage suites each PR; judged faithfulness/rejection/semantic support once per release candidate on a fixed deterministic stratified50-case golden sample, recording IDs/category composition/dataset hash (Constitution2.0.0). Independent deployed timing and model results are UNAVAILABLE today. Gate v3.0 cannot pass until all package gates, R6 and these integrated evaluations pass. No plan gate is waived by documenting runtime work.

## Complexity Tracking (`CC-05/08`, D12/D17/D18)

No constitution violation or new deviation. D12 complete evidence, D17/DEV-05 warm acceptance and D18 sandbox envelope are preserved. New datastore/framework, broken C-02 signature, regional exception or weakened quality threshold requires an upstream decision before work proceeds.

## Latest-main baseline and readiness (`NFR-PERF-01`, `C-02/C-03`, CC-01/06)

Baseline main `dc25c46` is an ancestor. The preceding package refresh commit is `f2d438eb72f93ebfb71f52e13f8653ae6612021c`. Current `/healthz` is liveness; `/readyz` only checks SQL `SELECT 1`, so neither alone proves readiness of the actual serving instance plus configured model/retrieval/cache dependencies for an acceptance request. Define boot ID/readiness evidence and its mapping to the serving request before collection. A preparatory request to one Cloud Run instance does not establish another instance warm. Use current startup/SQL health as inputs, not invented production telemetry; unknown classification invalidates acceptance. Infrastructure warmup commands mutate resources and are not executed by this refresh.

D16/specs/013 closes DEV-04: applied migrations0005–0008 persist v2 preferences, Guides/overview/chat control, notes and reports using the app-scoped PostgreSQL pool. In-process jobs and single-API deployment remain.3.1 owns remaining durable re-sync/Guide dispatch and revision/attempt publication fences;3.3 owns new-kind admission/outbox, leases and transactional publication fences. Integrated benchmark setup must require those completed paths and current3.2 service/model/draft/verifier/SSE integration, not treat their refreshed plans as implemented. Preserve D15 canonical source_pages, D17/DEV-05 warmth and D18 managed sandbox. No critical product ambiguity remains after spec-first review; planned implementation questions are resolved in research. No tasks or analyze invocation before tasks exist.

## Persisted runtime benchmark conditions (`NFR-PERF-01`, C-02/C-03, D16/D17)

Freeze repository mode=PostgreSQL, applied migration version/hash, app pool identity/configuration, connection acquisition/SQL costs, restart/sweep completion and Guide/report recovery state in the benchmark manifest. Include database-backed preferences, history, Guide reads and publication costs actually incurred in submission-to-final timing; stage diagnostics cannot subtract them. Distinguish PostgreSQL buffer/cache state, persisted overview/Guide records and planned provider context caches. Declare each cache condition before runs; a Ready persisted Guide is not proof of a warm provider cache. Production acceptance cannot use no-pool memory fallback.

Keep single-API/in-process jobs as the current topology until separately qualified dispatch changes. Observe interrupted legacy reports as Failed with explicit new-attempt retry and orphaned Pending guides as requiring regeneration; retain Ready guides. Record startup sweep/pool readiness before prospective warm classification. Missing required guides, recovery failures or unknown readiness cannot be silently removed from the attempt record or turned into successful timings. The UI sources/history-ready Send guard is an eligibility control before submission, not a clock reset or model-readiness signal. Additional restart/cache profiles remain separate diagnostics; the20warm core, max40attempts, 19th P95≤2,500ms and two-Owner concurrency2 diagnostic are unchanged.
