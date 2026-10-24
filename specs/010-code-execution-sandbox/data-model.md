# Data Model: Quantitative Code Execution Sandbox

Scope: FR-GC-08, FR-GC-06, C-01/C-02, NFR-SEC-02, NFR-EVAL-02/04. Planned schemas only; no migration or implementation is created here.

## Execution request (FR-GC-08, C-02)

An internal request binds UUID execution_id, notebook_id, thread_id, user_id, generation_epoch, submitted_at, output_language, resolved statistical intent, immutable active_source_revisions_snapshot and scoped input manifest. User identity, revisions and authorization are server-derived. Input manifest entries contain an internal filename, content digest, byte count, extracted values/units and supporting C-01 chunk IDs. Every entry belongs to the snapshot; no URL, credential, path traversal, or unselected content is accepted. IDs use existing UUID schemas; revisions are positive integers. C-01 remains unchanged.

No sandbox request exists while the assistant waits for statistical intent. The resolving reply uses current explicit source selection and rechecks the question's supporting data against that scope.

## ChatMessage.code_execution_trace (FR-GC-08, FR-GC-06)

Nullable JSONB on chat_messages; absent/null means no computation for legacy and clarification-only messages. Shared Zod schema is defined once in packages/contracts/src/package-v3-2.ts and imported by ChatMessageSchema. Version 1 envelope:

| Field | Contract |
| --- | --- |
| schema_version | Literal 1 |
| execution_id | UUID; immutable |
| state | CodeGenerating, SandboxRunning, Succeeded, TimedOut or Failed |
| attempts | Ordered 1–2 actual attempt records after execution begins; empty before code execution, including a terminal pre-execution failure |
| final_attempt_id | Null before terminal completion and for terminal pre-execution failure with zero attempts; otherwise the last actual attempt |
| published_artifact_ids | Only artifacts from a successful final attempt, empty on refusal/failure |
| failure_code | Nullable safe enum defined in contracts/interfaces.md |

Each attempt has UUID attempt_id, ordinal (1 or 2), UTF-8 code, stdout, stderr, nullable integer exit_code (null when killed/unknown; never invent exit 0), start/end timestamps, terminal reason and artifacts: [chart_urls]. chart_urls are authenticated application routes backed by private artifact IDs, not storage bearer links. Operational provider handles remain server-side. Capture runtime/package versions and the D18 default 2 vCPU / 1.5 GB profile in restricted execution metadata for operational diagnosis and integration-test reproducibility (D19; no R6 qualification prerequisite). Retain private provider sandbox handle and cleanup status until deletion is confirmed, so process-crash reconciliation cannot accidentally replay execution. No provider handle or credential is exposed in ChatMessage DTOs.

Stored source snapshots stay on ChatMessage; trace and artifacts cannot override them. Numeric computed outputs retain canonical value strings/units and supporting chunk IDs; response formatting must not re-compute or replace exact execution values with model arithmetic. Non-finite/invalid result encodings fail validation rather than publishing a guessed number.

## Chart artifact (FR-GC-08, FR-GC-02, NFR-SEC-02)

UUID artifact_id references execution/attempt/message, private object key/generation, image/png or image/svg+xml MIME, digest, byte size, source snapshot, validated citation IDs and publication state (private candidate, published, invalidated). Parent deletion cascades or durable cleanup removes storage objects; authorization is invalidated synchronously before asynchronous physical cleanup. Failed attempt artifacts remain private and are never included in published_artifact_ids. Drawer may retain their metadata without granting publication access. Source revocation hides the whole affected trace, including stdout/stderr and code containing source data.

## Transitions and consistency (FR-GC-08, FR-GC-06)

CodeGenerating → SandboxRunning → Succeeded | TimedOut | Failed. Attempt 1 exception permits one transition back through CodeGenerating for attempt 2. Timeout or memory violation on either attempt goes directly terminal, with zero retry. Other infrastructure/security/disk failures are terminal Failed. Success remains private until citation and authorization validation; publication failure records Failed/refusal and no output URLs. Controller cancellation from clear-chat/revocation destroys the sandbox, fences late results by generation_epoch and never recreates a deleted message.

