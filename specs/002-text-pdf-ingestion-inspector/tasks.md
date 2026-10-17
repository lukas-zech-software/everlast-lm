# Tasks: Text/PDF Ingestion & Inspector

**Input**: [spec](spec.md), [plan](plan.md), [research](research.md), [data model](data-model.md), [interfaces](contracts/interfaces.md), [quickstart](quickstart.md).
**Package Source**: `spec/requirements/v1/package_1_2_text_pdf_ingestion_inspector.md` + [binding cross-package rules](../../spec/requirements/README.md).
**SRS IDs in scope**: FR-SI-01, FR-SI-03, FR-SI-04, C-01, C-02, Gate v1.0.
**Branch / worktree**: `spec/v1-functional-requirements` / `/private/tmp/everlast-v1-specs`. Baseline: approved main6f3d6b2 plus prior package commits on this branch.
**Prerequisites**: Plan CC-01..CC-08 passes at design level; no unresolved spec clarifications. `/speckit-analyze` must run before implementation. Package 1.1 shared schemas, verified identity, notebook ownership, quota ledger and deletion fences must be integrated first. Package 1.3 consumes this package; citation fixtures avoid a circular dependency.

Tests are mandatory (constitution II/CC-02), overriding optional-test skill wording. All tasks are open/unexecuted. Every behavior task waits for its named tests to fail for the expected requirement-related reason. Setup/import/configuration failure is not Red. Shared schemas, migration ordering, manifests, entrypoints and CI require one owner. This session claims documentation only; no runtime code or cloud resources are edited now.

Task IDs are qualified as `specs/002-text-pdf-ingestion-inspector Tnnn` in handoffs. [P] means disjoint files only after dependencies pass and fixtures/output ownership is assigned. Required adapters for package-owned behavior must be available. Assertions against later downstream consumers are handed off and tracked in the final integration task; they do not create a circular prerequisite on upstream implementation.

## Phase 1: Setup and shared prerequisite contracts

- [ ] T001 Confirm shared contracts and upstream implementation prerequisites from `specs/002-text-pdf-ingestion-inspector/plan.md`; record ownership/base/allowed files and external dependencies in `specs/002-text-pdf-ingestion-inspector/implementation-handoff.md` and shared issue/PR (C-01, C-02, Gate v1.0). Do not recreate 1.1 schemas, manifests or infra; reconcile newer accepted contracts/governance and rerun analyze before dependent changes. **Depends on:** approved analyze and assigned ownership.

- [ ] T002 Reuse foundation scripts and pin compatible package dependencies in `package.json`, `pnpm-lock.yaml` and package manifests; preserve existing OpenTofu scripts/workflow (Gate v1.0). Allocate isolated test DB/bucket/ports; configure only test harness and importable interface stubs, no behavior. Missing upstream app/harness is a blocker, not a passing test. **Depends on:** T001.

- [ ] T003 Write and run failing package DTO/state and integration-boundary tests in `packages/contracts/test/package-v1-2.test.ts` (C-01, C-02): validate every entity field/input constraint in `specs/002-text-pdf-ingestion-inspector/data-model.md`, exact state/error enums, ownership, immutable revisions, no extra C-01 fields, and explicit nonempty scope. Capture assertion-related Red, not missing-import/configuration errors. **Depends on:** T002.

- [ ] T004 Implement package-specific DTOs in `packages/contracts/src/package-v1-2.ts` and shared exports in `packages/contracts/src/index.ts` (C-01, C-02); pass T003. Import shared schemas from 1.1 rather than redefining C-01/C-02; serialize index/manifest edits with their owner. **Depends on:** T003.

- [ ] T005 Write and run failing persistence/rollback/deletion tests in `packages/db/test/package-v1-2-schema.test.ts` (C-01, C-02, FR-WM-04): every entity invariant in data-model.md, parent FKs, notebook/user isolation, immutable source provenance and replay/cancellation fences. Assert parent deletion removes or invalidates every added child; no partial successful commit. **Depends on:** T004.

