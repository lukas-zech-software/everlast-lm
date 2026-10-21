# Implementation Plan: Long-Context and Latency Scaling

**Branch**: `plan-v3/012-long-context-latency-scaling` | **Date**: 2026-10-20 | **Spec**: [spec.md](spec.md)
**Package Source**: `spec/requirements/v3/package_3_4_long_context_latency_scaling.md`
**SRS IDs in Scope**: `NFR-PERF-01`, supporting `C-01/C-02/C-03`, `FR-SI-01/02/03/05`, `FR-GC-01/02/06/08`, `FR-WM-04/07`, `NFR-SEC-01/02`, `NFR-EVAL-01..04` | **Release Gate**: Gate v3.0 #3 capacity component

## Summary (`NFR-PERF-01`, `C-01..C-03`)

Scale the existing C-02 path with PostgreSQL hybrid retrieval and source-guide routing; preserve full original-chunk processing for asynchronous Studio. Establish reproducible million-token correctness and validated-answer latency evidence. This is package3.4 only; ingestion, code execution, maps and tables remain prerequisite packages. The inherited 3.2 plan accepts the default 2vCPU/1.5GB sandbox under D18; R6 qualification remains pending. Planning completes without claiming runtime acceptance.

## Technical Context (`NFR-PERF-01`, `C-01..C-03`, `NFR-SEC-01/02`)

**Language/Version**: Existing TypeScript5.x strict ESM, Node.js24 and pnpm workspaces.
**Primary Dependencies**: Shared Zod contracts, existing Google ADK TypeScript grounded-chat integration and `@google/genai` enterprise adapter, Cloud Run/Cloud Tasks. Deterministic context planning and benchmarks use no new framework.
**Storage**: Single Cloud SQL PostgreSQL with pgvector cosine HNSW, `simple` PostgreSQL FTS/GIN and RRF; existing Cloud Storage for private normalized text and attempt evidence. Physical existing chunk table is `document_chunks`, not a second `chunks` store.
**Authentication & Residency**: Generic OIDC/SAML Identity Platform, Owner-only v3, notebook/document ACL rechecks, `europe-west4` enterprise no-training endpoints. Region exceptions: None. A benchmark runs only on approved deployed resources; no API enablement/deployment is performed here.
**Testing**: Existing Vitest, Playwright and deterministic eval runners; judged runner is guarded. New scaled fixture, production hybrid provider, cache adapter and integrated benchmark runner are planned and currently UNAVAILABLE. Local deterministic adapters cannot establish runtime latency or model quality.
**Execution Model**: Existing ADK chat loop receives C-02-owned evidence. Query classification, retrieval/ranking, token budgeting, cache eligibility, Studio batching and benchmark aggregation are deterministic TypeScript. Model calls extract/compose structured evidence inside deterministic Studio pipelines.
**Performance Goals**: 20 warm standard-chat runs; nearest-rank P95≤2,500ms (19th sorted value), submission→first validated answer token. Every run must answer142.8bar with the needle citation and zero decoy leakage. Wake-up measurements are separate without blocking latency threshold (D17/DEV-05). Code turns and Studio have their own package constraints.
**Constraints**: At least1,000,000 active tokens; needle fixture selected sources1–40≥1,050,000 tokens excluding source41. Million tokens is not a notebook quota cap: up to300 sources, each≤200,000,000bytes and≤500,000extracted words. All original chunks participate in Studio above capacity (D12). No silent token truncation or scope widening.
**Within-Release Prerequisites**: Inherit completed3.1,3.2,3.3 plans/contracts in that order; integrate existing v1 chat/C-02 and v2 Source Guides/C-03. Gate v2.0 evidence is mandatory before implementation. Full Gate v3.0 depends on every v3 package, including R6 qualification.

## Constitution Check (`CC-01`..`CC-08`)

Pre-research and post-design checks assess design compliance. Runtime gate outcomes remain unavailable.

| Gate | Principle | Pre-Research | Post-Design | Evidence |
| :--- | :--- | :--- | :--- | :--- |
| CC-01 | Traceability | PASS | PASS | SRS IDs on every design area; refinements mirrored in spec/card/architecture. |
| CC-02 | Test-first | PASS | PASS | Coverage below requires spec-derived Red before changes, Green/refactor after; tasks deferred. |
| CC-03 | Scope/snapshot | PASS | PASS | C-02-only source reads; exact snapshot/ACL/revision checks on retrieval, caches and publication. |
| CC-04 | Citations/leakage | PASS | PASS | Fully buffered factual answer validates before first answer event; zero leakage across retrieval/history/cache; no citation-stripped draft or retry. |
| CC-05 | Contracts/pipelines | PASS | PASS | Shared additive contracts only; unchanged C-01/C-02 public signature/C-03 lifecycle; deterministic Studio batches. |
| CC-06 | Release/package order | PASS | PASS | Inherited3.1–3.3 plans; Gate v2 prerequisite; full v3 gate and R6 remain pending. |
| CC-07 | Security/residency | PASS | PASS | Owner/document checks, EU enterprise processing and private evidence; no new source-admission path. |
| CC-08 | Platform/cost | PASS | PASS | Same TypeScript/Cloud Run/single SQL/GCS stack, scale to zero; no new service or fixed cost. |

## Project Structure and Ownership (`C-02`, `C-03`, `NFR-PERF-01`)

Artifacts here: spec.md, plan.md, research.md, data-model.md, contracts/interfaces.md, quickstart.md and existing requirements checklist. No tasks.md or executable implementation is created.

