# Phase 0 Research: UI Skeleton & Quality Gates

Trace: FR-UI-01, NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01, C-01/C-02, Gate v1.0. Reviewed 2026-10-17 against merged main6f3d6b2. A read-only research agent checks official implementation evidence; no source text or credentials are sent for research.

## Decision: reuse accepted boundaries

Deterministic UI state and eval orchestration; model calls only in judged eval cases and the already-owned chat pipeline. No Studio generator. 1.1–1.3 provide real notebook, source, inspector and chat features; UI shell and test datasets can be prepared early, but full Gate v1.0 requires the integrated runnable application.

Rationale: [architecture](../../docs/solution-architecture.md) D1–D14 and constitution already choose the stack. Alternatives of new database, model-side unscoped retrieval, premature streaming, duplicated schemas or a new frontend framework are rejected because they violate accepted constraints or add unnecessary design scope.

## Decision: explicit state and evidence

Owner-only v1–v5; explicit nonempty Ready source IDs, immutable submission revisions, current authorization before reads/publication, singleton inspection without selection mutation. All source reads go through C-02; history/cache eligibility covers complete provenance, not only citations. Deleted/revoked content is hidden or unavailable; invalid factual citations cause immediate refusal before publication. Byte and word limits are independent and inclusive. All future roles, overview/chips/Source Guide, personas, re-sync, media and Studio features remain in their assigned releases.

Rationale: [interfaces](contracts/interfaces.md) resolves the package's adapter/state/dataflow details; [data model](data-model.md) retains exact limits from the cards. Test fixtures, processor/model IDs and endpoint capabilities are pinned at implementation and must be recorded in evidence; no unverified library behavior is assumed passed.

## Research evidence

See the source review appended below. Vendor limitations are tested through adapters; failing deployment preflight never becomes a skipped release test.

- **Repeatability (NFR-EVAL-01..04):** Model seeds are best-effort, not a determinism guarantee. Pin dataset/prompt/config/model/judge versions and save raw case outcomes and denominators; never reroll until pass. [Generation parameters](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/content-generation-parameters).
- **No-training evidence (NFR-SEC-01):** Enterprise data governance and OCR policy need separate endpoint/configuration evidence. No-training is distinct from retention; batch OCR may retain processing data temporarily. [Model data governance](https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance), [Document AI security](https://cloud.google.com/document-ai/docs/security).
- **Alternative rejected:** A fixed seed or developer-key smoke test is not release evidence. Missing credentials/endpoint/processor is UNAVAILABLE and cannot pass Gate v1.0.