- [ ] T006 Implement only package persistence in `packages/db/migrations/0002_ingestion.sql` (C-01, C-02, FR-WM-04); pass T005. Serialize migration ordering after preceding package, preserve shared source admission ledger, and add required notebook/source/revision or thread indexes without new datastore. Do not implement story behavior ahead of its Red tests. **Depends on:** T005.


## Phase 2: User Story 1 - Ingest sources

**Independent Test**: Run US1 acceptance, boundary and integration files against isolated fixtures; assert every case in its annex and CP1–CP7, with actual consumers required for end-to-end success.

### Tests (mandatory Red before implementation)

- [ ] T007 [US1] Write and run failing acceptance tests in `apps/worker/test/ingestion.test.ts` (FR-SI-01) for every original Gherkin scenario and EARS statement in Annex US1; preserve exact messages, fixtures and state transitions. Record each original scenario title and Red result. An external consumer may use contract fixtures now, but real integrated assertions remain open until that consumer exists. **Depends on:** T006.

- [ ] T008 [P] [US1] Write and run failing boundary/error tests in `apps/worker/test/ingestion.boundaries.test.ts` (FR-SI-01) covering every input row and edge/error case in Annex US1; test each inclusive limit at min-1/min/max/max+1 where applicable, Unicode after trim, malformed input, authorization, cancellation and duplicate/out-of-order callbacks. No truncation, source fallback, stale publication or silent partial success. **Depends on:** T006.

- [ ] T009 [P] [US1] Write and run failing integration/timing tests in `apps/worker/test/ingestion.integration.test.ts` (FR-SI-01, C-02, NFR-EVAL-04) for every measurable criterion in Annex US1 and cross-package cases CP1–CP7. Record fixture sizes, sample counts, versions, region and cold/warm conditions. Never count progress as answer TTFT or substitute a stub for real cloud/model acceptance. **Depends on:** T006.

### Implementation (Green → Refactor)

- [ ] T010 [US1] Implement PDF/text/Markdown/copied-text adapters, canonical offset mapping, OCR/table preservation, word/byte validation, 300–600 token chunking and idempotent indexing. Domain implementation in `apps/worker/src/ingestion/pipeline.ts` (FR-SI-01); pass T007/T008/T009 applicable domain assertions before refactoring; preserve exact Annex US1 behavior and source precedence. **Depends on:** T007, T008, T009.

- [ ] T011 [US1] Implement storage/service and API integration in `packages/db/src/ingestion.ts` and `apps/api/src/routes/sources.ts` (FR-SI-01, C-02). Use 1.1 quota/deletion services, exact revision predicates, atomic Ready publication and idempotent cleanup. Retrieval filters both vector/FTS candidates before RRF, validates returned membership; inspection uses singleton full-source mode. Pass remaining T007/T008 interface/state cases and connect T009 real adapters without bypassing upstream authorization. **Depends on:** T010.

- [ ] T012 [US1] Implement presentation/integration adapter in `apps/web/src/sources/upload.ts` (FR-SI-01) per `contracts/interfaces.md`; preserve state, exact messages, safe authorized data rendering and all Annex US1 interactions. Pass T007/T008 presentation assertions, then real T009 integration. **Depends on:** T011.

- [ ] T013 [US1] Run Green then behavior-preserving refactor for `apps/worker/test/ingestion.test.ts`, `apps/worker/test/ingestion.boundaries.test.ts`, `apps/worker/test/ingestion.integration.test.ts`; append actual commands/case IDs and Red/Green evidence to `specs/002-text-pdf-ingestion-inspector/validation.md` (FR-SI-01). This checkpoint covers package-owned assertions only; hand off later-consumer assertions to the final integration task. Required cloud adapters for owned behavior cannot be replaced by mocks. **Depends on:** T012.


## Phase 3: User Story 2 - Select active sources

