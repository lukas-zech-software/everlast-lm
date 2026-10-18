# Validation Log: Package 1.2 (Text/PDF Ingestion & Source Inspector)

**Package**: `specs/002-text-pdf-ingestion-inspector`
**Branch**: `implement_speckit_v1`
**Base Commit**: `cc430e4202dfe37b6f4724d90f05172d19f5c5b7`

---

## Task T003: Package DTOs and Integration Boundary Tests (RED Phase)

- **Date**: 2026-10-18
- **Command**:
  ```bash
  export PATH="/opt/homebrew/n/versions/node/24.14.0/bin:/opt/homebrew/bin:$PATH" && pnpm --filter @everlast/contracts exec vitest run test/package-v1-2.test.ts
  ```
- **Test File**: `packages/contracts/test/package-v1-2.test.ts`
- **Result**: **RED (10 failed | 19 passed | 29 total)**

### Observed Requirement-Related Failures:
1. **`PKG12-04` (`byte_size > 200,000,000 bytes`)**:
   - *Requirement*: Constitution Principle II specifies: `200 MB` means `200,000,000` bytes inclusive. Over-limit inputs must be rejected rather than silently truncated.
   - *Failure*: Initial schema used binary `200 * 1024 * 1024` (209,715,200), allowing `200,000,001` bytes instead of rejecting.
   - *Error*: `AssertionError: expected [Function] to throw an error`
2. **`PKG12-10` (`title with 0 code points after outer trim`)**:
   - *Requirement*: Titles must be between 1 and 100 Unicode code points after trimming outer whitespace (`Constitution II`, `FR-SI-01`).
   - *Failure*: `z.string().min(1).max(100)` accepted `"   "` (whitespace-only string).
   - *Error*: `AssertionError: expected [Function] to throw an error`
3. **`PKG12-11` (`title with 100 Unicode code points including multi-byte emoji`)**:
   - *Requirement*: Constitution Principle II: text limits count Unicode code points (surrogate pairs count as 1 code point).
   - *Failure*: `z.string().max(100)` checked UTF-16 code units (length 110), incorrectly rejecting a 100-code-point title with emoji.
   - *Error*: `ZodError: String must contain at most 100 character(s)`
4. **`PKG12-14` (`strict schema on Source`)**:
   - *Requirement*: Schema strictness prevents uncontracted fields from leaking through DTO boundaries (`C-01`, `C-02`).
   - *Failure*: `SourceSchema` was non-strict, permitting extra properties.
   - *Error*: `AssertionError: expected [Function] to throw an error`
5. **`PKG12-17` (`empty or whitespace-only text for CopiedTextInput`)**:
   - *Requirement*: Copied text input requires 1 char to 500,000 words after outer trim (`FR-SI-01`).
   - *Failure*: Schema accepted whitespace-only strings.
   - *Error*: `AssertionError: expected [Function] to throw an error`
6. **`PKG12-18` (`text exceeding 500,000 words for CopiedTextInput`)**:
   - *Requirement*: `500,000` extracted words is a separate inclusive limit applied to every source type (`FR-WM-07`, `FR-SI-01`).
   - *Failure*: `CopiedTextInputSchema` had no word count limit check on the input string.
   - *Error*: `AssertionError: expected [Function] to throw an error`
7. **`PKG12-20` (`title > 100 code points or whitespace-only on CopiedTextInput`)**:
   - *Requirement*: Default title is `"Pasted text"`, but custom title must satisfy 1–100 code points after outer trim (`FR-SI-01`).
   - *Failure*: Schema permitted `"   "` for title when provided.
   - *Error*: `AssertionError: expected [Function] to throw an error`
8. **`PKG12-21` (`strict schema on CopiedTextInput`)**:
   - *Requirement*: Strict contract prevents unintended fields.
   - *Failure*: Schema permitted extra unknown properties.
   - *Error*: `AssertionError: expected [Function] to throw an error`
9. **`PKG12-25` (`strict schema on ActiveSourceSelection`)**:
   - *Requirement*: Strict contract for `C-02` scoping parameters.
   - *Failure*: Schema permitted extra unknown properties.
   - *Error*: `AssertionError: expected [Function] to throw an error`
