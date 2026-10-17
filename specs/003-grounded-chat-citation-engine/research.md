# Phase 0 Research: Grounded Chat & Citation Engine

Trace: FR-GC-01, FR-GC-02, FR-GC-03, FR-GC-06, C-01/C-02, Gate v1.0. Reviewed 2026-10-17 against merged main6f3d6b2. A read-only research agent checks official implementation evidence; no source text or credentials are sent for research.

## Decision: reuse accepted boundaries

ADK LlmAgent for grounded reasoning; deterministic scope/history selection, response validation, citation mapping, persistence and publication gates. Integrated 1.1 identity/ownership/deletion fences and 1.2 C-02 retrieval/inspection, canonical C-01 chunks and session selection. 1.4 consumes chat/citation integration for the full release gate.

Rationale: [architecture](../../docs/solution-architecture.md) D1–D14 and constitution already choose the stack. Alternatives of new database, model-side unscoped retrieval, premature streaming, duplicated schemas or a new frontend framework are rejected because they violate accepted constraints or add unnecessary design scope.

## Decision: explicit state and evidence

Owner-only v1–v5; explicit nonempty Ready source IDs, immutable submission revisions, current authorization before reads/publication, singleton inspection without selection mutation. All source reads go through C-02; history/cache eligibility covers complete provenance, not only citations. Deleted/revoked content is hidden or unavailable; invalid factual citations cause immediate refusal before publication. Byte and word limits are independent and inclusive. All future roles, overview/chips/Source Guide, personas, re-sync, media and Studio features remain in their assigned releases.

Rationale: [interfaces](contracts/interfaces.md) resolves the package's adapter/state/dataflow details; [data model](data-model.md) retains exact limits from the cards. Test fixtures, processor/model IDs and endpoint capabilities are pinned at implementation and must be recorded in evidence; no unverified library behavior is assumed passed.

## Research evidence

See the source review appended below. Vendor limitations are tested through adapters; failing deployment preflight never becomes a skipped release test.

- **Structured output (FR-GC-01/02):** ADK outputSchema support does not prove citation validity; model/tool combinations need a compatibility fixture. Pre-retrieve through C-02, parse/validate complete response in application code, then publish. Do not add an unscoped tool or silently retry invalid citations. [ADK LLM agents](https://google.github.io/adk-docs/agents/llm-agents/).
- **Alternative rejected:** Direct token streaming violates D13 if later citations fail. Test malformed/truncated responses, cancellation, epoch/revision changes and supported/unsupported mixed questions. Preserve architecture's retrieval ordering; schema compliance and semantic entailment remain distinct checks.