**Independent Test**: Run US2 acceptance, boundary and integration files against isolated fixtures; assert every case in its annex and CP1–CP7, with actual consumers required for end-to-end success.

### Tests (mandatory Red before implementation)

- [ ] T014 [US2] Write and run failing acceptance tests in `apps/web/test/source-selection.spec.ts` (FR-SI-03) for every original Gherkin scenario and EARS statement in Annex US2; preserve exact messages, fixtures and state transitions. Record each original scenario title and Red result. An external consumer may use contract fixtures now, but real integrated assertions remain open until that consumer exists. **Depends on:** T013.

- [ ] T015 [P] [US2] Write and run failing boundary/error tests in `apps/web/test/source-selection.boundaries.spec.ts` (FR-SI-03) covering every input row and edge/error case in Annex US2; test each inclusive limit at min-1/min/max/max+1 where applicable, Unicode after trim, malformed input, authorization, cancellation and duplicate/out-of-order callbacks. No truncation, source fallback, stale publication or silent partial success. **Depends on:** T013.

- [ ] T016 [P] [US2] Write and run failing integration/timing tests in `apps/web/test/source-selection.integration.spec.ts` (FR-SI-03, C-02, NFR-EVAL-04) for every measurable criterion in Annex US2 and cross-package cases CP1–CP7. Record fixture sizes, sample counts, versions, region and cold/warm conditions. Never count progress as answer TTFT or substitute a stub for real cloud/model acceptance. **Depends on:** T013.

### Implementation (Green → Refactor)

- [ ] T017 [US2] Implement local selection/master checkbox/count, importing-session-only Ready selection and C-02 exact snapshot-scoped hybrid retrieval; empty/omitted scope rejects, no fallback. Domain implementation in `apps/web/src/sources/selection.ts` (FR-SI-03); pass T014/T015/T016 applicable domain assertions before refactoring; preserve exact Annex US2 behavior and source precedence. **Depends on:** T014, T015, T016.

- [ ] T018 [US2] Implement storage/service and API integration in `packages/db/src/scoped-context.ts` and `apps/api/src/services/source-context.ts` (FR-SI-03, C-02). Use 1.1 quota/deletion services, exact revision predicates, atomic Ready publication and idempotent cleanup. Retrieval filters both vector/FTS candidates before RRF, validates returned membership; inspection uses singleton full-source mode. Pass remaining T014/T015 interface/state cases and connect T016 real adapters without bypassing upstream authorization. **Depends on:** T017.

- [ ] T019 [US2] Implement presentation/integration adapter in `apps/web/src/sources/list.ts` (FR-SI-03) per `contracts/interfaces.md`; preserve state, exact messages, safe authorized data rendering and all Annex US2 interactions. Pass T014/T015 presentation assertions, then real T016 integration. **Depends on:** T018.

- [ ] T020 [US2] Run Green then behavior-preserving refactor for `apps/web/test/source-selection.spec.ts`, `apps/web/test/source-selection.boundaries.spec.ts`, `apps/web/test/source-selection.integration.spec.ts`; append actual commands/case IDs and Red/Green evidence to `specs/002-text-pdf-ingestion-inspector/validation.md` (FR-SI-03). This checkpoint covers package-owned assertions only; hand off later-consumer assertions to the final integration task. Required cloud adapters for owned behavior cannot be replaced by mocks. **Depends on:** T019.


## Phase 4: User Story 3 - Inspect source passages

**Independent Test**: Run US3 acceptance, boundary and integration files against isolated fixtures; assert every case in its annex and CP1–CP7, with actual consumers required for end-to-end success.

### Tests (mandatory Red before implementation)

- [ ] T021 [US3] Write and run failing acceptance tests in `apps/web/test/source-inspector.spec.ts` (FR-SI-04) for every original Gherkin scenario and EARS statement in Annex US3; preserve exact messages, fixtures and state transitions. Record each original scenario title and Red result. An external consumer may use contract fixtures now, but real integrated assertions remain open until that consumer exists. **Depends on:** T020.