10. **`PKG12-29` (`strict schema on SourceInspectorQuery`)**:
    - *Requirement*: Strict contract for Source Inspector queries (`FR-SI-04`).
    - *Failure*: Schema permitted extra unknown properties.
    - *Error*: `AssertionError: expected [Function] to throw an error`

---

## Task T004: Package DTOs and Schemas Implementation (GREEN Phase)

- **Date**: 2026-10-18
- **Command**:
  ```bash
  export PATH="/opt/homebrew/n/versions/node/24.14.0/bin:/opt/homebrew/bin:$PATH" && pnpm --filter @everlast/contracts exec vitest run test/package-v1-2.test.ts
  ```
- **Test File**: `packages/contracts/test/package-v1-2.test.ts`
- **Result**: **GREEN (29 passed | 0 failed | 29 total)**
- **Typecheck Result**: `pnpm --filter @everlast/contracts typecheck` passed cleanly (`tsc --noEmit` exit code 0).

### Implemented Schema Validations in `packages/contracts/src/package-v1-2.ts`:
1. `MAX_SOURCE_BYTE_SIZE = 200_000_000`: Strict 200 MB limit enforced per Constitution II (`byte_size <= 200,000,000`).
2. `MAX_SOURCE_WORD_COUNT = 500_000`: Strict 500,000 extracted word limit enforced per Constitution II / FR-SI-01.
3. `SourceTitleSchema`: Unicode code point counting via `Array.from(val.trim()).length`, ensuring surrogate pairs (emoji) count as 1 code point, rejecting empty/whitespace-only titles (0 code points) and titles exceeding 100 code points.
4. `SourceSchema`: Added `.strict()` to prevent uncontracted properties from leaking across boundaries, validated positive integer `revision_id`, UUIDs for `id`, `notebook_id`, `attempt_id`.
5. `CopiedTextInputSchema`: Enforced minimum 1 non-whitespace character and maximum 500,000 words on `text`, enforced 1-100 code points on `title`, defaulted title to `"Pasted text"`, and enforced `.strict()`.
6. `ActiveSourceSelectionSchema`: Enforced UUIDs for `notebook_id` and all `active_source_ids`, and enforced `.strict()`.
7. `SourceInspectorQuerySchema`: Enforced UUIDs for `source_id` and optional `highlight_chunk_id`, and enforced `.strict()`.

---

## Task T005: Persistence, Rollback, and Deletion Schema Invariant Tests (RED Phase)

- **Date**: 2026-10-18
- **Command**:
  ```bash
  export PATH="/opt/homebrew/n/versions/node/24.14.0/bin:/opt/homebrew/bin:$PATH" && pnpm --filter @everlast/db exec vitest run test/package-v1-2-schema.test.ts
  ```
- **Test File**: `packages/db/test/package-v1-2-schema.test.ts`
- **Result**: **RED (11 failed | 0 passed | 11 total)**

### Observed Requirement-Related Failures:
1. **`DB-12-01` (`0002_ingestion.sql migration exists`)**:
   - *Requirement*: Package 1.2 requires persistence migration `packages/db/migrations/0002_ingestion.sql` serialized after Package 1.1 (`C-01`, `C-02`, `FR-WM-04`).
   - *Failure*: Migration file `0002_ingestion.sql` does not exist.
   - *Error*: `AssertionError: expected false to be true`
2. **`DB-12-02` (`defines source_revisions table with required schema columns`)**:
   - *Requirement*: Data model requires immutable `source_revisions` entity with `notebook_id`, `source_id`, `revision`, `byte_size`, `word_count`, and `created_at` (`FR-SI-01`, `FR-WM-04`).
   - *Failure*: Table definition missing.
   - *Error*: `Error: Migration file not found: 0002_ingestion.sql`
3. **`DB-12-03` (`enforces composite primary key on source_revisions`)**:
   - *Requirement*: Composite primary key on `(notebook_id, source_id, revision)`.
   - *Failure*: Missing primary key definition.
   - *Error*: `Error: Migration file not found: 0002_ingestion.sql`
4. **`DB-12-04` (`enforces composite foreign key referencing sources with ON DELETE CASCADE`)**:
   - *Requirement*: Cross-notebook isolation and cascading deletion require composite FK `(notebook_id, source_id)` referencing `sources(notebook_id, id) ON DELETE CASCADE`.
   - *Failure*: Missing foreign key constraint.
   - *Error*: `Error: Migration file not found: 0002_ingestion.sql`
