# Data Model: Proactive Context Intelligence & Chat Control

All records are scoped to the listed SRS IDs. Inputs use shared UUID and chunk types; outer-trim text limits count Unicode code points (`FR-SI-02`, `FR-GC-04/05/07/09`, `FR-NM-02`). Source-derived reads and publications use `C-02` and the exact submission snapshot (`C-02`, `NFR-EVAL-04`). The Map-backed implementation is a test/local adapter only; Cloud SQL remains the production store (`D1`).

## SourceGuide (`FR-SI-02`)

- Identity: `(notebook_id, source_id, revision)`; source ID is a UUID and revision a positive integer.
- Fields: `status: GuidePending | GuideReady | GuideFailed`; `summary_md`; `key_topics[]`; `supporting_chunk_ids[]`; `generated_at?`; `error?`.
- Scope invariant: generation requests C-02 with exactly `[source_id]`; every C-01 chunk belongs to that source and captured revision; the guide never alters user selection.
- Validation: `<50` source words → one sentence and 1–3 topics; otherwise 100–250 summary words (or shorter only when evidence is insufficient) and 5–10 topics; topic ≤40 code points; topic/summary supporting chunk IDs must exist in scoped C-01 set. Never pad unsupported material.
- Transition: `GuidePending → GuideReady | GuideFailed`; retries are transient and bounded, source remains Ready and viewable on failure.

## NotebookOverview (`FR-GC-04`)

- Cache identity: exact `notebook_id`, sorted `(source_id, revision)` pairs, effective authorization key, output language, and generation parameters.
- Fields: `overview_md`; `starter_prompts[]`; `supporting_chunk_ids[]`; cache key; `generated_at`.
- Invariants: nonempty explicit Ready scope through C-02; 3–5 supported prompts ≤120 code points; all support IDs in snapshot; invalidate/hide immediately on any cache-key change or empty/deleted scope.

## Follow-up suggestions (`FR-GC-05`)

- Attached to latest assistant `ChatMessage`: `suggested_followups[]`, source/revision snapshot, `generated_at`.
- Invariants: hidden while streaming and after scope changes; 0–3 supported suggestions ≤100 code points, all based on current C-02 scoped chunks; refusal suggestions may point only to topics actually represented in that scope.

## ChatConfiguration (`FR-GC-07`)

- Key: `(notebook_id, owner_user_id)`.
- Fields: `style: default | learning_guide | analyst | custom`; `custom_instructions?`; `response_length: default | longer | shorter`; `updated_at`.
- Invariants: defaults are default/default; custom style requires 1–5,000 Unicode code points after trim; other styles cannot carry custom instructions; failed validation leaves the last saved record unchanged. Grounding and citation rules are not configurable.

## MessageFeedback (`FR-GC-09`)

- Idempotent key: `(message_id, user_id)`; ownership validated against requesting user's assistant message in notebook.
- Fields: `rating: up | down`; down category `hallucination | wrong_citation | incomplete | other`; optional comment (0–1,000 code points after outer trim); `created_at`.
- Invariants: down requires category; up has no category; selected user rating remains active.

## Saved response Note (`FR-GC-09`, `FR-NM-02`)

- Idempotency key: `(authenticated user_id, source_message_id)`.
- Stable request: `{ notebook_id: UUID, message_id: UUID }`.
- Stable response: `{ note: { id: UUID, notebook_id: UUID, source_message_id: UUID, title: string (1–200 code points), content_md: string, citations_json: Citation[], origin_type: "saved_response", read_only: true, created_at: ISO datetime } }`.
- Content and citations are copied from an authorized completed assistant message, validated against stored citations, and remain independent of chat-history deletion. Zero-citation messages remain saveable. Only Owner may create notes in v2.0.

## Cross-entity transitions

1. Ingestion completion makes a source `Ready` and schedules an independent Guide task (`FR-SI-02`).
2. Explicit scope change invalidates/hides the existing overview and follow-ups before new generation (`FR-GC-04/05`, C-02).
3. Completed assistant turn may acquire supported follow-ups, then feedback or saved-note actions (`FR-GC-05/09`).
4. Saving a response copies its content/citations before chat deletion; Package 2.3's note-to-source flow is the downstream Gate v2.0 #2 integration (`FR-NM-02/03`).