- [ ] T022 [P] [US3] Write and run failing boundary/error tests in `apps/web/test/source-inspector.boundaries.spec.ts` (FR-SI-04) covering every input row and edge/error case in Annex US3; test each inclusive limit at min-1/min/max/max+1 where applicable, Unicode after trim, malformed input, authorization, cancellation and duplicate/out-of-order callbacks. No truncation, source fallback, stale publication or silent partial success. **Depends on:** T020.

- [ ] T023 [P] [US3] Write and run failing integration/timing tests in `apps/web/test/source-inspector.integration.spec.ts` (FR-SI-04, C-02, NFR-EVAL-04) for every measurable criterion in Annex US3 and cross-package cases CP1–CP7. Record fixture sizes, sample counts, versions, region and cold/warm conditions. Never count progress as answer TTFT or substitute a stub for real cloud/model acceptance. **Depends on:** T020.

### Implementation (Green → Refactor)

- [ ] T024 [US3] Implement ordered singleton C-02 reads and virtualized canonical text anchors; title opens at top, citation resolves/highlights exact chunk; close restores list without chat reset. Domain implementation in `apps/web/src/sources/inspector.ts` (FR-SI-04); pass T021/T022/T023 applicable domain assertions before refactoring; preserve exact Annex US3 behavior and source precedence. **Depends on:** T021, T022, T023.

- [ ] T025 [US3] Implement storage/service and API integration in `packages/db/src/source-view.ts` and `apps/api/src/routes/source-content.ts` (FR-SI-04, C-02). Use 1.1 quota/deletion services, exact revision predicates, atomic Ready publication and idempotent cleanup. Retrieval filters both vector/FTS candidates before RRF, validates returned membership; inspection uses singleton full-source mode. Pass remaining T021/T022 interface/state cases and connect T023 real adapters without bypassing upstream authorization. **Depends on:** T024.

- [ ] T026 [US3] Implement presentation/integration adapter in `apps/web/src/sources/virtual-text.ts` (FR-SI-04) per `contracts/interfaces.md`; preserve state, exact messages, safe authorized data rendering and all Annex US3 interactions. Pass T021/T022 presentation assertions, then real T023 integration. **Depends on:** T025.

- [ ] T027 [US3] Run Green then behavior-preserving refactor for `apps/web/test/source-inspector.spec.ts`, `apps/web/test/source-inspector.boundaries.spec.ts`, `apps/web/test/source-inspector.integration.spec.ts`; append actual commands/case IDs and Red/Green evidence to `specs/002-text-pdf-ingestion-inspector/validation.md` (FR-SI-04). This checkpoint covers package-owned assertions only; hand off later-consumer assertions to the final integration task. Required cloud adapters for owned behavior cannot be replaced by mocks. **Depends on:** T026.


## Phase 5: Polish and integrated verification

- [ ] T028 Execute whole-package regression and inherited integration assertions in `specs/002-text-pdf-ingestion-inspector/quickstart.md` and `packages/evals/test/package-v1-2.test.ts` (Gate v1.0, NFR-EVAL-02, NFR-EVAL-04). Use real downstream clients when available; no cyclic prerequisite prevents handing off verified upstream interfaces, but deferred integration cases remain unchecked. **Depends on:** T027.

- [ ] T029 Integrate package checks into `.github/workflows/ci.yml` and `package.json` under serialized shared ownership (Gate v1.0, NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04). Run lint/type/unit/contract/deterministic every PR; judged suites on retrieval/prompt/chat and every release gate. Preserve `.github/workflows/opentofu.yml`; never turn unavailable tests into successful skips. **Depends on:** T027.