5. **`DB-12-05` (`enforces nonnegative byte_size, nonnegative word_count, and positive revision`)**:
   - *Requirement*: Entity invariants: `revision > 0`, `byte_size >= 0`, `word_count >= 0`.
   - *Failure*: Missing CHECK constraints.
   - *Error*: `Error: Migration file not found: 0002_ingestion.sql`
6. **`DB-12-06` (`defines document_chunks table with required C-01 columns and private keys`)**:
   - *Requirement*: `document_chunks` table storing `C-01` projection (`chunk_id`, `source_id`, `revision`, `token_count`, `text`, `locator`) plus private keys (`notebook_id`, `sequence`).
   - *Failure*: Table definition missing.
   - *Error*: `Error: Migration file not found: 0002_ingestion.sql`
7. **`DB-12-07` (`enforces foreign key from document_chunks to source_revisions with ON DELETE CASCADE`)**:
   - *Requirement*: Cascading deletion from `source_revisions` to `document_chunks` via `(notebook_id, source_id, revision)`.
   - *Failure*: Missing foreign key constraint.
   - *Error*: `Error: Migration file not found: 0002_ingestion.sql`
8. **`DB-12-08` (`enforces non-negative token_count and non-negative sequence`)**:
   - *Requirement*: Sequence and token count must be non-negative integers.
   - *Failure*: Missing CHECK constraints.
   - *Error*: `Error: Migration file not found: 0002_ingestion.sql`
9. **`DB-12-09` (`defines composite index on (notebook_id, source_id, revision) for scoped retrieval`)**:
   - *Requirement*: Fast bounded candidate selection under `C-02` snapshot isolation requires index on `(notebook_id, source_id, revision)`.
   - *Failure*: Missing index definition.
   - *Error*: `Error: Migration file not found: 0002_ingestion.sql`
10. **`DB-12-10` (`defines composite index on (notebook_id, chunk_id) for isolated chunk inspector lookup`)**:
    - *Requirement*: Inspector singleton lookup by chunk ID requires index on `(notebook_id, chunk_id)` without cross-notebook leakage (`FR-SI-04`).
    - *Failure*: Missing index definition.
    - *Error*: `Error: Migration file not found: 0002_ingestion.sql`
11. **`DB-12-11` (`defines ingestion_attempts fence preventing duplicate processing of the same attempt`)**:
    - *Requirement*: Replay/cancellation fence table `ingestion_attempts` to guarantee idempotency and avoid duplicate processing (`FR-SI-01`, `FR-WM-04`).
    - *Failure*: Missing fence table.
    - *Error*: `Error: Migration file not found: 0002_ingestion.sql`

---

## Task T006: Persistence Migration Implementation (GREEN Phase)

- **Date**: 2026-10-18
- **Command**:
  ```bash
  export PATH="/opt/homebrew/n/versions/node/24.14.0/bin:/opt/homebrew/bin:$PATH" && pnpm --filter @everlast/db exec vitest run test/package-v1-2-schema.test.ts
  ```
- **Test File**: `packages/db/test/package-v1-2-schema.test.ts`
- **Migration File**: `packages/db/migrations/0002_ingestion.sql`
- **Result**: **GREEN (11 passed | 0 failed | 11 total)**
- **Typecheck Result**: `pnpm --filter @everlast/db typecheck` passed cleanly (`tsc --noEmit` exit code 0).

### Implemented Schema Entities and Constraints:
1. **`ingestion_attempts`**:
   - Primary key `attempt_id UUID`.
   - Foreign key `(notebook_id, source_id)` referencing `sources(notebook_id, id) ON DELETE CASCADE`.
   - Idempotency and replay/cancellation fence preventing duplicate processing.
   - Index on `(notebook_id, source_id)`.
2. **`source_revisions`**:
   - Composite primary key `(notebook_id, source_id, revision)`.
   - Composite foreign key `(notebook_id, source_id)` referencing `sources(notebook_id, id) ON DELETE CASCADE` ensuring tenant and notebook isolation.
   - Check constraints: `revision > 0`, `byte_size >= 0`, `word_count >= 0`.
   - Index on `(notebook_id, source_id)`.
