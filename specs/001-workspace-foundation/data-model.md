# Data Model — Workspace Foundation

Scope: FR-WM-01, FR-WM-04, FR-WM-07, C-01/C-02. This is a design, not an applied migration. [Plan](plan.md) assigns ownership; [shared contracts](contracts/shared-context.md) define the sole content boundary.

## Entities and Relationships

| Entity | Fields and invariants | Relationship / SRS |
| :--- | :--- | :--- |
| User | Internal immutable UUID; unique verified Identity Platform issuer/project + subject; timestamps. Do not use email as ownership key. | Owns <=100 live notebooks; parent row serializes create/delete admission (FR-WM-01/07). |
| Notebook | `id` UUID v4; `owner_id`; normalized `title`; `created_at`, `updated_at`. Empty/default title at creation is `Untitled notebook`. Later title values must be 1–100 Unicode code points after trim. | Owner FK; all child ownership derives through this parent (FR-WM-01/04). |
| Source admission / Source lifecycle | Stable source UUID, notebook FK, immutable admission attempt ID, media type/title metadata when supplied, `status` Uploading/Processing/Ready/Failed, actual/declared bytes, extracted words, active revision, failure reason. Content/chunk persistence is added by 1.2. | Composite uniqueness `(notebook_id,id)` supports child FKs. Uploading/Processing/Ready occupy a slot; Failed is only a dismissible error record (FR-WM-07). |
| Source revision | Immutable revision identifier, source/notebook identity, validated byte/word counts; actual revision content storage added by 1.2. New revision must not reuse prior chunk IDs. | Snapshot equality, never implicit substitution; revision replacement UI begins v3 (C-01/C-02). |
| Scope snapshot | Request-bound principal, notebook ID, exact selected `(source_id, revision)` set, authorization version, read purpose and optional query. | Immutable server-created provenance passed through workers and future chat messages; not additional C-01 fields (C-02). |
| Deletion fence / cleanup operation | Operation UUID, deleted notebook UUID, owner identity for status authorization, known object names/generations, upload capability/session expiry metadata, canceled attempt IDs, progress/error timestamps, completion state. No notebook title, chunk text, prompt, answer, or raw payload. | Independent of cascaded notebook so retry can finish; no restore API. Retain minimum fence metadata sufficient to reject stale jobs (FR-WM-01/04). |

Database columns storing derived caches/history/notes/artifacts in later packages must have a notebook parent FK and complete source/revision provenance. Their migrations must join the delete workflow before those features ship. Do not add empty notes or Studio tables in 1.1 merely to simulate their future existence (FR-WM-01, C-03).

## Validation and Admission (FR-WM-01/07)

- Title normalization is outer whitespace trim followed by Unicode-code-point length. No truncation or Unicode normalization that alters the user's title. A shared pure helper and Zod boundary validation use the same semantics. Failed rename leaves `title` and `updated_at` unchanged; successful rename advances `updated_at`.
- Notebook limit is 100 per owner; concurrent creates serialize on the owner row so 99+two requests yields exactly one new notebook. A retry only reuses an existing result if it carries the same admission/request key; a new deliberate create is a distinct operation.
- Source limit configuration accepts integers 50–300 inclusive, default 50. Invalid configuration fails startup; reducing a limit below existing occupancy never deletes data, but blocks new admission until below limit.
- Every source respects independent <=200,000,000 actual bytes and <=500,000 extracted words. Metadata is nonnegative; limits cannot be bypassed with an inaccurate declared size. Word counting is a shared ingestion validation policy owned by 1.2; 1.1 validates the numeric result supplied by the trusted worker, never a client word count.
- Batch admission is ordered: with 45/50 used, take the first five eligible submissions and return a separate quota rejection for the remaining five. Oversized entries are invalid before admission and do not consume a slot. Concurrent requests must see committed reservations, not just Ready sources.

## Transaction and Lock Ordering (FR-WM-04/07)

Use PostgreSQL transactions and row locks, not process-local mutexes. Normal source operations lock notebook then affected source rows in stable ID order. Notebook create/delete additionally locks owner first; any operation needing both uses owner → notebook → sources. External storage/network calls occur outside database locks. After waiting for a lock, recheck existence, ownership and current state.

