# Feature Specification: Notes & Pinboard Lifecycle

**Feature Branch**: `007-notes-pinboard-lifecycle`
**Created**: 2026-10-18
**Status**: Draft
**Package Source**: `spec/requirements/v2/package_2_3_notes_pinboard_lifecycle.md`
**SRS IDs in Scope**: FR-NM-01, FR-NM-02, FR-NM-03, FR-NM-04; FR-GC-01/02/09; FR-SI-01; C-01, C-02; Gate v2.0 #2
**Release & Gate**: v2.0 (contributes to, but does not independently satisfy, Gate v2.0)
**Input**: User description: "v2 which consists of these 4 packages: Package 2.1, Package 2.2, Package 2.3, Package 2.4." This invocation specifies Package 2.3; the project requires one FR package per specification.

## Source Traceability & Package Scope *(mandatory)*

This specification transcribes Package 2.3 and the applicable binding cross-package rules. Packages 2.1, 2.2, and 2.4 are separate feature specifications; Package 2.2's Save to note action integrates with this package's saved-response note behavior.

| SRS ID | Requirement Title | FR Card Anchor | Architecture Decisions / Deviations |
| :--- | :--- | :--- | :--- |
| FR-NM-01 | Manual Note Creation & Editing | [Package 2.3](../../spec/requirements/v2/package_2_3_notes_pinboard_lifecycle.md#fr-nm-01--manual-note-creation--editing) | No deviation recorded |
| FR-NM-02 | Save Chat Response as Note | [Package 2.3](../../spec/requirements/v2/package_2_3_notes_pinboard_lifecycle.md#fr-nm-02--save-chat-response-as-note) | Saved response is read-only; editable conversion creates a manual copy |
| FR-NM-03 | Convert Notes to Source | [Package 2.3](../../spec/requirements/v2/package_2_3_notes_pinboard_lifecycle.md#fr-nm-03--convert-notes-to-source-1-click-roundtrip) | C-01, FR-SI-01, FR-WM-07 |
| FR-NM-04 | Contextual AI Operations on Selected Notes | [Package 2.3](../../spec/requirements/v2/package_2_3_notes_pinboard_lifecycle.md#fr-nm-04--contextual-ai-operations-on-selected-notes) | C-02; note snapshot must use FR-NM-03 |

- **Within-Release Prerequisites (`spec/requirements/README.md`)**: FR-NM-01 depends on FR-WM-01 and FR-UI-01. FR-NM-02 depends on FR-GC-02 and FR-NM-01 and shares the save-note action with FR-GC-09 in Package 2.2. FR-NM-03 depends on FR-NM-01/02, FR-SI-01, and C-01; source limits and slot reservation follow FR-WM-07 and FR-SI-01. FR-NM-04 depends on FR-NM-01/03, FR-GC-01, and C-02. Package 2.2 and 2.3 share one save-note contract.
- **Role Phasing (`FR-WM-04/05`, `NFR-SEC-02`)**: v2.0 is Owner-only. Editor mutation permissions and Viewer read access described in the cards become active only in v6.0.
- **Data Residency (`D3`)**: EU preferred, with `europe-west4` as the default; this package defines no region exception.
- **Upstream Flow-Back Status (`CC-01`)**: No clarifications or downstream refinements have been made. This specification transcribes the Package 2.3 FR cards and applicable binding rules.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create and maintain research notes (Priority: P1)

**SRS IDs**: FR-NM-01  
**Actors**: Notebook Owner

As a researcher, I want to create, format, edit, and delete notes alongside my notebook sources, so that I can preserve my own hypotheses and synthesis in one workspace.

**Why this priority**: Manual notes provide the base lifecycle for capturing user-authored knowledge and are a prerequisite for saved responses, source conversion, and contextual note operations.

**Independent Test**: Create a note, enter a title and formatted content, close and reopen it, then verify persistence, limits, delete confirmation, and offline recovery behavior.

**Acceptance Scenarios**:

1. **Given** an open notebook, **When** the owner clicks `"+ Add note"` in the Right Panel, **Then** a new note editor opens, the content area receives focus, and the default title is `"New note"` (`FR-NM-01`).
2. **Given** a new note, **When** the owner enters title `"Key Audit Findings"` and body `"## Risk 1\nMissing mTLS on port 8080"` and closes the editor, **Then** the note appears in the Right Panel and reopening it displays the saved Markdown content (`FR-NM-01`).
3. **Given** an edited note, **When** the owner pauses typing, **Then** the content is automatically saved within one second and formatting for headings, bold, italic, lists, and links is preserved (`FR-NM-01`).
4. **Given** a note selected for deletion, **When** the owner selects Delete and confirms, **Then** the note is permanently removed from the notebook (`FR-NM-01`).

### User Story 2 - Preserve and revisit a grounded chat answer (Priority: P1)

**SRS IDs**: FR-NM-02, FR-GC-09  
**Actors**: Notebook Owner

As a knowledge worker, I want to save a chat answer as a note with working citations, so that I can keep useful findings independently of the conversation.

**Why this priority**: Saved answers retain verified research output and bridge chat interactions to the persistent notes lifecycle.

**Independent Test**: Save assistant messages with and without citations, clear the chat, then verify the note's contents, citation navigation, read-only state, and independence.

**Acceptance Scenarios**:

1. **Given** an assistant response citing `[1]` from `"Spec.pdf"`, **When** the owner saves it to notes and clears chat history, **Then** chat is empty and the saved-response note remains in the Right Panel with a working `[1]` citation to `"Spec.pdf"` (`FR-NM-02`).
2. **Given** a saved-response note, **When** the owner opens it, **Then** its citation badges open the Source Inspector and the note is read-only (`FR-NM-02`).
3. **Given** a saved-response note, **When** the owner chooses Convert to editable note, **Then** a separate manual copy is created, origin metadata is retained, verified citation badges are removed from editable prose, and the original saved response remains unchanged (`FR-NM-02`).
4. **Given** an assistant response with no citations, **When** the owner saves it as a note, **Then** the response is saved without citation badges (`FR-NM-02`).
5. **Given** the owner saves the same message more than once, **When** the repeated save is processed, **Then** the existing note is returned and no duplicate is created (`FR-GC-09`, FR-NM-02).

### User Story 3 - Convert notes into citable sources (Priority: P1)

**SRS IDs**: FR-NM-03, FR-SI-01, FR-WM-07, C-01  
**Actors**: Notebook Owner

As an analyst, I want to convert one or more notes into a source, so that subsequent grounded chat can cite my curated findings.

**Why this priority**: Note-to-source conversion completes the key v2.0 research roundtrip and makes curated notes usable through the existing source-grounding path.

**Independent Test**: Convert one note, multiple selected notes, and all notes; verify source creation, content ordering, Ready state, selection, quota handling, limits, and citation of the new source.

**Acceptance Scenarios**:

1. **Given** a notebook with a source stating `"Project codename is TITAN-77"`, **When** the owner asks for the codename, saves the cited answer as a note, converts that note to a source, selects only the converted source, and asks again, **Then** the assistant answers `"TITAN-77"` with a citation to the converted note source (`FR-NM-03`, Gate v2.0 #2).
2. **Given** three non-empty notes and one free source slot, **When** the owner converts those notes together, **Then** exactly one source contains the notes in displayed order under their titles, the originals remain unchanged, and later note edits do not change the converted source (`FR-NM-03`).
3. **Given** a selected note with a title and content, **When** the owner converts it, **Then** the new source becomes Ready, is selected for chat, and is independently citable through its own C-01 chunks (`FR-NM-03`).
4. **Given** multiple notes are selected, **When** the owner chooses Convert selected to source or Convert all notes to source, **Then** the selected set or all notebook notes are concatenated under their titles into one new source (`FR-NM-03`).
5. **Given** the notebook has reached its configured source limit, **When** the owner views conversion controls, **Then** conversion is disabled and the owner sees `"Source limit reached"` (`FR-NM-03`, FR-WM-07).

### User Story 4 - Ask the Note Assistant to work with selected notes (Priority: P2)

**SRS IDs**: FR-NM-04, FR-NM-03, FR-GC-01, C-02  
**Actors**: Notebook Owner

As a writer, I want to summarize, outline, find related ideas, or critique selected notes, so that I can organize my thinking and compare it against authorized sources.

**Why this priority**: Contextual actions turn note collections into structured and grounded work while reusing the notebook's existing source contracts.

**Independent Test**: Select notes with known content and source evidence, run each action, and verify snapshot disclosure, note-source conversion, scope, citations, result display, and failure behavior.

**Acceptance Scenarios**:

1. **Given** a manual note stating `"Deployment requires zero downtime"` and an active source stating `"Migration requires a 4-hour maintenance window"`, **When** the owner selects the note and clicks Critique, **Then** the assistant highlights the discrepancy and cites the source (`FR-NM-04`).
2. **Given** selected non-empty notes, no selected sources, and one free source slot, **When** the owner clicks Summarize and sees that a source snapshot will be created, **Then** the notes are converted to one source, that source is selected, and synthesis begins only after it reaches Ready and is read through C-02 (`FR-NM-04`, FR-NM-03).
3. **Given** notes are selected and the owner chooses Create outline, **When** the operation completes, **Then** the result is shown as a validated ChatMessage and can be saved using Save to note (`FR-NM-04`, FR-NM-02).
4. **Given** the owner selects one or more notes, **When** the contextual action bar appears, **Then** it provides Summarize, Create outline, Suggest related ideas, and Critique (`FR-NM-04`).

### Edge Cases *(mandatory)*

- **Note title and body (`FR-NM-01`)**: Title is 1–200 Unicode code points after outer whitespace trimming; the default is `"New note"`. Body may be empty and is limited to 100,000 words. Reject over-limit values; do not silently truncate. Rich text/Markdown supports headings, bold, italic, bulleted and numbered lists, and links; persisted content is sanitized.
- **Save state and recovery (`FR-NM-01`)**: Closing the editor flushes pending saves before success is reported. If the browser terminates or goes offline before persistence, retain a local draft, show pending/error status, recover it on reopening, and never show unsaved content as saved.
- **Note deletion (`FR-NM-01`)**: Deletion requires confirmation and permanently removes the note.
- **Saved response integrity (`FR-NM-02`)**: A saved response copies response text and citation metadata independently, so clearing chat does not delete it. It remains read-only; converting to editable creates a separate manual copy without verified citation badges. A zero-citation response saves without badges.
- **Note conversion (`FR-NM-03`)**: A single note retains its title; a multi-note source is titled `"Combined notes"`. An empty or whitespace-only combined body disables conversion. The original notes remain unchanged; subsequent edits do not synchronize into an already converted source.
- **Source capacity and content limits (`FR-NM-03`, FR-WM-07, FR-SI-01)**: Conversion atomically reserves one source slot. At the configured notebook maximum, conversion is disabled with `"Source limit reached"`. Reject content above either the inclusive 200,000,000-byte source limit or the independent inclusive 500,000 extracted-word limit without consuming a slot or truncating content. Never exceed the configured source count.
- **Invalid note selection (`FR-NM-03`)**: Every note ID must belong to the current notebook and be readable. Reject invalid or cross-notebook IDs; do not create a source.
- **Note Assistant selection and scope (`FR-NM-04`, C-02)**: Select 1–50 notes. Summarize and Outline use the Ready source snapshot of selected notes alone; Related ideas and Critique use that snapshot plus explicitly selected existing Ready sources. Any generated factual claim cites active C-01 chunks through C-02 and distinguishes note assertions from facts supported by other sources.
- **Related ideas and Critique without comparison sources (`FR-NM-04`)**: If no existing source is selected, prompt the owner to select a comparison source. Summarize and Outline may proceed with the note snapshot alone.
- **Conversion or quota failure (`FR-NM-04`)**: If note-to-source conversion fails or no source slot is available, show an error and do not make a model call.
- **Authorization and revision changes (C-02, FR-NM-03/04)**: Enforce notebook and note access for every operation. Snapshot source IDs and revisions at submission; recheck authorization before reading and publishing. If a captured revision is deleted, replaced, or unauthorized, fail without stale output or silent substitution.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (FR-NM-01)**: When the Owner clicks `"+ Add note"` in the Right Panel, the system MUST create an editable note, open the Note Editor, and focus its content area. The initial title MUST be `"New note"` and the initial body MUST be empty.
- **FR-002 (FR-NM-01)**: The Note Editor MUST allow an editable title of 1–200 Unicode code points after trimming outer whitespace and a body of 0–100,000 words. It MUST support headings, bold, italic, bulleted and numbered lists, and links, and persist sanitized Markdown or equivalent rich text. Over-limit input MUST be rejected, not truncated.
- **FR-003 (FR-NM-01)**: The system MUST automatically save note edits within 1.0 second after a typing pause. Closing the editor MUST flush pending saves before reporting success.
- **FR-004 (FR-NM-01)**: When the Owner confirms deletion of a note from its editor or card menu, the system MUST permanently remove it from the notebook.
- **FR-005 (FR-NM-01)**: If offline or abrupt browser termination prevents a pending save from reaching the service, the system MUST retain a recoverable local draft, show pending or error status, and restore it on reopening; it MUST NOT represent unsaved edits as saved.
- **FR-006 (FR-NM-02, FR-GC-09)**: When the Owner selects Save to note on an assistant message, the system MUST create a Right Panel saved-response note containing the full response, an auto-generated or prompt-derived title, and preserved citation metadata, and show `"Saved to notes"`.
- **FR-007 (FR-NM-02)**: Saved-response notes MUST be read-only and preserve working citation badges that open the Source Inspector. Their response text and citation metadata MUST be independent of chat history, so clearing the chat MUST NOT remove the note.
- **FR-008 (FR-NM-02)**: When the Owner converts a saved response to an editable note, the system MUST create a separate manual note, preserve origin metadata, remove verified citation badges from editable prose, and leave the original saved response unchanged. A saved response with no citations MUST be allowed and display no citation badges.
- **FR-009 (FR-GC-09, FR-NM-02)**: Save to note MUST be idempotent for the same requesting user and message. Repeated requests MUST return the existing note and MUST NOT create duplicates; the action MUST be disabled while a request is pending.
- **FR-010 (FR-NM-03, FR-SI-01, C-01)**: The Owner MUST be able to convert one note, selected notes, or all notebook notes into one new source by passing their Markdown content through the Markdown ingestion path and chunking it under C-01. A single-note source retains the note title; a multi-note source is titled `"Combined notes"` and contains each note under its title in displayed order, defined as `display_order` ascending (creation order, stable across edits). A note title longer than the 100-code-point source title limit is clamped to 100 code points for the source title; the full title stays as the first Markdown heading. "Convert all notes" has no note-count cap; only the source byte/word limits bound it.
- **FR-011 (FR-NM-03)**: Conversion MUST require 1 or more readable non-empty notes belonging to the current notebook. A whitespace-only combined body MUST disable conversion. Conversion MUST preserve original notes and source content as a snapshot; later note edits MUST NOT alter the converted source.
- **FR-012 (FR-NM-03, FR-WM-07, FR-SI-01)**: Conversion MUST atomically reserve one source slot and enforce both inclusive source limits: 200,000,000 bytes and 500,000 extracted words. If capacity or either content limit is exceeded, reject conversion without truncation or slot consumption; when the notebook is at its configured source maximum, disable the action and show `"Source limit reached"`.
- **FR-013 (FR-NM-03, C-01, C-02)**: A successful conversion MUST create one `note_markdown` source from the note ID and revision snapshot, ingest it into C-01 chunks, transition it to Ready, select it for the owner's active source scope, and make new answers cite the converted source's own chunks. Preserved citations inside a note are provenance only and do not replace citations to its new chunks.
- **FR-014 (FR-NM-04)**: When the Owner selects 1–50 notes or opens a single note, the system MUST provide contextual actions Summarize, Create outline, Suggest related ideas, and Critique.
- **FR-015 (FR-NM-04, FR-NM-03)**: Each Note Assistant action MUST disclose that it creates a source snapshot from the exact selected notes, authorize conversion of that selection into one source, and wait until the new source reaches Ready before synthesis. It MUST preserve the original notes and apply normal source quotas.
- **FR-016 (FR-NM-04, C-02)**: Summarize and Create outline MUST use the note-derived Ready source alone. Suggest related ideas and Critique MUST additionally use the explicitly selected existing Ready sources. If no existing source is selected for Related ideas or Critique, prompt the Owner to select a comparison source; do not silently widen scope.
- **FR-017 (FR-NM-04, FR-GC-01, C-01/02)**: Note Assistant factual output MUST cite the active C-01 chunks through C-02 and distinguish note assertions from facts supported by other sources. The validated result MUST be displayed as a ChatMessage; Save to note MUST use FR-NM-02. Failed conversion or exhausted quota MUST stop processing before any model call.
- **FR-018 (FR-NM-04, C-02)**: Every Note Assistant operation MUST use explicit source IDs and revision snapshots, recheck authorization before reading and publishing, and fail without publishing stale output if a captured source is deleted, replaced, or becomes unauthorized.
- **FR-019 (FR-NM-03, FR-NM-04, Gate v2.0 #2)**: Converting a note of at most 5,000 words to a citable Ready source MUST complete within 2.0 seconds. After the note snapshot reaches Ready, validated answer TTFT for a standard Note Assistant operation MUST be at most 2.5 seconds; snapshot conversion progress MUST be shown separately.

### Key Entities

- **Note** (`FR-NM-01`, `FR-NM-02`): Notebook-owned item with title, sanitized Markdown content, origin type (`manual` or `saved_response`), timestamps, and lifecycle `Drafting → Saved → Deleted`.
- **Saved Response Note** (`FR-NM-02`): Read-only note with source message ID, copied response text, citation metadata, and origin metadata, independent of chat-history deletion.
- **Converted Note Source** (`FR-NM-03`, C-01): Ready source containing an immutable snapshot of one or more notes, origin note IDs and revisions, and its own unified document chunks.
- **Note Assistant Operation** (`FR-NM-04`, C-02): Operation type, selected note IDs, resulting note-source snapshot, explicitly selected existing source IDs/revisions when applicable, and validated ChatMessage result.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (FR-NM-01)**: In 100% of supported online editing trials, a note change is persisted within 1.0 second after typing pauses; pending saves are flushed before a successful editor close.
- **SC-002 (FR-NM-02, FR-GC-09)**: A saved response appears in the Right Panel within 300 ms, preserves functional citations, survives chat clearing, and creates no duplicate when saved repeatedly.
- **SC-003 (FR-NM-03, Gate v2.0 #2)**: A note of at most 5,000 words becomes a Ready citable source within 2.0 seconds, and the original note remains unchanged.
- **SC-004 (FR-NM-03, FR-WM-07, FR-SI-01)**: Every attempted conversion at either source-content limit or at the configured source quota boundary is accepted or rejected at the exact inclusive boundary, without truncation or double-consuming a slot.
- **SC-005 (FR-NM-04)**: Each Note Assistant action either produces a citation-validated ChatMessage from its prescribed note/source scope or stops with an error before generation when conversion, authorization, comparison-source, or quota prerequisites fail.
- **SC-006 (FR-NM-03/04, NFR-EVAL-04)**: The full chat-to-note-to-source roundtrip is successful, and all later answers use only the explicitly selected converted source with zero deselected-source leakage.

## Assumptions & Out of Scope

- **In-Scope Release Constraints**: This feature covers Package 2.3 only. v2.0 is Owner-only. Converted note sources follow existing FR-SI-01 ingestion and C-01; Note Assistant reads all source text through C-02. The save-note entry point from Package 2.2 uses the shared FR-GC-09/FR-NM-02 contract.
- **Offline drafts**: The FR-005 local draft is client-only and never sent to the service until a save succeeds.
- **Out of Scope / Deferred**: Real-time multi-cursor collaborative editing; live two-way synchronization from notes to converted sources; raw binary attachments embedded in notes; Studio report generation; and later-release role permissions or sharing behavior.