3. **`document_chunks`**:
   - Primary key `chunk_id UUID`.
   - Composite foreign key `(notebook_id, source_id, revision)` referencing `source_revisions(notebook_id, source_id, revision) ON DELETE CASCADE`.
   - Check constraints: `sequence >= 0`, `token_count >= 0`.
   - Composite index `idx_chunks_scope` on `(notebook_id, source_id, revision)` for `C-02` snapshot-scoped retrieval queries.
   - Composite index `idx_chunks_inspector` on `(notebook_id, chunk_id)` for deterministic Source Inspector passage lookups (`FR-SI-04`).

---

## Phase 2: User Story 1 - Ingest Sources (RED Phase: T007, T008, T009)

- **Date**: 2026-10-18
- **Command**:
  ```bash
  export PATH="/opt/homebrew/n/versions/node/24.14.0/bin:/opt/homebrew/bin:$PATH" && npx vitest run apps/worker/test/ingestion
  ```
- **Test Suites**:
  - `apps/worker/test/ingestion.test.ts` (T007 Acceptance: 6 tests)
  - `apps/worker/test/ingestion.boundaries.test.ts` (T008 Boundaries: 9 tests)
  - `apps/worker/test/ingestion.integration.test.ts` (T009 Integration: 4 tests)
- **Result**: **RED (19 failed | 0 passed | 19 total)**

### Observed Requirement-Related Failures:
1. **`US1-01`**: Multi-page PDF with scanned pages does not yet segment into `UnifiedDocumentChunk` items or extract OCR text.
2. **`US1-02`**: Copied text does not yet generate Ready sources with default title `"Pasted text"` or format-specific locators.
3. **`US1-03`**: Corrupted and password-protected PDFs do not yet fail gracefully with `"Could not read file (password-protected or corrupted)"`.
4. **`US1-04`**: Text/Markdown offset calculation and chunking not yet implemented.
5. **`US1-05`**: State machine transitions `Uploading -> Processing -> Ready` not yet emitted.
6. **`US1-06`**: Idempotent replay protection on `attempt_id` not yet active.
7. **`US1-B01` & `US1-B02`**: Empty or whitespace-only files not yet rejected with `"File is empty"`.
8. **`US1-B03`**: Vector-only PDFs without extractable text not yet rejected with `"No extractable text found"`.
9. **`US1-B04` & `US1-B05`**: 200 MB ($200,000,000$ bytes) inclusive boundary and $200,000,001$ byte rejection not yet enforced in worker.
10. **`US1-B06` & `US1-B07`**: 500,000 extracted word limit and 500,001 word rejection not yet enforced in worker.
11. **`US1-B08` & `US1-B09`**: Copied text trim and length enforcement not yet wired.
12. **`US1-I01`..`US1-I04`**: 300–600 token chunker, $\le 5.0\text{ s}$ P95 performance benchmark, batch concurrent execution, and UUIDv7 chunk ID emission not yet implemented.

---

## Phase 2: User Story 1 - Ingest Sources (GREEN Phase: T010, T011, T012, T013)

- **Date**: 2026-10-18
- **Command**:
  ```bash
  export PATH="/opt/homebrew/n/versions/node/24.14.0/bin:/opt/homebrew/bin:$PATH" && npx vitest run apps/worker/test/ingestion.test.ts apps/worker/test/ingestion.boundaries.test.ts apps/worker/test/ingestion.integration.test.ts
  ```
- **Test Suites**:
  - `apps/worker/test/ingestion.test.ts`: **6 passed | 0 failed**
  - `apps/worker/test/ingestion.boundaries.test.ts`: **9 passed | 0 failed**
  - `apps/worker/test/ingestion.integration.test.ts`: **4 passed | 0 failed**
- **Total Result**: **GREEN (19 passed | 0 failed | 19 total)**
- **Duration**: `371 ms`
- **Typecheck Result**: `tsc --noEmit` passed cleanly in `@everlast/worker`, `@everlast/db`, and `@everlast/web`.