Count live notebooks while holding the owner lock. Count Uploading/Processing/Ready admission rows while holding the notebook lock. All writers use this path, including failure transitions, cancellation and later import/re-sync callers. Prefer derived counts under the parent lock over an independently maintained counter that could drift. Child FKs and predicate checks add defense in depth.

Retry idempotency uses immutable operation/attempt IDs and conditional state transitions. A duplicate failure event cannot release capacity twice; a callback for Failed/cancelled/deleted admission cannot return it to Ready. Repeated object deletion treats already-absent generations as success. Bounded retries for transient transaction conflicts return a stable retryable error if exhausted, not a quota bypass.

## Source Transitions (FR-WM-07, FR-SI-01)

| From | Event | To / effects |
| :--- | :--- | :--- |
| None | Authorized admission with capacity and valid declared size | Uploading; occupies one slot atomically |
| Uploading | Trusted receipt validates actual size | Processing; same slot |
| Processing | Parser validates both limits, C-01 data commit succeeds, notebook/revision still valid | Ready; same slot; publication owned by 1.2 |
| Uploading / Processing | Validation failure or abandoned/cancelled attempt | Failed; no occupied slot; partial objects queued for purge |
| Failed | Owner dismisses error row | Removed error record; occupancy unchanged |
| Any | Notebook deleted | Child records purged; attempt fenced; no later transition allowed |

Re-sync in v3 uses the existing source slot and atomically replaces content only after validation; failed re-sync retains the prior Ready revision. This interface rule does not implement re-sync in v1.

## Notebook Deletion (FR-WM-01/04)

1. Owner confirms in UI. API re-verifies identity/ownership. Transaction locks owner and notebook, records minimal durable cleanup metadata including outstanding upload capabilities, cancels known jobs, and deletes notebook and content rows. The operation becomes inaccessible as content immediately; all subsequent notebook/child reads return 404. Database/vector deletion is measured against <=2 s, not disguised as asynchronous completion.
2. A durable cleanup row is committed atomically with deletion; enqueue Cloud Tasks after commit. If enqueue fails, replay pending rows on subsequent worker/API dispatch and fail readiness/alert if pending dispatch cannot recover. The tasks phase must provide a deterministic outbox-drain entrypoint and crash/restart test; retries never require recreating notebook data.
3. Enumerate and delete every live and noncurrent object generation for the notebook's unique namespace. Use generation preconditions to avoid deleting a different object after races. Versioning remains enabled. Application-content buckets are private and must allow hard deletion (soft-delete retention zero; no conflicting holds/retention locks). Known inaccessible retained generations prevent reporting purge complete.
4. Signed upload capabilities may remain usable until expiry and active resumable sessions require cancellation/expiry handling. Reject every completion callback once the notebook is gone; newly arriving objects are not indexed or made readable. Keep the cleanup operation pending through capability/session quiescence and repeat all-generation enumeration after it. A final sweep and no active writers are required before `Purged`.
5. Reads/downloads use authorized application paths, not reusable public URLs. Immediate authorization invalidation precedes physical cleanup. Later packages must not issue unrevocable historical-content access that survives deletion; signed-media invalidation must be integrated before such features ship.
6. Cleanup states: `Pending → Running → Purged`; retryable failures retain the operation and last error, never report Purged. This is internal reliability state, not soft-delete recovery. A failed purge is operator-visible. The API does not report completed deletion while object cleanup remains pending.

Publication must serialize with deletion/revision change: acquire a short read/publication fence on the parent/source records, recheck snapshot, and atomically commit the result or read decision; deletion wins if its fence is already committed. Slow model/network calls happen before this final fence. Responses already delivered before deletion cannot be retracted, but no later application read/publication can use stale authorization (C-02, NFR-EVAL-04).

## Residency and Security (NFR-SEC-01, FR-WM-04)

Use keyless service identities and least-privilege database/storage access. Authenticated user ID is never accepted from a request body as authority. No source text in cleanup logs; log operation IDs and error codes. No new API is enabled in this phase. Backups and cloud retention are not asserted to be instantly erased: deployment review must document their behavior separately and cannot use a retained recoverable object to claim active-store purge completion.