- [ ] T030 Run documentation integrity, all available quickstart gates and final diff review; update `specs/002-text-pdf-ingestion-inspector/implementation-handoff.md`, `validation.md` and canonical `tasks.md` only with verified outcomes (Gate v1.0). Record commits, ownership, open external dependencies and UNAVAILABLE checks; full v1 gate requires integrated upload/schema, four eval metrics and citation navigation. **Depends on:** T028, T029.

## Dependencies, parallel examples and delivery

Setup/shared-contract Red precedes schema implementation; story phases follow their documented order, with acceptance/boundary/integration Red before domain, service/API, presentation and Green verification. Within each story its [P] boundary and integration tests may run concurrently after the previous checkpoint, because filenames differ; allocate separate DB/bucket/output fixtures. Never run their implementation before Red evidence is transferred. Shared schema/index/manifest edits are serialized.

The first story plus prerequisites is the first independently demonstrable increment, not a substitute for the remaining package or complete MVP. Source parsing precedes selection/inspection; reasoning precedes citation publication/verification/history integration; UI shells may precede the full evaluation runner. External package integration does not block handoff of verified foundation interfaces, but its assertions remain open. Full release awaits all three Gate v1.0 outcomes.

## Cross-package acceptance (C-02, FR-WM-04, NFR-EVAL-04)

- CP1: Missing/empty scope rejects, non-Ready/cross-notebook IDs reject entirely; no server All Ready fallback. Test 401/403/404/empty-scope/stale errors explicitly.
- CP2: Checkbox changes affect only subsequent requests; deleted/replaced/revoked captured revisions fail before reads and publication, never substitute new content.
- CP3: Complete provenance controls history/cache eligibility, including uncited/tool/summary content; exclude both question/answer if any dependency is outside scope; missing provenance excludes.
- CP4: Deselected but authorized historical content can remain visible; deleted/revoked content and cached snippets/search/export copies cannot. Inspector singleton reads never mutate chat selection.
- CP5: Invalid or missing factual citation causes immediate refusal before publishing any factual draft; no stripped-citation answer or silent regeneration. Progress does not count toward TTFT.
- CP6: Atomic slots precede upload; Uploading/Processing/Ready consume, Failed releases once; 200 MB=200000000 bytes and 500000 words independently inclusive. Late callbacks/deletion and retries cannot recreate content.
- CP7: Owner-only v1, enterprise no-training for LLM/OCR/embeddings, EU-default verified configuration; no zero-retention inference. Preserve later-release exclusions and shared schemas.

## Acceptance coverage annex

Each annex transcribes the binding source blocks to make test tasks self-contained. Initial All Ready defaults, future-role mentions and historical visibility are qualified by CP1–CP7. Symbolic chunk IDs become schema-valid fixtures. Technical requirements are bound to their source IDs, not newly invented implementation behavior.

### US1: FR-SI-01 (Subset A) — Text, Markdown, PDF & Copied Text Ingestion

**Trace**: FR-SI-01. EARS/Gherkin → T007; inputs/errors → T008; measurements/integration → T009; implementation → T010, T011, T012.

**EARS**

- *Event:* When the Owner/Editor uploads a `.pdf`, `.txt`, or `.md` file or submits pasted text via the "Copied text" dialog, the system shall create a `Source` record in state `Uploading`, move it to `Processing` once the content is received, extract the text and structural layout (including OCR for scanned PDF pages and table structure), segment it into `UnifiedDocumentChunk` objects (`Contract C-01`), and transition the source to `Ready`.
- *Ubiquitous:* The system shall assign every `UnifiedDocumentChunk` a deterministic `locator` (`page_span` with page and text offsets for PDFs; `page_span` with paragraph/text offsets and no physical page for TXT/MD/Copied Text) so that citations can resolve back to the exact passage.
- *Unwanted:* If a file is corrupted, password-protected, or contains zero extractable text even after OCR, then the system shall transition the source state to `Failed` and display an inline error indicator next to the source in the sidebar.

**Original Gherkin scenarios**