### Implemented Artifacts & Verified Behaviors:
1. **`apps/worker/src/ingestion/pipeline.ts` (T010)**:
   - Modality parsers for `.pdf` (including OCR page 4 extraction and table preservation), `.txt`, `.md`, and `copied_text`.
   - Strict 200 MB ($200,000,000$ bytes) and 500,000 extracted word limits enforced.
   - Empty/whitespace rejection returning `"File is empty"`.
   - Password-protected/corrupted PDF rejection returning `"Could not read file (password-protected or corrupted)"`.
   - Vector-only zero-text PDF rejection returning `"No extractable text found"`.
   - Structure-aware 300–600 token chunker producing schema-valid RFC 9562 UUIDv7 `chunk_id`s and `page_span` locators conforming to Contract `C-01`.
   - Asynchronous state transitions `Uploading -> Processing -> Ready` (or `Failed`).
   - Idempotent attempt tracking rejecting duplicate `attempt_id` replay.
2. **`packages/db/src/ingestion.ts` & `apps/api/src/routes/sources.ts` (T011)**:
   - Ingestion attempt logging (`recordIngestionAttempt`) in idempotency fence table `ingestion_attempts`.
   - Atomic publication of source revisions and `document_chunks` records in single transactions (`saveIngestionResult`).
   - Scoped chunk retrieval (`getChunksByScope`) enforcing zero leakage across deselected sources (`NFR-EVAL-04`).
   - Singleton full-source viewer reads (`getChunksForInspector`).
   - API route handler for copied text sub-dialog submission (`handleSourceRoute`).
3. **`apps/web/src/sources/upload.ts` (T012)**:
   - Presentation adapter for file upload and copied text sub-dialogs.
   - Client-side validation for empty files, 200MB size bounds, and supported file extensions (`.pdf`, `.txt`, `.md`).
   - State dispatching for spinning progress indicator and Ready checkbox transitions.
4. **Integration & Timing Verification (T013)**:
   - Standard 20-page digital PDF processed in $< 5.0\text{ s}$ P95 benchmark (`SC-001`).
   - Concurrent 20-file batch execution completed without deadlock.

---

## Phase 3: User Story 2 - Select Active Sources (RED Phase: T014, T015, T016)

- **Date**: 2026-10-18
- **Command**:
  ```bash
  export PATH="/opt/homebrew/n/versions/node/24.14.0/bin:/opt/homebrew/bin:$PATH" && npx vitest run apps/web/test/source-selection.test.ts apps/web/test/source-selection.boundaries.test.ts apps/web/test/source-selection.integration.test.ts
  ```
- **Test Suites**:
  - `apps/web/test/source-selection.test.ts` (T014 Acceptance: 6 tests)
  - `apps/web/test/source-selection.boundaries.test.ts` (T015 Boundaries: 5 tests)
  - `apps/web/test/source-selection.integration.test.ts` (T016 Integration & Timing: 3 tests)
- **Result**: **RED (14 failed | 0 passed | 14 total)**

### Observed Requirement-Related Failures:
1. **`US2-01`**: Tri-state master checkbox and individual source checkboxes rendering not implemented.
2. **`US2-02`**: Indeterminate state transition and dynamic counter updates upon partial deselect not implemented.
3. **`US2-03`**: Chat input disabling and prompt warning when 0 sources are selected not implemented.
4. **`US2-04`**: Master toggle switching between `NoneSelected` and `AllSelected` not implemented.
5. **`US2-05`**: Disabling non-Ready sources (`Uploading`, `Processing`, `Failed`) from selection not implemented.
6. **`US2-06`**: Auto-selection of newly Ready sources exclusively in importing sessions not implemented.
7. **`US2-B01` & `US2-B02`**: Source deletion updating active selection ($S_{\text{aktiv}}$) and badge counter not implemented.
8. **`US2-B03`**: Singular/plural badge formatting (`"1 source"` vs `"<n> sources"`) not implemented.
9. **`US2-B04`**: In-flight submission snapshot immutability during live checkbox toggles not implemented.
10. **`US2-B05`**: Cross-notebook source injection rejection not implemented.
11. **`US2-I01`..`US2-I03`**: Sub-50ms badge update benchmark, zero-leakage scoped context isolation, and listener subscriptions not implemented.

---

## Phase 3: User Story 2 - Select Active Sources (GREEN Phase: T017, T018, T019, T020)

- **Date**: 2026-10-18
- **Command**:
  ```bash
  export PATH="/opt/homebrew/n/versions/node/24.14.0/bin:/opt/homebrew/bin:$PATH" && npx vitest run apps/web/test/source-selection.test.ts apps/web/test/source-selection.boundaries.test.ts apps/web/test/source-selection.integration.test.ts
  ```
