# Data Model (`NFR-PERF-01`, `C-01/C-02/C-03`)

These are shared design records, defined once in packages/contracts when implemented. Existing C-01 chunks, source/revision pairs, guide payloads and C-03 attempts are imported, never duplicated.

## Retrieval index generation (`C-01`, `C-02`, NFR-PERF-01)

Extend physical `document_chunks` additively with embedding vector, model/version/dimension metadata and `simple` text-search vector. Retain existing UUID chunk primary key, notebook/source/revision foreign key, sequence, token_count, text and locator. Cosine HNSW, GIN FTS and existing composite scope B-tree share the same table. Index generation metadata records model/version/dimensions/build readiness so incompatible partial generations cannot answer requests. Legacy rows remain readable; backfill and atomic readiness precede retrieval admission. Do not rewrite existing migration0002 or accept null embeddings as successfully indexed.

Source Guide persistence uses existing typed payload and exact notebook/source/revision identity, publication state and provenance. Guide text is readable only via request-bound C-02 authorization. No source content is fetched by benchmark or Studio through direct SQL/GCS bypasses.

## Scoped corpus manifest (`C-02`, NFR-SEC-02, NFR-PERF-01)

Fields: notebook_id; principal subject; effective_authorization_fingerprint; canonical unique sorted source/revision pairs; ordered chunk IDs/digests/token counts; token_counting_model/version; source_token_total; manifest_hash; output_language; generation_parameters_hash. Chunk IDs use schema-valid IDs; fixture symbols are labels mapped to IDs. Only Ready, authorized exact revisions enter the manifest. Sum original normalized source tokens without overlap duplication; token ledger records how chunk overlap is excluded. Deselected source41 never contributes active volume. Counting is reproducible with the qualified model tokenizer and records original-text/serialized-envelope counts separately.

Capture at submission, revalidate before every source/cache read and publication. A later checkbox change affects only later submissions; replacement/deletion/revocation invalidates the attempt, never substitutes a newer revision. An unknown revision is an error, not implicit revision1.

## Context plan and cache entry (`NFR-PERF-01`, C-02/C-03)

Plan fields: request_id/attempt_id, scope_manifest_hash, purpose, query_class detailed|broad, mode retrieval|CachedFullContext|ChunkMapReduce, model/version, input_limit, output_reserve, instruction/history/guide/chunk-marker token counts, chosen detail chunk IDs, required guide IDs, batches/segments and coverage_manifest_id. Every serialized request fits its actual model envelope. Full cached mode requires source_token_total≤1,000,000 and a qualified total envelope. Above boundary every original chunk is enumerated; no aggregate quota reduction is introduced.

Cache entry: opaque provider handle, cache_key, notebook_id, scope_manifest_hash, effective authorization fingerprint, language, generation/model/version parameters, content digest, created_at/expires_at and status Creating|Ready|Invalidated|Expired|Failed. Store operational metadata only; provider cache is private enterprise EU data. Creation failure cannot mark Ready. Expiry/cache miss recreates exact scope, not altered evidence. Invalidation immediately removes eligibility and schedules idempotent provider cleanup; a delayed cleanup cannot permit reads.

## Original evidence coverage (`C-01/C-03`, D12)

Coverage manifest: attempt_id, exact expected original chunk IDs/digests, expected segment intervals for subdivided chunks, batch IDs, completed batch/segment set and original references carried by extracted findings. Segments use parent_chunk_id+text offsets; original locators stay C-01. Validate contiguous full coverage, bounds, no gaps and deterministic duplicate handling. Failed/missing batch or segment prevents completion. Record successfully processed chunks even when no relevant finding is found, distinguishing coverage from evidence sufficiency. Each recursive reducer consumes bounded findings with original chunk references; evidence references may not be replaced by summary IDs.

C-03 remains Queued→Running→Completed|Failed|Cancelled. Context modes/batches are internal Running stages. Attempt/status/cancellation and scope continuity fence Completed publication atomically. Retry creates new authorization/scope/attempt; no stale batch result is reused blindly.

## Benchmark manifest and observation (`NFR-PERF-01`, NFR-EVAL-01..04)

Manifest fields: benchmark_id, source code commit, immutable fixture hash/UUID mapping, source/chunk/token counts, model/tokenizer/embedding versions, prompt/validation config, cache condition, query list/class, Cloud Run revision/CPU/RAM/concurrency/min instances, SQL machine/memory/index/extension/query parameters, region, client network location/runtime, readiness classification rule, sample count20, percentile_method nearest_rank, concurrency profile and all prerequisite gate evidence references.

Observation: run_id, manifest_hash, request_id, cohort warm|wake|invalid_environment, instance_boot_id and readiness evidence, client_submission_monotonic_ms, client_first_validated_answer_ms|null, terminal status, latency_ms|null, server stage durations, active_token_total, cited chunk IDs, needle correctness, prompt/answer leakage counts, coverage digest and quality report references. Raw private prompts/source contents are excluded from general logs; synthetic gate fixture traces are retained privately for inspection.

A failure/missing answer keeps terminal status and contributes positive infinity to timing aggregation, with explicit fail regardless of percentile. Unknown readiness makes the observation invalid_environment and invalidates the acceptance run rather than silently counting it warm. Every attempted run, exclusion reason and separate cohort is reported. A slow run cannot change cohort. All20warm successes must satisfy exact fact/citation/leakage assertions; P95≤2,500ms alone cannot compensate for incorrect answers.
