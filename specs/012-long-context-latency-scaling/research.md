# Research: Million-token context and latency (`NFR-PERF-01`)

Date:2026-10-20. Repository investigation and one primary pgvector reference; research performed inline under sequential package orchestration. All technical choices below are resolved; runtime proof remains pending.

## Production evidence versus fixtures (`C-02`, `NFR-PERF-01`)

**Decision:** Reuse existing boundaries but add the production database/model wiring and scaled evaluation; never benchmark a deterministic fallback as proof.
**Rationale:** `packages/db/migrations/0002_ingestion.sql` has `document_chunks` with notebook/source/revision B-tree only. `source-registry.ts` and source-guide storage in `package-v2-2.ts` use Maps. `apps/api/src/chat/agent.ts` has a deterministic default. Existing citation publication, Studio runner, report batching and eval metrics are useful seams, not million-token deployed evidence.
**Alternatives considered:** New vector service conflicts with D1/D4; claiming all-chunk in-memory scans satisfy retrieval scaling hides missing production behavior.

## Scoped hybrid retrieval (`NFR-PERF-01`, `NFR-EVAL-04`, C-02)

**Decision:** Add vector/FTS columns and indexes to the existing chunk table, initial64candidates per branch, RRF60 and16final chunks. Start HNSW m16/ef_construction64/ef_search100; keep exact scoped fallback. Preserve approved embedding model/dimensions, lock versions in benchmark manifest. Do not introduce an independent indexing store.
**Rationale:** The [pgvector primary documentation](https://github.com/pgvector/pgvector#filtering), retrieved2026-10-20 using ketch.scrape, explains that approximate index filtering can leave too few matches. Iterative scans (extension≥0.8.0) can recover candidates; exact scoped search is the compatibility path. The same documentation supports cosine HNSW, FTS fusion and exact-versus-approximate recall comparison. Deployment version must be recorded rather than inferred from current upstream docs.
**Alternatives considered:** Dropping scope filters is forbidden; tenant-wide text retrieval followed by application filtering risks leakage; adopting a new reranker/model introduces unnecessary latency before evidence demands it.

## Complete Studio context (`NFR-PERF-01`, D12, C-03)

**Decision:** Preserve cached full original context at the million-source-token boundary with qualified total model budget; above it, bounded map and recursive reduce with chunk/segment coverage. Reuse report batch helper through compatible common extraction, repair its current oversized-chunk exception by segmenting with original references. Keep queue and C-03 states unchanged.
**Rationale:** `reports/batching.ts` targets8,000tokens/40chunks but puts an oversized chunk alone, and `pipeline.ts` composes all findings in one request. Those seams need envelope checks and bounded reduction. Passing a large array to compose does not establish bounded memory or context capacity.
**Alternatives considered:** Source Guides alone discard details; sampling drops required evidence; concatenating every finding creates a second unbounded context. Chunk subdivision retains original C-01 IDs/offsets rather than adding a breaking locator variant.

## Cache and history eligibility (`C-02`, `FR-GC-06`, `NFR-SEC-02`)

**Decision:** Extend internal cache identity with effective ACL fingerprint, model and content versions; always reauthorize. Use the strict provenance eligibility helper for unknown/missing history provenance, not the permissive branch in chat/context.ts.
**Rationale:** `computeContextCacheKey` currently includes subject and scope but not mutable ACL identity/model. Chat history can currently allow empty provenance and default unknown revisions; production must derive actual revisions and reject unknown eligibility. Scope safety takes precedence over cache hit rate.
**Alternatives considered:** User ID alone is insufficient after ACL changes; caching raw scope-independent prompts or using stale guides can reintroduce deselected sources.

## Timing, statistics and expected load (`NFR-PERF-01`, D13/D15)

**Decision:** Client-monotonic submission-to-first-validated-answer time,20warm sequential observations, nearest-rank P95=19thsorted. Predeclare readiness/instance classification from boot readiness evidence; no latency-based reclassification. Report all attempts and separate wake cohort. Add concurrency2 diagnostic profile using distinct Owner notebooks to respect single-active-turn admission.
**Rationale:** The card specifies20runs/P95, not estimator or concurrency. Nearest rank makes the result reproducible. Existing full-answer citation validation belongs inside TTFT; progress is not an answer. A slow warm request stays warm. Load choice fits the owner's expected1–2simultaneous users without weakening required thresholds.
**Alternatives considered:** Averaging percentiles, dropping failures or choosing a warm cutoff from observed duration biases acceptance. Two simultaneous requests by the same Owner/notebook would test admission rejection rather than throughput.

## Qualification boundaries (`NFR-PERF-01`, `FR-GC-08`, NFR-EVAL-01..04)

**Decision:** Design is complete; package acceptance remains UNAVAILABLE until implemented/deployed. Preserve D16 managed2vCPU/1.5GB and all retained sandbox controls; require R6 evidence independently from chat latency. Gate v2.0 still precedes v3 implementation.
**Rationale:** Runtime performance, EU model/cache capacity, SQL sizing and R6 controls cannot be proven by Markdown or local fake endpoints.
**Alternatives considered:** Treating pending runtime measurements as a product question needlessly blocks planning; declaring them passed fabricates evidence. Neither is used.