Use the existing message transaction to persist validated answer, ordered trace and artifact references atomically. A single selected successful attempt is authoritative. Duplicate/out-of-order provider responses cannot append an extra attempt or replace a final result. Register generated object cleanup with existing notebook/source cleanup. Schema, SQL migration, all read/write mappings and consumers must land together; allocate migration number after predecessor integration, do not edit old migrations.

## Current main persistence integration (2026-10-21; FR-GC-08, FR-GC-06, C-02)

Main persists chat via `StoredMessage`/`MESSAGE_COLUMNS`/`publishTurn` and exposes `VisibleMessage` through `projectVisibleMessages`; extend every SELECT, INSERT, conversion and visibility gate, not only the older shared ChatMessageSchema. Web `lib/types.ts` and the v2 chat reader in `apps/api/src/v2/runtime.ts` must preserve ordinary saved-response behavior without exposing protected trace fields. Add a durable execution admission/cleanup record keyed by user/notebook/request ID with generation epoch, state, attempt ordinal, provider handle and lease/fence; recover crashes and destroy orphans without replaying Python. The process-local active-controller set remains an abort optimization. DEV-04 is closed: D16/specs/013 already persists v2 records, but supplies neither these sandbox records nor their admission/cleanup fences. Clarification-only messages are distinct from computed final results and retain zero execution attempts. Whole-table input manifests record coverage of requested data and exact supplied chunk IDs; incomplete evidence must not be labelled a complete calculation.

## Persisted v2 compatibility (second refresh; FR-GC-08, FR-GC-06, NFR-EVAL-04)

Migrations 0005–0008 are applied baseline, not future sandbox work. Add sandbox records after the current migration tail and package 3.1 integration without rewriting existing tables. V2 feedback/follow-ups are durable and have no message foreign key; `clearThread` explicitly deletes them in its transaction. Extend this same clear/publication boundary for traces and artifact invalidation; do not assume cascades remove every dependent record. V2 store consumers use the owning app's async pool scope, while chat SQL retains its injected pool. Persisted configuration/feedback and restart-safe reports do not imply an existing execution lease or reconciler.

## Pre-execution terminal result (FR-GC-08, FR-GC-06)

A request rejected before allocation, including unresolved statistical intent, has no execution trace. Once an execution_id is allocated, a terminal code-generation/provider-creation failure before any actual execute attempt is Failed with attempts:[], final_attempt_id:null and published_artifact_ids:[]. No exit_code or fictitious success/attempt is invented. An execute accepted with unknown outcome is an actual attempt with nullable exit_code and requires reconciliation without replay.

## Implementation flow-back (2026-10-24; `[010-code-execution-sandbox] T048`; FR-GC-08, FR-GC-06, NFR-SEC-02)

- **Migration `0010_code_execution.sql` & orphan ledger**: Adds `code_execution_trace JSONB` to `chat_messages` (widening `kind` CHECK to include `'clarification'`), `code_executions` (with partial unique index `code_executions_one_active_per_notebook_idx` on `notebook_id WHERE state IN ('CodeGenerating', 'SandboxRunning')`), `code_execution_sandboxes` (intentionally without a foreign key to `code_executions(id)` so deleted notebooks/threads retain their `execution_id` on the sandbox ledger until remote provider destruction is confirmed), and `chart_artifacts` (`state IN ('candidate', 'published', 'invalidated')`).
- **Synchronous source-deletion invalidation**: `deleteSource` (`packages/db/src/source-sync.ts`) synchronously updates `chart_artifacts SET state = 'invalidated'` whenever `source_snapshot @> jsonb_build_array(jsonb_build_object('source_id', sourceId))`, ensuring 0 ms chart staleness alongside `listVisibleMessages` redaction.