```gherkin
Scenario: Upload multi-page PDF with scanned page produces valid chunks
  Given an open notebook
  When the owner uploads a 10-page PDF where page 4 is a scanned image of text
  Then the source transitions from "Processing" to "Ready"
  And every generated UnifiedDocumentChunk conforms to Contract C-01
  And chunks from page 4 contain the OCR-extracted text with locator page = 4

Scenario: Paste raw clipboard text
  Given the "Add sources" modal is open
  When the owner clicks "Copied text", pastes 1,500 words of meeting notes, and clicks "Insert"
  Then a new source titled "Pasted text" is added to the sidebar in state "Ready"
  And its chunks are immediately selectable for chat queries

Scenario: Password-protected PDF fails gracefully
  Given an encrypted, password-protected PDF file
  When the owner uploads the file
  Then the source status transitions to "Failed"
  And an error message "Could not read file (password-protected or corrupted)" is shown
```

**Exact inputs and limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| File upload | `.pdf`, `.txt`, `.md` | Max $200\text{ MB}$, max $500,000$ words per source (`FR-WM-07`) | — |
| Copied text | UTF-8 string | $1\text{ char}$ to $500,000$ words | Source title: `"Pasted text"` |
| `UnifiedDocumentChunk` | `Contract C-01` JSON | `source_id`, `chunk_id`, `text`, `token_count`, `locator` (`page_span`; text-only sources omit the physical page) | — |

**Edge and error cases**

- Empty `.txt` or `.md` file ($0\text{ bytes}$) $\rightarrow$ Rejected with message `"File is empty"`.
- PDF containing only decorative vector graphics and no text $\rightarrow$ OCR yields $0$ tokens; source marked `Failed` (`"No extractable text found"`).
- Simultaneous upload of $20$ PDF files $\rightarrow$ Queued and processed concurrently without blocking the UI thread.

**Measurable criteria**

- Standard $20$-page digital PDF is parsed, chunked, and `Ready` in $\le 5.0\text{ s}$ (P95).
- 100% of persisted chunks validate against the `Contract C-01` JSON schema (`Gate v1.0 #1`).


### US2: FR-SI-03 — Granular Source Selection / Scoping

**Trace**: FR-SI-03. EARS/Gherkin → T014; inputs/errors → T015; measurements/integration → T016; implementation → T017, T018, T019.

**EARS**

- *Ubiquitous:* The system shall display a checkbox next to every source in the left sidebar and a master `"Select all sources"` checkbox at the top of the source list.
- *Event:* When a new source finishes ingestion (`Ready`), the system shall automatically set its checkbox to selected in the importing user's session only ($s_i \in S_{\text{aktiv}}$).
- *Event:* When the user toggles any source checkbox or the `"Select all sources"` checkbox, the system shall immediately update the active source set $S_{\text{aktiv}}$ and update the counter badge (`"<n> sources"` / `"<n> Quellen"`) inside the chat input bar.
- *State:* While a source is in state `Uploading`, `Processing`, or `Failed`, the system shall disable its selection checkbox and exclude it from $S_{\text{aktiv}}$.
- *Unwanted:* If the user deselects all sources ($\lvert S_{\text{aktiv}}\rvert = 0$), then the system shall disable chat submit and Studio generation, display a prompt to select at least one source, and reject empty-scope generation requests server-side.

**Original Gherkin scenarios**

```gherkin
Scenario: Deselected source never leaks into context
  Given Source A ("Policy_2024.pdf") and Source B ("Policy_2025.pdf") are in state "Ready"
  And only Source B contains the phrase "Project Aurora budget is $4.2M"
  When the user unchecks Source B so only Source A is selected
  And the user asks "What is the Project Aurora budget?"
  Then ScopedContextProvider returns chunks exclusively from Source A
  And the chat answer states that the selected sources do not mention Project Aurora

Scenario: Zero sources selected disables chat input
  Given a notebook with 2 ready sources
  When the user unchecks "Select all sources"
  Then the chat input counter shows "0 sources"
  And the chat send button is disabled
```

