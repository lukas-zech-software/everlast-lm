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
| attempts | Ordered 1–2 attempt records after execution; may be empty before execution |
| final_attempt_id | Null before terminal completion; refers to last actual attempt afterward |
| published_artifact_ids | Only artifacts from a successful final attempt, empty on refusal/failure |
| failure_code | Nullable safe enum defined in contracts/interfaces.md |

Each attempt has UUID attempt_id, ordinal (1 or 2), UTF-8 code, stdout, stderr, nullable integer exit_code (null when killed/unknown; never invent exit 0), start/end timestamps, terminal reason and artifacts: [chart_urls]. chart_urls are authenticated application routes backed by private artifact IDs, not storage bearer links. Operational provider handles remain server-side. Capture runtime/package versions and enforced limit profile in restricted execution metadata for R6 reproducibility.

Stored source snapshots stay on ChatMessage; trace and artifacts cannot override them. Numeric computed outputs retain canonical value strings/units and supporting chunk IDs; response formatting must not re-compute or replace exact execution values with model arithmetic. Non-finite/invalid result encodings fail validation rather than publishing a guessed number.

## Chart artifact (FR-GC-08, FR-GC-02, NFR-SEC-02)

UUID artifact_id references execution/attempt/message, private object key/generation, image/png or image/svg+xml MIME, digest, byte size, source snapshot, validated citation IDs and publication state (private candidate, published, invalidated). Parent deletion cascades or durable cleanup removes storage objects; authorization is invalidated synchronously before asynchronous physical cleanup. Failed attempt artifacts remain private and are never included in published_artifact_ids. Drawer may retain their metadata without granting publication access. Source revocation hides the whole affected trace, including stdout/stderr and code containing source data.

## Transitions and consistency (FR-GC-08, FR-GC-06)

CodeGenerating → SandboxRunning → Succeeded | TimedOut | Failed. Attempt 1 exception permits one transition back through CodeGenerating for attempt 2. Timeout or memory violation on either attempt goes directly terminal, with zero retry. Other infrastructure/security/disk failures are terminal Failed. Success remains private until citation and authorization validation; publication failure records Failed/refusal and no output URLs. Controller cancellation from clear-chat/revocation destroys the sandbox, fences late results by generation_epoch and never recreates a deleted message.

Use the existing message transaction to persist validated answer, ordered trace and artifact references atomically. A single selected successful attempt is authoritative. Duplicate/out-of-order provider responses cannot append an extra attempt or replace a final result. Register generated object cleanup with existing notebook/source cleanup. Schema, SQL migration, all read/write mappings and consumers must land together; allocate migration number after predecessor integration, do not edit old migrations.
