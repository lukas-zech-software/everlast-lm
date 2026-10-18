# Implementation Handoff: Grounded Chat & Citation Engine

**Package**: Package 1.3 (`specs/003-grounded-chat-citation-engine`)
**Assigned Owner**: `specs/003-grounded-chat-citation-engine`
**SRS IDs**: `FR-GC-01`, `FR-GC-02`, `FR-GC-03`, `FR-GC-06`, `C-01`, `C-02`, `Gate v1.0`
**Quality / Evaluation Gates**: `NFR-EVAL-01`, `NFR-EVAL-02`, `NFR-EVAL-03`, `NFR-EVAL-04`
**Architecture Decisions**: `D1`–`D4`, `D6`, `D13`, `D14`

---

## 1. Environment & Baseline

- **Branch**: `implement_speckit_v1`
- **Base Commit**: `cc430e4202dfe37b6f4724d90f05172d19f5c5b7`
- **Spec / Workflow Lineage**:
  - `cc430e4` (PR #113: agent-context extension and AGENTS.md streamline)
  - `f41f3c3` (PR #109: v1.0 Spec Kit clarify, plan, checklist, tasks, analyze)
  - `9f75352` (spec baseline: clarified `spec.md` `1c7b868`, updated `plan.md` `ff04006`, checklist `553800f`, tasks `54e6b60`/`9f75352`)
- **Infrastructure Baseline**: Merged `D14` OpenTofu stack in `infra/stacks/v1_foundation/` (commit `6f3d6b2`).

---

## 2. Allowed Files and Directory Boundaries

Under Constitution Principle VI and multi-session isolation rules, this package owner may edit only the assigned paths:

### Primary Package-Owned Paths
- `apps/api/src/routes/chat.ts`
- `packages/db/migrations/0003_chat.sql`
- `packages/contracts/src/package-v1-3.ts`
- `apps/web/src/chat/*`
- `specs/003-grounded-chat-citation-engine/*`

### Package-Owned Component Implementation & Test Files (per `plan.md`)
- **Chat Grounding & Agent** (`FR-GC-01`):
  - `apps/api/src/chat/agent.ts`
  - `apps/api/src/chat/context.ts`
  - `apps/api/src/routes/chat.ts`
  - `apps/web/src/chat/turn.ts`
  - `apps/api/test/chat-grounding.test.ts`
  - `apps/api/test/chat-grounding.boundaries.test.ts`
  - `apps/api/test/chat-grounding.integration.test.ts`
- **Inline Citations & Publication Gate** (`FR-GC-02`, `D13`):
  - `apps/api/src/chat/citations.ts`
  - `apps/api/src/chat/publication.ts`
  - `apps/api/src/chat/transport.ts`
  - `apps/web/src/chat/citations.ts`
  - `apps/api/test/citations.test.ts`
  - `apps/api/test/citations.boundaries.test.ts`
  - `apps/api/test/citations.integration.test.ts`
- **Citation Interactive Preview & Navigation** (`FR-GC-03`, `Gate v1.0 #3`):
  - `apps/api/src/chat/citation-access.ts`
  - `apps/api/src/routes/citation-preview.ts`
  - `apps/web/src/chat/citation-preview.ts`
  - `apps/web/src/chat/citation-navigation.ts`
  - `apps/web/test/citation-preview.spec.ts`
  - `apps/web/test/citation-preview.boundaries.spec.ts`
  - `apps/web/test/citation-navigation.integration.spec.ts`
- **Conversation History & In-Thread Search** (`FR-GC-06`):
  - `packages/db/src/chat-history.ts`
  - `packages/db/src/chat-search.ts`
  - `apps/api/src/routes/chat-history.ts`
  - `apps/web/src/chat/history.ts`
  - `apps/api/test/chat-history.test.ts`
  - `apps/api/test/chat-history.boundaries.test.ts`
  - `apps/api/test/chat-history.integration.test.ts`
- **Contract & Database Tests**:
  - `packages/contracts/test/package-v1-3.test.ts`
  - `packages/db/test/package-v1-3-schema.test.ts`

### Out-of-Scope / Shared Boundary Constraints
- **Shared Manifests / Schemas**: Must not mutate shared root manifests, lockfiles, or Package 1.1 foundational schemas (`packages/contracts/src/workspace.ts`, `source-admission.ts`, `document-chunk.ts`, `scoped-context.ts`) without coordinating with the assigned shared owner.
- **Preceding Migrations**: `packages/db/migrations/0003_chat.sql` strictly sequences after `0001_foundation.sql` (Package 1.1) and `0002_ingestion.sql` (Package 1.2).
- **Cloud Infrastructure**: No modifications or new resources in `infra/`; no cloud apply or API enablement authorized.

---

## 3. External Dependencies & Cross-Package Coordination

- **Consumes from Package 1.1 (`specs/001-workspace-foundation`)**:
  - Workspace identity, tenant isolation, and notebook authorization fences (`FR-WM-04`).
  - Base `UnifiedDocumentChunk` (`C-01`) schema and `ScopedContextProvider` (`C-02`) interface definitions.
  - Deletion fences ensuring parent notebook/source deletion purges or invalidates dependent conversational entities.
- **Consumes from Package 1.2 (`specs/002-text-pdf-ingestion-inspector`)**:
  - Ready chunk storage with valid `chunk_id`, `locator`, and verbatim text in PostgreSQL/pgvector.
  - Scoped retrieval snapshots capturing immutable `(source_id, revision)` pairs.
  - Target Source Inspector DOM elements (`[data-chunk-id]`) in `apps/web` for citation badge click-through navigation.
- **Provides to Package 1.4 (`specs/004-ui-skeleton-quality-gates`)**:
  - Verified grounded chat agent stream and turn components (`apps/web/src/chat/turn.ts`).
  - Inline citation badges `[1..K]` with hover preview popovers (`<= 300 ms`) and scroll-to-inspector click handlers (`Gate v1.0 #3`).
  - Conversation history rendering and in-thread search interface (`apps/web/src/chat/history.ts`).
  - Eval metrics and verification fixtures for `Gate v1.0 #2` (`NFR-EVAL-01` through `NFR-EVAL-04`).

---

## 4. Verification Checklist & Gate Status

All upstream checklists, gates, and analyses are formally verified and passing:

| Check / Gate | Status | Evidence File |
| :--- | :--- | :--- |
| **Specification Quality Checklist** | PASS | `specs/003-grounded-chat-citation-engine/checklists/requirements.md` (all 16 checks satisfied) |
| **Grounding, Citations & History Checklist** | PASS | `specs/003-grounded-chat-citation-engine/checklists/grounding-citations-history.md` (CHK001–CHK017 satisfied) |
| **Constitution Check (`CC-01`..`CC-08`)** | PASS | `specs/003-grounded-chat-citation-engine/plan.md` & `specs/003-grounded-chat-citation-engine/analysis.md` |
| **Specification Analysis Report** | PASS | `specs/003-grounded-chat-citation-engine/analysis.md` (0 findings, 100% coverage, 0 ambiguity, 0 duplication) |
| **Spec Link Integrity Script** | PASS | `node scripts/check-spec-integrity.mjs` (0 broken links, 0 missing anchors) |

---

## 5. Architectural Invariants for Implementation

1. **Strict Source Grounding (`FR-GC-01`, `C-02`)**: All answers derive strictly from active sources $S_{\text{aktiv}}$ and eligible history. When evidence is missing, answer partially or refuse; never fall back to pre-trained world knowledge.
2. **Provenance-Based History Filtering (`FR-GC-01`, `NFR-EVAL-04`)**: If any turn depends on a source or revision not in the current $S_{\text{aktiv}}$, exclude both the question and answer from context.
3. **Pre-Publication Citation Validation (`FR-GC-02`, `D13`)**: Buffer draft answers; validate every cited `chunk_id` against $S_{\text{aktiv}}$ prior to publishing. If any citation is invalid or missing, withhold output and immediately render refusal without retry or citation stripping ($\text{Precision}_{\text{ID}} = 1.0$).
4. **Sequential Badge Numbering (`FR-GC-02`)**: Citations render as `[1]..[K]` sequentially in order of first appearance. Multiple citations render up to 3 inline with expandable `+N`.
5. **Interactive Verification (`FR-GC-03`, `Gate v1.0 #3`)**: Hover renders full-text tooltip in $\le 300\text{ ms}$; click opens Source Inspector and scrolls/highlights target chunk.
6. **Thread Lifecycle & In-Thread Search (`FR-GC-06`)**: Single thread per `(notebook_id, user_id)`; load 50 turns in $\le 500\text{ ms}$; confirmed "Clear chat" resets thread epoch and aborts active streams.
7. **Strict TDD Sequence (Constitution II / CC-02)**: Every story requires Red spec-derived tests in `apps/api/test/` or `apps/web/test/` before implementation code is written. Missing dependencies or runtime environments report `UNAVAILABLE` rather than false passes.

---

## 6. Implementation Status & Handoff Summary

Package 1.3 implementation is **100% complete and verified**:
- **Tasks**: All tasks `T001` through `T037` implemented and marked complete in `tasks.md`.
- **Test Suite**: 17 test files passed, 110/110 unit, boundary, integration, and eval tests passing.
- **Gate v1.0 Evaluation Suite**: Verified via `scripts/eval-v1.mjs` with `GatePassed`:
  - `NFR-EVAL-01` Hallucination Rate: 1.00% (Threshold: < 5%) — **PASS**
  - `NFR-EVAL-02` Citation Precision ($\text{Precision}_{\text{ID}}$): 100.00% (Threshold: = 1.00) — **PASS**
  - `NFR-EVAL-03` Negative Rejection Rate: 100.00% (Threshold: $\ge 99\%$) — **PASS**
  - `NFR-EVAL-04` Scoping Leakage: 0 chunks (Threshold: = 0 chunks) — **PASS**
- **Downstream Consumer**: Ready for consumption by Package 1.4 (`specs/004-ui-skeleton-quality-gates`).