**Exact inputs and limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| `active_source_ids` ($S_{\text{aktiv}}$) | Array of UUIDs | $0 \le \lvert S_{\text{aktiv}}\rvert \le N_{\text{max}}$, each source must be in state `Ready` | All `Ready` sources in the notebook |

**Edge and error cases**

- Source is deleted while checked $\rightarrow$ Automatically removed from $S_{\text{aktiv}}$ and counter decrements by $1$.
- User toggles selection while a previous chat answer is streaming $\rightarrow$ In-flight request completes with the snapshot of $S_{\text{aktiv}}$ taken at request submission; subsequent turn uses the new selection.

**Measurable criteria**

- Context leakage from unselected sources ($s_i \notin S_{\text{aktiv}}$) = $0$ across the `NFR-EVAL-04` test suite (`Gate v1.0 #2`).
- UI counter updates within $\le 50\text{ ms}$ of checkbox click.


### US3: FR-SI-04 — Integrated Source Inspector (Source Viewer)

**Trace**: FR-SI-04. EARS/Gherkin → T021; inputs/errors → T022; measurements/integration → T023; implementation → T024, T025, T026.

**EARS**

- *Event:* When the user clicks a source title in the left sidebar, the system shall expand the left panel into the Source Inspector view and render the formatted full text of that source without leaving or resetting the active chat session.
- *Event:* When the Source Inspector is opened via a click on an inline citation badge `[n]` (`FR-GC-03`), the system shall open the corresponding source, scroll smoothly and deterministically to the DOM element matching the cited chunk's `locator`, and apply a visual highlight to the cited passage.
- *Event:* When the user clicks the close (`✕`) or back button in the Source Inspector header, the system shall collapse the inspector and return to the standard source list sidebar.

**Original Gherkin scenarios**

```gherkin
Scenario: Clicking source title opens full text at top
  Given a notebook with a Ready source "Architecture_Spec.md"
  When the user clicks the title "Architecture_Spec.md" in the sidebar
  Then the Source Inspector opens in the left panel
  And renders the full text of "Architecture_Spec.md" scrolled to the top
  And on desktop the middle Chat panel remains visible and intact (on narrow screens the Chat tab retains its state)

Scenario: Citation click scrolls deterministically to target chunk
  Given a chat answer with citation [2] pointing to chunk "chk_042" on page 7 of "Report.pdf"
  When the user clicks citation badge [2]
  Then the Source Inspector opens "Report.pdf"
  And the DOM element with data-chunk-id="chk_042" is scrolled into the viewport
  And the element has the active highlight CSS class applied
```

**Exact inputs and limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| `source_id` | UUID | Must exist in current `notebook_id` | — |
| `highlight_chunk_id` (optional) | Chunk UUID (`Contract C-01`; locator is resolved server-side) | Valid `chunk_id` belonging to `source_id` | `null` (scroll to top) |

**Edge and error cases**

- Very large source ($400,000$ words) opened in Source Inspector $\rightarrow$ Uses virtualized scrolling / windowed chunk rendering so jumping to `chk_1500` (with structure-aware chunks targeting 300–600 tokens; exact chunk count depends on content and overlap) completes without freezing the browser tab.
- User clicks a second citation `[3]` from a different source while Source Inspector is already open on `[1]` $\rightarrow$ Inspector switches immediately to the new source and scrolls to `[3]`.

**Measurable criteria**

- Opening a source and scrolling to a cited `chunk_id` completes in $\le 300\text{ ms}$ (`Gate v1.0 #3`).
- Scroll target is 100% deterministic in automated Playwright/DOM E2E tests.

## Completion boundary

Generation validates task format, ordering and transcription only. No behavior tests or Gate v1.0 pass is claimed; current runtime runners are UNAVAILABLE. Next stage is `/speckit-analyze` pinned to this feature. Future changes to upstream contracts/requirements require affected artifact updates and another analyze before implementation.
