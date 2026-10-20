# Research: Proactive Context Intelligence & Chat Control

All decisions trace to `FR-SI-02`, `FR-GC-04`, `FR-GC-05`, `FR-GC-07`, `FR-GC-09`, `FR-NM-02`, `C-02`, `NFR-EVAL-02/04`, `D1`–`D4`, and `D13`.

## Decision: Deterministic pipelines with injected structured generation

- **Decision**: Orchestrate source guide, overview, and follow-up generation in plain TypeScript functions. Inject a narrow structured-generation interface; unit tests use a deterministic fake and validate returned data with Zod.
- **Rationale**: These workflows have fixed steps and do not need dynamic tool selection. This follows the architecture boundary for Source Guide and other deterministic generation (`FR-SI-02`, `FR-GC-04/05`, Constitution IV).
- **Alternatives considered**: ADK `LlmAgent`/agent loop (rejected: unnecessary autonomy, latency, and nondeterminism); heuristic-only production summaries (rejected: cannot represent the intended synthesis quality).

## Decision: Vertex AI Flash-Lite structured client (convergence 2026-10-20)

- **Decision**: Implement `StructuredGenerationClient` with the already-installed `@google/genai` SDK on Vertex AI (`vertexai: true`, `europe-west4`, `VERTEX_LOCATION` override, keyless ADC), model `gemini-2.5-flash-lite`, structured JSON output with a response schema, temperature 0, bounded timeout, Zod validation. Wire it in the API process under the same Vertex-configured condition as the grounded chat model and topic emoji (`FR-SI-02`, `FR-GC-04/05`, D3, D16, `NFR-SEC-01`).
- **Rationale**: Without a client the features answered `503`; the topic-emoji client already proves the pattern, so no new dependency or cloud API is needed.
- **Alternatives considered**: Gemini Developer API with an API key (rejected: `NFR-SEC-01`, enterprise data governance); ADK agent (rejected above); a Pro-tier model (rejected: cost/latency for short structured outputs).

## Decision: C-02 owns every source read and the source/revision snapshot

- **Decision**: Pipeline dependencies accept the existing `ScopedContextProvider` C-02 interface. Guide requests pass exactly `[source_id]`; overview/follow-up pass explicit active source IDs. Validate every returned chunk against the requested source/revision snapshot and recheck access before persistence/publication.
- **Rationale**: Prevents accidental selection widening and follows C-02 / zero-leakage rules (`NFR-EVAL-04`). Inspector viewing remains separate from chat selection.
- **Alternatives considered**: Read chunks from an ingestion return value or repository directly (rejected: bypasses the canonical source-read boundary); empty scope as “all ready” (rejected by FR-SI-03/Constitution III).

## Decision: Retries are bounded exponential backoff; failure never blocks source viewing

- **Decision**: Retry only errors identified as transient by the client, at most 3 total attempts (100 ms then 200 ms exponential delays). Do not retry permanent errors or invalid structured output. Persist `GuideFailed` after exhaustion while retaining Ready source content. Keep timing assertions separate from external model P95 measurement (`FR-SI-02`).
- **Rationale**: Testable retries and no source-read outage; do not let guide generation block ingestion/inspector.
- **Alternatives considered**: Retry synchronously without bound (rejected: blocks worker and misses latency target); mark the source failed (rejected by FR-SI-02).

## Decision: Shared Save-to-note API contract

- **Decision**: `POST /api/notebooks/{notebook_id}/chat/messages/{message_id}/note` accepts `{ "notebook_id": UUID, "message_id": UUID }`; authenticated user identity is never client-supplied. It returns `{ "note": { "id", "notebook_id", "source_message_id", "title", "content_md", "citations_json", "origin_type": "saved_response", "read_only": true, "created_at" } }`. The note uses the `(authenticated user_id, message_id)` idempotency key. Both package cards and this feature spec state this exact shape (`FR-GC-09`, `FR-NM-02`).
- **Rationale**: Stable DTO can be consumed by Package 2.3 without exposing user identity or making duplicate saves; citations are copied as structured links and content remains intact after chat deletion.
- **Alternatives considered**: Package-specific response shapes (rejected: cross-package drift); trust a caller-supplied owner ID (rejected: authorization boundary); serialize citations as prose only (rejected: not clickable/preservable).

## Decision: v2 records live in the API process until v3 (D16)

- **Decision**: Keep isolated Map-backed records keyed by notebook/user/message or exact scope key in the single API process (D16, SRS §5.5 DEV-04). Saved responses are written to the Package 2.3 notes store, not a separate 2.2 store. v3 moves these stores to PostgreSQL behind the same repository functions (`packages/db/migrations/v3-draft/`).
- **Rationale**: Owner decision 2026-10-19 for an earlier running proof of concept; access control, sources and chat stay in PostgreSQL, so v2 never decides access.
- **Alternatives considered**: New database (rejected by D1/D4); SQLite or file cache (rejected as unapproved store); global mutable single-user state without notebook/user keys (rejected for isolation).
