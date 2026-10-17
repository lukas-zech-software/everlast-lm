# Phase 0 Research — Workspace Foundation

Date: 2026-10-17. Scope: FR-WM-01/04/07, C-01/C-02, NFR-SEC-01, NFR-EVAL-04 and Gate v1.0. The constitution, SRS, package cards, binding README and accepted architecture were reviewed first. Pre-research CC-01..CC-08 passed for the scoped design. One read-only research agent investigated transaction/storage risks; the package owner checked identity integration and consolidated the decisions. No project code or external service was modified by research.

## R1 — Atomic quota admission (FR-WM-07)

**Decision:** Serialize notebook creation on the owner row and source admission/release on the notebook row using PostgreSQL transactions and row locks; count occupied rows under the lock. Enforce consistent owner→notebook→source lock order and recheck state after waits. Batch results preserve input order; terminal failure is idempotent.

**Rationale:** Multiple Cloud Run instances cannot share a reliable process-local lock. PostgreSQL holds conflicting row-level operations until the transaction ends; this supports one atomic quota authority in the existing database. The specific count-under-parent-lock protocol is our design derived from that behavior, not a claimed vendor recipe. [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html).

**Alternatives considered:** Atomic materialized counters need reconciliation; serializable retries are valid but add avoidable retry paths for this small parent-scoped invariant. Unlocked COUNT+INSERT and in-memory mutexes fail concurrent final-slot acceptance. No Redis/distributed-lock service is needed.

## R2 — Permanent delete with object versioning (FR-WM-01/04)

**Decision:** Preserve architecture §5.2 versioning, enumerate and delete all generations, and maintain a payload-free durable cleanup operation. Fence application access immediately; track physical purge separately from the <=2 s relational/chunk cascade.

**Rationale:** Deleting a live version by object name can retain a noncurrent version; disabling versioning does not retroactively delete existing versions. Explicit generation deletion is required to meet the permanent-purge requirement. [Cloud Storage Object Versioning](https://cloud.google.com/storage/docs/object-versioning).

**Alternatives considered:** One delete-by-name or one empty listing is insufficient; disabling versioning would deviate from the accepted architecture and still leave prior versions. User-visible soft delete/restore is out of scope. The durable operation is reliability metadata, not a trash bin.

## R3 — Soft-delete policy and late uploads (FR-WM-01/04/07)

**Decision:** New application-content buckets must explicitly disable soft-delete retention while preserving object versioning. Deployment preflight checks for conflicting retention/holds and existing soft-deleted generations. Keep cleanup pending through outstanding upload capability expiry/session cancellation and quiescence; reject late completion callbacks, purge newly arrived objects, and require a final sweep before completion.

**Rationale:** Soft-deleted data cannot be permanently removed during its retention period; disabling the policy affects future deletion, not existing retained generations. Signed upload URLs can remain usable until expiry/key rotation; resumable-session URIs are bearer capabilities too. A database fence does not revoke storage capabilities. [Soft delete](https://cloud.google.com/storage/docs/soft-delete), [signed URLs](https://cloud.google.com/storage/docs/access-control/signed-urls).

**Alternatives considered:** Broad signing-key rotation for every notebook deletion is operationally inappropriate. A short TTL reduces exposure but is not immediate revocation. Switching all uploads to an API proxy changes the accepted ingestion path and is unnecessary if the UI distinguishes accepted deletion from verified object purge. No promise is made that an issued upload can never physically write a staging object; it can never recreate an accessible notebook/source or publish a result. Existing retained content blocks purge completion, not the design stage.

## R4 — Identity boundary (FR-WM-04, D6)

**Decision:** Use Identity Platform federation and its client ID token, verified by the server's supported Admin SDK with keyless service credentials. Bind the verified subject/project to a local owner record. Resource authorization remains a separate database check; normal token validation alone must not be treated as revocation checking. Require revocation-aware verification on protected operations and before publishing delayed work.

**Rationale:** Official guidance distinguishes verifying client ID tokens from custom tokens and notes that ordinary ID-token verification does not itself check revocation. Identity Platform supports OIDC provider configuration without choosing a specific corporate IdP here. [Verify ID tokens](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [Identity Platform OIDC](https://cloud.google.com/identity-platform/docs/web/oidc).

**Alternatives considered:** Trusting client user IDs/emails bypasses authorization. Implementing cryptographic verification manually adds unnecessary security responsibility. Choosing a corporate provider during this package would invent an unresolved organization decision; use a configurable adapter and isolated test principal fixtures instead. No production authentication bypass is introduced.

## R5 — Shared contract scope and revision fences (C-01/C-02)

**Decision:** Keep the two-argument C-02 public interface with principal/query/purpose/snapshot bound in request context. Return only the five-field C-01 projection; revision metadata belongs to the envelope/storage. Inspection is singleton full-source mode behind the same boundary, not a chat-selection mutation. Recheck source authorization/revisions before read and publication.

**Rationale:** This is required by [architecture §4.4](../../docs/solution-architecture.md#44-architecture-description), [binding rules](../../spec/requirements/README.md#binding-cross-package-rules) and constitution III/IV. Request provenance is more complete than displayed citations; otherwise history can leak an uncited deselected source.

**Alternatives considered:** A global mutable source selection, direct inspector database reads, summary-only provenance, and returning the latest revision all violate existing requirements. C-03 remains a v2 contract implementation, not speculative v1 runtime code.

## R6 — Minimal deterministic delivery (FR-WM-01/07, D1–D4)

**Decision:** Native Node HTTP and browser TypeScript/DOM modules for this package; Zod and the selected cloud/database SDKs at boundaries. Use the repository template's Node 24/TypeScript 5.x baseline, with exact versions pinned and verified at implementation. CRUD/quota/cleanup are deterministic; no model calls.

**Rationale:** The accepted stack specifies TypeScript SPA/BFF but no UI or HTTP framework. Native adapters fulfill the bounded notebook flows without inventing an architecture decision. This is a project design choice, not an assertion about comparative library performance.

**Alternatives considered:** React/Vite, Express/Fastify, an ORM or additional services would require a recorded decision before adoption. They are not necessary for this package's plan. Do not sneak them into harness setup.

## Remaining deployment prerequisites (not unresolved product behavior)

- Confirm GCP project, approved API enablement, configured corporate OIDC/SAML provider, service identities, and EU resource map before a live staging run (NFR-SEC-01, D3/D6).
- Check raw bucket versioning/retention/holds and outstanding upload-session cleanup semantics against a disposable integration bucket before claiming purge success (FR-WM-01).
- Declare benchmark fixtures, topology and cold/warm conditions; measure the exact SRS thresholds, not inferred latency (FR-WM-01/07).
- Generate tasks and run analyze before implementation. No new architecture deviation, scope amendment or constitution exception was identified; no cloud approval is implied by planning (Gate v1.0).
