# Data Model (`NFR-PERF-01`, `C-01/C-02/C-03`)

These are shared design records, defined once in packages/contracts when implemented. Existing C-01 chunks, source/revision pairs, guide payloads and C-03 attempts are imported, never duplicated.

## Existing retrieval and prerequisite records (`C-01/C-02`, `NFR-PERF-01`)

Reuse current physical `chunks` UUID primary key, notebook/source/revision foreign key, sequence, token_count, text, C-01 locator, non-null embedding vector(768), generated simple tsvector, cosine HNSW and GIN. `source_revisions.embedding_model` already exists. Canonical viewer text is PostgreSQL `source_pages` (D15). Preserve applied 0002; add a future numbered migration only for an evidenced gap, never recreate embeddings/indexes or document_chunks. Benchmark manifest records actual model/dimensions/index generation/configuration compatibility and deployment readiness; metadata is a planned evidence record, not a missing schema requiring speculative migration.

Source Guide revision/language records and report artifacts already persist in 0006/0008 under D16/specs/013. 3.1 owns remaining Guide re-sync dispatch/publication fences; 3.3 owns new-kind admission/outbox, leases and publication fences. Applied 0005–0008 must remain unchanged. 3.4 references exact typed IDs and C-02 authorization, without duplicate ownership. Current listAllSnapshotChunks keyset paging accumulates one array: page size 500 rows bounds individual queries, not total memory. Any internal iterator/staged coverage extension must maintain exact snapshot membership and backpressure without changing public C-02.

## Scoped corpus manifest (`C-02`, NFR-SEC-02, NFR-PERF-01)

Fields: notebook_id; principal subject; effective_authorization_fingerprint; canonical unique sorted source/revision pairs; ordered chunk IDs/digests/token counts; token_counting_model/version; source_token_total; manifest_hash; output_language; generation_parameters_hash. Chunk IDs use schema-valid IDs; fixture symbols are labels mapped to IDs. Only Ready, authorized exact revisions enter the manifest. Sum original normalized source tokens without overlap duplication; token ledger records how chunk overlap is excluded. Deselected source 41 never contributes active volume. Counting is reproducible with the qualified model tokenizer and records original-text/serialized-envelope counts separately.

Capture at submission, revalidate before every source/cache read and publication. A later checkbox change affects only later submissions; replacement/deletion/revocation invalidates the attempt, never substitutes a newer revision. An unknown revision is an error, not implicit revision 1.

## Context plan and cache entry (`NFR-PERF-01`, C-02/C-03)

Plan fields: request_id/attempt_id, scope_manifest_hash, purpose, query_class detailed|broad, mode retrieval|CachedFullContext|ChunkMapReduce, model/version, input_limit, output_reserve, instruction/history/guide/chunk-marker token counts, chosen detail chunk IDs, required guide IDs, batches/segments and coverage_manifest_id. Every serialized request fits its actual model envelope. Full cached mode requires source_token_total ≤1,000,000 and a qualified total envelope. Above boundary every original chunk is enumerated; no aggregate quota reduction is introduced.

Cache entry: opaque provider handle, cache_key, notebook_id, scope_manifest_hash, effective authorization fingerprint, language, generation/model/version parameters, content digest, created_at/expires_at and status Creating|Ready|Invalidated|Expired|Failed. Store operational metadata only; provider cache is private enterprise EU data. Creation failure cannot mark Ready. Expiry/cache miss recreates exact scope, not altered evidence. Invalidation immediately removes eligibility and schedules idempotent provider cleanup; a delayed cleanup cannot permit reads.

## Original evidence coverage (`C-01/C-03`, D12)

Coverage manifest: attempt_id, exact expected original chunk IDs/digests, expected segment intervals for subdivided chunks, batch IDs, completed batch/segment set and original references carried by extracted findings. Segments use parent_chunk_id+text offsets; original locators stay C-01. Validate contiguous full coverage, bounds, no gaps and deterministic duplicate handling. Failed/missing batch or segment prevents completion. Record successfully processed chunks even when no relevant finding is found, distinguishing coverage from evidence sufficiency. Each recursive reducer consumes bounded findings with original chunk references; evidence references may not be replaced by summary IDs.

C-03 remains Queued→Running→Completed|Failed|Cancelled. Context modes/batches are internal Running stages. Attempt/status/cancellation and scope continuity fence Completed publication atomically. Retry creates new authorization/scope/attempt; no stale batch result is reused blindly.

## Benchmark manifest and observation (`NFR-PERF-01`, NFR-EVAL-01..04)

Manifest fields: benchmark_id, source code commit, main baseline, v2 gate owner-override reference and measured-evidence status, immutable fixture hash/UUID mapping, source/chunk/token counts, model/tokenizer/embedding versions, prompt/validation config, cache condition, query list/class, Cloud Run revision/CPU/RAM/concurrency/min instances, SQL machine/memory/index/extension/query parameters, region, client network location/runtime, readiness classification rule, sample count 20, percentile_method nearest_rank, concurrency profile and all prerequisite gate evidence references.

Observation: run_id, manifest_hash, request_id, cohort warm|wake|invalid_environment, instance_boot_id and request-serving identity, readiness dependencies and evidence (SQL-only /readyz is insufficient), replayed flag, client_submission_monotonic_ms, client_first_validated_answer_ms|null (current final SSE factual receipt), terminal status, latency_ms|null, server stage durations, active_token_total, cited chunk IDs, needle correctness, prompt/answer leakage counts, coverage digest and quality report references. Raw private prompts/source contents are excluded from general logs; synthetic gate fixture traces are retained privately for inspection.

A failure/missing answer keeps terminal status and contributes positive infinity to timing aggregation, with explicit fail regardless of percentile. Unknown readiness makes the observation invalid_environment and invalidates the acceptance run rather than silently counting it warm. Every attempted run, exclusion reason and separate cohort is reported. A slow run cannot change cohort. All 20 warm successes must satisfy exact fact/citation/leakage assertions; P95 ≤2,500ms alone cannot compensate for incorrect answers.

## Release quality evidence (`NFR-EVAL-01..04`, CC-06)

Keep benchmark 20 warm observations distinct from judged release sample 50. Release record includes versioned golden dataset hash, fixed deterministic stratified sample IDs/category composition, candidate commit/model/configuration, metric numerators/denominators and result. Deterministic citation/leakage reports run each PR. Preserve prior owner override as approval authority with its remaining failures (the 2026-10-22 live re-run passes #3 while #1 and FR-GC-07 Shorter still fail); never encode it as measured green. No private source contents or credentials belong in generic telemetry.

## Persistence baseline metadata (`NFR-PERF-01`, C-02/C-03)

Extend the benchmark manifest with repository_mode=PostgreSQL, applied_migrations/hash, app_pool_configuration (no credentials), restart/sweep completion evidence, Guide/report recovery state and separately declared database-buffer, persisted-record and provider-cache conditions. Observations retain pool-wait/SQL stage timings as diagnostics within the full end-to-end duration, plus recovery errors and readiness uncertainty. These evidence records are planned; they do not require a new business-state datastore.

## Cache metadata and observation encoding

Cache metadata rules and the JSON encoding of failed observations are defined once in [contracts/interfaces.md](contracts/interfaces.md#context-cache-and-observation-encoding-nfr-perf-01-c-02c-03-nfr-sec-02-nfr-eval-04).
