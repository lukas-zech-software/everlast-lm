# Phase 0 Research: Text/PDF Ingestion & Inspector

Trace: FR-SI-01, FR-SI-03, FR-SI-04, C-01/C-02, Gate v1.0. Reviewed 2026-10-17 against merged main6f3d6b2. A read-only research agent checks official implementation evidence; no source text or credentials are sent for research.

## Decision: reuse accepted boundaries

Deterministic upload/parse/OCR/chunk/index pipeline; no agent loop. C-02 owns retrieval and singleton inspection. Package 1.1 shared schemas, verified identity, notebook ownership, quota ledger and deletion fences must be integrated first. Package 1.3 consumes this package; citation fixtures avoid a circular dependency.

Rationale: [architecture](../../docs/solution-architecture.md) D1–D14 and constitution already choose the stack. Alternatives of new database, model-side unscoped retrieval, premature streaming, duplicated schemas or a new frontend framework are rejected because they violate accepted constraints or add unnecessary design scope.

## Decision: explicit state and evidence

Owner-only v1–v5; explicit nonempty Ready source IDs, immutable submission revisions, current authorization before reads/publication, singleton inspection without selection mutation. All source reads go through C-02; history/cache eligibility covers complete provenance, not only citations. Deleted/revoked content is hidden or unavailable; invalid factual citations cause immediate refusal before publication. Byte and word limits are independent and inclusive. All future roles, overview/chips/Source Guide, personas, re-sync, media and Studio features remain in their assigned releases.

Rationale: [interfaces](contracts/interfaces.md) resolves the package's adapter/state/dataflow details; [data model](data-model.md) retains exact limits from the cards. Test fixtures, processor/model IDs and endpoint capabilities are pinned at implementation and must be recorded in evidence; no unverified library behavior is assumed passed.

## Research evidence

See the source review appended below. Vendor limitations are tested through adapters; failing deployment preflight never becomes a skipped release test.

- **Canonical offsets (FR-SI-01/04):** PDF.js normalizes extracted whitespace; Document AI anchors refer to its Document.text and may have multiple segments or an omitted zero start. Normalize once per revision and use that same text for chunks/viewer. Verify non-BMP Unicode offset round trips and mixed native/OCR/table pages in a failing adapter fixture before freezing conversion. [PDF.js page API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html), [Document AI response](https://cloud.google.com/document-ai/docs/handle-response).
- **Scoped retrieval (C-02):** ANN filtering can reduce returned candidates; measure recall against exact scoped fixtures with decoys rather than broadening scope. Preserve architecture-selected transaction-local relaxed_order and deterministic result tie ordering; document bounded scan limits. [pgvector filtering and scans](https://github.com/pgvector/pgvector).
- **Alternative rejected:** Independent viewer extraction or raw provider offsets can misplace highlights; unscoped retrieval violates NFR-EVAL-04. These are required adapter tests, not evidence of successful implementation.