| Planned implementation boundary | Work and serialization |
| :--- | :--- |
| `packages/contracts/src/package-v3-4.ts`, `src/index.ts` | Add shared benchmark/internal evidence records; reuse existing C-01/C-02/C-03 and source-guide schemas, no duplicate chunk types. |
| `packages/db/src/scoped-retrieval.ts`, `scope-guard.ts`, next unused `migrations/` file | Add production scoped vector/FTS retrieval and revision-bound guide persistence; extend `document_chunks` with embedding metadata/tsvector and indexes. Preserve existing rows/readers. Serialize migration allocation and exports after3.1–3.3. |
| `apps/api/src/chat/context.ts`, `agent.ts`, `publication.ts`, `transport.ts`, chat route | Wire C-02 query-bound provider, history eligibility, prospective instance readiness and validated event instrumentation. Existing deterministic default model is a test double only. |
| `apps/worker/src/studio/context-planner.ts`, `reports/batching.ts`, shared runner integration | Add complete-corpus traversal, envelope budgets, private context cache and coverage manifest; share helpers with existing report/map/table plugins without changing their feature contracts. |
| `packages/evals/fixtures/v3/`, `src/latency.ts`, `src/report.ts`, tests; `scripts/eval-v3-scale.mjs` | Deterministic manifest, redaction-safe observations, percentile aggregator and deployed benchmark orchestration. Script/path are planned and UNAVAILABLE today. |
| `infra/` existing service/SQL configuration only | Record measured sizing/query config after qualification via existing OpenTofu flow; no new service or enablement. |

## Phase0 Research (`NFR-PERF-01`, `C-02/C-03`)

[research.md](research.md) resolves production gaps, scoped HNSW behavior, context budgets, complete evidence and benchmark statistics. Research is inline to honor one active package agent and no nested agents. No unresolved owner or technical planning questions remain. Capacity/latency qualification is implementation evidence, not an unresolved design choice.

## Phase1 Design (`NFR-PERF-01`, `C-01..C-03`)

1. Persist embeddings and FTS beside existing C-01 rows using an additive migration, never rewriting released migrations. Reuse the approved embedding model/dimensions from the deployed model registry and record them per index generation; do not mix dimensions or models. Start HNSW at m16/ef_construction64/ef_search100, FTS `simple`,64candidates per branch, RRF constant60 and final16detail chunks. These are tunable initial settings, frozen before acceptance. Reject missing/incompatible embeddings until rebuilt; never imply in-memory source registries are production retrieval.
2. C-02 validates explicit Ready IDs, captures exact revisions and effective ACL, then executes notebook/source/revision-filtered vector and FTS branches. Rank only scoped candidates and fetch original text through the same C-02 boundary. Use transaction-local HNSW tuning, iterative scan when deployed extension supports it, otherwise exact scoped distance search. Underfilled candidates may use an exact scoped fallback; never drop filters or fetch foreign text. Compare ANN to exact ranking on calibration corpus before freezing configuration.
3. Deterministically classify explicit whole-collection synthesis requests as broad; ambiguous/detail requests retain detailed retrieval. Broad40-source fixture includes all40 matching Source Guides and original detail references. Guides are routing aids, cannot replace detailed evidence. Enforce a complete model envelope budget including instructions, eligible history, guide provenance, chunk markers and output reserve. If context cannot fit, return explicit capacity failure or use an already-approved complete-evidence Studio path; never truncate or silently drop a required guide/chunk.
4. Studio computes normalized-source token total independently from guide/decoy tokens. At≤1,000,000source tokens use full original text with private context caching only when full envelope fits the qualified model. Configure an approved model envelope large enough for this boundary; if unavailable, fail qualification rather than claim support. Above1,000,000 process every original chunk using8,000source-token/40chunk initial batch bounds, further reduced for actual model envelope; recursively reduce bounded structured findings retaining original references. An oversized individual chunk is subdivided with parent-chunk ID and offsets, never emitted as an over-budget exception. Coverage manifest must match every original chunk and every segment before publication. No unbounded all-findings compose request.
5. Caches include notebook, canonical exact source/revision set, effective authorization fingerprint, language, generation parameters, model/version and content digest. Recheck ACL/revisions before creation, every use/read and publication; invalidate on deletion/replacement/revocation. Same Owner with changed ACL cannot reuse the prior entry. Cache miss/expiry rebuilds from the same authorized original scope; failure cannot substitute a summary-only context. Provider cache creation/usage is enterprise EU only; do not store private content in generic logs.
6. Preserve D13 full-answer buffering/validation; start client monotonic timing immediately before submission dispatch and stop when first validated factual answer event is received. Include transport, queue, embedding/retrieval, generation, citation validation and persistence overhead on that path. Instrument stage durations diagnostically without subtracting them. Invalid citation refuses immediately; no valid answer timestamp is manufactured from status, raw model token or refusal.
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

Deterministic citation/leakage suites each PR; judged faithfulness/rejection/semantic support on retrieval/prompt/chat PRs and release. Independent deployed timing and model results are UNAVAILABLE today. Gate v3.0 cannot pass until all package gates, R6 and these integrated evaluations pass. No plan gate is waived by documenting runtime work.

## Complexity Tracking (`CC-05/08`, D12/D17/D18)

No constitution violation or new deviation. D12 complete evidence, D17/DEV-05 warm acceptance and D18 sandbox envelope are preserved. New datastore/framework, broken C-02 signature, regional exception or weakened quality threshold requires an upstream decision before work proceeds.