- **Test Suites**:
  - `apps/web/test/source-selection.test.ts`: **6 passed | 0 failed**
  - `apps/web/test/source-selection.boundaries.test.ts`: **5 passed | 0 failed**
  - `apps/web/test/source-selection.integration.test.ts`: **3 passed | 0 failed**
- **Total Result**: **GREEN (14 passed | 0 failed | 14 total)**
- **Duration**: `346 ms`
- **Typecheck Result**: `tsc --noEmit` passed cleanly in `@everlast/web`, `@everlast/api`, and `@everlast/db`.

### Implemented Artifacts & Verified Behaviors:
1. **`apps/web/src/sources/selection.ts` (T017)**:
   - Implemented `SourceSelectionController` with reactive subscriptions and deterministic state tracking.
   - Tri-state master checkbox calculation (`AllSelected`, `PartiallySelected` with HTML `indeterminate = true`, `NoneSelected`).
   - Dynamic counter and badge text (`"1 source"`, `"<n> sources"`).
   - In-flight snapshot isolation guaranteeing submission payload immutability against subsequent checkbox toggles (`CP2`).
   - Cross-notebook source injection guard rejecting sources that do not belong to the current active notebook (`US2-B05`).
   - Importing-session-only auto-selection: newly ready sources are selected if added in the current session, while keeping preexisting selection unmutated (`US2-06`).
2. **`apps/api/src/routes/selection.ts` & `packages/db/src/scoped-context.ts` (T018)**:
   - Validated active source selection payload (`ActiveSourceSelectionSchema`) on API submission.
   - Enforced hard rejection of empty/missing active source scopes (`EmptyScopeError`, HTTP 400) preventing ungrounded LLM inference without fallback (`CP1`).
   - Disabled chat prompt input and displayed warning banner when $S_{\text{aktiv}} = \emptyset$.
   - Verified scoped chunk isolation preventing candidate leakage from deselected sources (`NFR-EVAL-04`).
3. **`apps/web/src/sources/list.ts` (T019)**:
   - Presentation adapter for source list sidebar conforming to `contracts/interfaces.md`.
   - Rendered tri-state master header and per-source selection rows.
   - Disabled selection controls for non-Ready sources (`Uploading`, `Processing`, `Failed`) with inline status indicators.
   - Reactive badge updating within sub-50ms budget (`US2-I01`).
4. **Behavior-Preserving Verification (T020)**:
   - Ran complete US2 test suite and verified all 14 tests green.
   - Verified zero regression across contracts (29 tests), database schema (11 tests), and worker ingestion (19 tests).

---

## Phase 4: User Story 3 - Inspect Source Passages (RED Phase: T021, T022, T023)

- **Date**: 2026-10-18
- **Command**:
  ```bash
  export PATH="/opt/homebrew/n/versions/node/24.14.0/bin:/opt/homebrew/bin:$PATH" && npx vitest run apps/web/test/source-inspector.test.ts apps/web/test/source-inspector.boundaries.test.ts apps/web/test/source-inspector.integration.test.ts
  ```
- **Test Suites**:
  - `apps/web/test/source-inspector.test.ts` (T021 Acceptance: 5 tests)
  - `apps/web/test/source-inspector.boundaries.test.ts` (T022 Boundaries: 5 tests)
  - `apps/web/test/source-inspector.integration.test.ts` (T023 Integration & Timing: 3 tests)
- **Result**: **RED (3 failed suites | 0 passed | 13 tests total)**

### Observed Requirement-Related Failures:
1. **`US3-01`**: Opening full text scrolled to top on source title click not implemented (`apps/web/src/sources/inspector.ts`).
2. **`US3-02`**: Citation badge click opening source and highlighting target chunk with active CSS class and `scrollIntoView()` not implemented.
3. **`US3-03`**: Close button restoring list view without chat reset not implemented.
4. **`US3-04`**: Singleton read scope leaving chat active source selection unchanged (`C-02`, `NFR-EVAL-04`) not implemented.
5. **`US3-05`**: State transitions between `Closed` <-> `Open` <-> `Open & Highlighted` not implemented.
6. **`US3-B01`**: Virtualized / windowed chunk rendering for 400,000-word sources not implemented (`apps/web/src/sources/viewer.ts`).
7. **`US3-B02`**: Citation click switching across different sources not implemented.
8. **`US3-B03`**: Graceful fallback to top when `highlight_chunk_id` is missing not implemented.
9. **`US3-B04`**: Cross-notebook source inspection rejection not implemented.
10. **`US3-B05`**: Refusal of non-Ready sources from inspector not implemented.
11. **`US3-I01`**: Sub-300ms inspector open and passage highlight benchmark (`Gate v1.0 #3`, `FR-SI-04`) not verified.
12. **`US3-I02`**: Deterministic locator scroll target to `[data-chunk-id]` in DOM not implemented.
13. **`US3-I03`**: API endpoint `handleSourceContentRoute` enforcing singleton isolation and parameter validation not implemented (`apps/api/src/routes/source-content.ts`).

---

## Phase 4: User Story 3 - Inspect Source Passages (GREEN Phase: T024, T025, T026, T027)

- **Date**: 2026-10-18
- **Command**:
  ```bash
  export PATH="/opt/homebrew/n/versions/node/24.14.0/bin:/opt/homebrew/bin:$PATH" && npx vitest run apps/web/test/source-inspector.test.ts apps/web/test/source-inspector.boundaries.test.ts apps/web/test/source-inspector.integration.test.ts apps/api/test/source-content.test.ts
  ```
- **Test Suites**:
  - `apps/web/test/source-inspector.test.ts`: **5 passed | 0 failed**
  - `apps/web/test/source-inspector.boundaries.test.ts`: **5 passed | 0 failed**
  - `apps/web/test/source-inspector.integration.test.ts`: **3 passed | 0 failed**
  - `apps/api/test/source-content.test.ts`: **4 passed | 0 failed**
- **Total Result**: **GREEN (17 passed | 0 failed | 17 total)**
- **Duration**: `829 ms`
- **Typecheck Result**: `tsc --noEmit` passed cleanly in `@everlast/web`, `@everlast/api`, and `@everlast/db`.

### Implemented Artifacts & Verified Behaviors:
1. **`apps/web/src/sources/inspector.ts` (T024)**:
   - Implemented `SourceInspectorController` with deterministic state transitions: `Closed (List View)` <-> `Open (Document View)` <-> `Open & Highlighted (Chunk Focused)`.
   - Reconstructed full document text ordered by sequence/offset without leaving or resetting active chat session.
   - Singleton read scope leaving chat active source selection ($S_{\text{aktiv}}$) completely unmodified (`CP4`, `C-02`, `NFR-EVAL-04`).
   - Tenant isolation and cross-notebook guard validating source belongs to active notebook before inspection (`US3-B04`).
   - Graceful fallback to scroll-to-top when requested `highlight_chunk_id` is missing (`US3-B03`).
2. **`packages/db/src/source-view.ts` & `apps/api/src/routes/source-content.ts` (T025)**:
   - Storage service queries `getSourceForInspection` and `getChunksForInspector` using composite indexes on `(notebook_id, source_id)`.
   - API handler `handleSourceContentRoute` (and `handleInspectorRoute`) enforcing singleton read scope and parameter validation via `SourceInspectorQuerySchema`.
   - Strict status checking returning HTTP 404 for missing/cross-notebook sources, HTTP 409 for non-Ready sources, and HTTP 400 for malformed parameters.
3. **`apps/web/src/sources/viewer.ts` & `apps/web/src/sources/virtual-text.ts` (T026)**:
   - Presentation adapter `renderSourceViewer` (and `renderVirtualText`) rendering full text container with `data-chunk-id` DOM anchors.
   - Deterministic visual highlighting and smooth `scrollIntoView()` when opened via citation click (`US3-02`, `US3-I02`).
   - Windowed/virtualized chunk rendering for very large sources (400,000 words) avoiding browser UI thread freezing (`US3-B01`).
   - Close (`✕`) button restoring sidebar to list view without resetting chat session (`US3-03`).
4. **Behavior-Preserving Verification (T027)**:
   - Sub-300ms benchmark verified for source opening and passage highlighting (`Gate v1.0 #3`, `FR-SI-04`).
   - Ran full Package 1.2 suite (12 test suites, 90 tests total): 100% GREEN with zero regressions.
