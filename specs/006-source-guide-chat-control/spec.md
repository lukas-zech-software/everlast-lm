# Feature Specification: Proactive Context Intelligence & Chat Control

**Feature Branch**: `006-source-guide-chat-control`
**Created**: 2026-10-18
**Status**: Draft
**Package Source**: `spec/requirements/v2/package_2_2_proactive_context_intelligence_chat_control.md`
**SRS IDs in Scope**: FR-SI-02, FR-GC-04, FR-GC-05, FR-GC-07, FR-GC-09; C-02; Gate v2.0 #1 and #2
**Release & Gate**: v2.0 (contributes to, but does not independently satisfy, Gate v2.0)
**Input**: User description: "v2" — scoped to Package 2.2, the next v2.0 package after Package 2.1, because the constitution requires one FR package per feature specification.

## Source Traceability & Package Scope *(mandatory)*

This specification transcribes Package 2.2 and applicable binding cross-package rules. Packages 2.1, 2.3, and 2.4 are separate specifications; the save-note action in this package shares its contract with Package 2.3.

| SRS ID | Requirement Title | FR Card Anchor | Architecture Decisions / Deviations |
| :--- | :--- | :--- | :--- |
| FR-SI-02 | Automatic Source Guide | [Package 2.2](../../spec/requirements/v2/package_2_2_proactive_context_intelligence_chat_control.md#fr-si-02--automatic-source-guide-quellenüberblick) | C-02; D3 residency; D16 (API-process background work) |
| FR-GC-04 | Notebook Overview & Starter Prompts | [Package 2.2](../../spec/requirements/v2/package_2_2_proactive_context_intelligence_chat_control.md#fr-gc-04--notebook-overview--starter-prompts) | C-02; D3 residency |
| FR-GC-05 | Dynamic Follow-up Suggestions | [Package 2.2](../../spec/requirements/v2/package_2_2_proactive_context_intelligence_chat_control.md#fr-gc-05--dynamic-follow-up-suggestions) | C-02 |
| FR-GC-07 | Configurable Personas, Goals & Response Styles | [Package 2.2](../../spec/requirements/v2/package_2_2_proactive_context_intelligence_chat_control.md#fr-gc-07--configurable-personas-goals--response-styles) | FR-GC-01/02 guardrails are non-overridable |
| FR-GC-09 | Response Actions & Quality Feedback | [Package 2.2](../../spec/requirements/v2/package_2_2_proactive_context_intelligence_chat_control.md#fr-gc-09--response-actions--quality-feedback) | Shared save-note contract with FR-NM-02 |

- **Within-Release Prerequisites (`spec/requirements/README.md`)**: FR-SI-02 depends on FR-SI-01, FR-SI-04, C-01, and C-02. FR-GC-04 depends on FR-SI-02, FR-GC-01, and C-02. FR-GC-05 depends on FR-GC-01 and C-02. FR-GC-07 depends on FR-GC-01. FR-GC-09 depends on FR-GC-01 and FR-NM-01 and shares one save-note contract with FR-NM-02 in Package 2.3. Package 2.1 language preferences precede language-sensitive generators.
- **Role Phasing (`FR-WM-04/05`, `NFR-SEC-02`)**: v2.0 is Owner-only. Editor, Viewer Full, and Viewer Chat-Only permissions are deferred until v6.0. Copy and feedback behavior for other roles is specified only for that later phase.
- **Data Residency (`D3`)**: EU preferred; `europe-west4` is the default, with only documented feature-specific region exceptions.
- **v2.0 proof of concept (`D16`, SRS §5.5 DEV-04)**: v2 records (Source Guides, overviews, chat configuration, feedback, follow-ups, notes) live in the single running API process until v3. "Persisted" in this specification means kept by the running API; "across sessions" and "after reload" mean within one running API instance. Access control, sources and chat history stay in PostgreSQL.
- **Upstream Flow-Back Status (`CC-01`)**: Implementation records `source_word_count` in the Source Guide DTO to validate the existing `<50`-word topic rule, and uses a SHA-256 authorization partition rather than exposing the raw owner ID in overview cache metadata. These refinements are documented in the Package 2.2 card and implementation contracts. The revised card (card review 2026-10-20, SRS §5.6) is transcribed here: topic chips use the current selection, guides are keyed by output language, follow-up chips carry their own support IDs and sit above the chat input bar, feedback can be cleared, and the shared save-note contract fixes the title and `400` rules. Implementation adds `ready_at` to the Source Guide DTO so latency from `Ready` is measurable (FR-018).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Understand a source and start a grounded conversation (Priority: P1)

**SRS IDs**: FR-SI-02  
**Actors**: Notebook Owner

As a researcher opening an unfamiliar document, I want a concise source summary and clickable key topics, so that I can quickly understand the source and ask a focused question about it.

**Why this priority**: The Source Guide turns an ingested source into an immediately explorable resource and is the first criterion of Gate v2.0.

**Independent Test**: Ingest a Ready source with known content and verify the generated summary, topic chips, source isolation, inspector presentation, timing, and chat action.

**Acceptance Scenarios**:

1. **Given** a 15-page PDF has reached `Ready`, **When** its Source Guide generation completes, **Then** it contains a 100–250 word summary and 5–10 key topic chips and appears above the document text in the Source Inspector within 10 seconds after `Ready` (`FR-SI-02`, Gate v2.0 #1).
2. **Given** the Source Inspector is open for `"Cloud_Strategy.pdf"` and shows `"Zero Trust Architecture"`, **When** the owner clicks that topic chip, **Then** a grounded chat query about `"Zero Trust Architecture"` is sent with the owner's current source selection; if `"Cloud_Strategy.pdf"` is not selected, a select-sources prompt appears instead, nothing is sent, and the selection is not changed (`FR-SI-02`, binding scope rule).
3. **Given** an eligible source contains fewer than 50 words, **When** its Source Guide is generated, **Then** the guide contains a one-sentence summary and 1–3 topic chips without unsupported padding (`FR-SI-02`).
4. **Given** Source Guide generation fails transiently, **When** the system retries, **Then** it uses exponential backoff and keeps the full source text readable immediately (`FR-SI-02`).
5. **Given** the owner has received a grounded answer and saved it using `"Save to note"`, **When** they convert that saved-response note into a source and select only that source for the next chat turn, **Then** the assistant can cite the converted source's content (`FR-GC-09`, FR-NM-02/03, Gate v2.0 #2).

### User Story 2 - Get an overview of selected sources (Priority: P1)

**SRS IDs**: FR-GC-04  
**Actors**: Notebook Owner

As an owner opening a populated notebook, I want a synthesis of my currently selected sources and suggested starter questions, so that I can begin a useful conversation without facing a blank page.

**Why this priority**: The notebook overview gives users a quick, scoped entry point into their current source set.

**Independent Test**: Create a notebook with Ready sources and controlled selections, then verify overview and prompt contents, state changes, timing, and that changing scope cannot expose stale material.

**Acceptance Scenarios**:

1. **Given** an empty notebook, **When** its first source reaches `Ready`, **Then** the Center Chat Panel displays an overview and 3–5 clickable starter questions derived from that source (`FR-GC-04`).
2. **Given** Sources A and B are selected and the overview contains a fact found only in B, **When** the owner deselects B, **Then** the old overview and starter prompts are hidden immediately, replacement generation reads only A through C-02, and another user's selection and overview remain unchanged (`FR-GC-04`, C-02).
3. **Given** a starter question is displayed, **When** the owner clicks it, **Then** the question is submitted as a user turn in the Grounded Chat Engine (`FR-GC-04`).
4. **Given** all sources in the notebook are deleted, **When** the overview updates, **Then** the overview and starter questions clear and the panel returns to `"Add a source to get started"` (`FR-GC-04`).

### User Story 3 - Continue exploring after an answer (Priority: P2)

**SRS IDs**: FR-GC-05  
**Actors**: Notebook Owner

As an owner exploring a topic, I want the system to suggest follow-up questions that my active sources can answer, so that I can continue the conversation without composing every next question myself.

**Why this priority**: Relevant follow-ups make grounded exploration easier while preserving explicit source scope.

**Independent Test**: Complete a chat response with a known active source set and verify follow-up count, answerability, timing, click behavior, and response to scope changes or refusals.

**Acceptance Scenarios**:

1. **Given** a completed answer about `"Server Alpha"` and active sources support at least three distinct follow-ups, **When** response streaming completes, **Then** three answerable follow-up chips appear in one row above the chat input bar within one second and clicking one submits it as the next chat turn (`FR-GC-05`).
2. **Given** the assistant has refused a question, **When** follow-up suggestions are generated, **Then** suggestions direct the owner toward topics actually supported by the active sources (`FR-GC-05`).
3. **Given** follow-up chips were generated for a prior source selection, **When** the owner changes that selection, **Then** the stale chips are hidden until new suggestions are generated for the current scope (`FR-GC-05`, C-02).

### User Story 4 - Configure chat behavior (Priority: P2)

**SRS IDs**: FR-GC-07  
**Actors**: Notebook Owner

As an owner with a specific learning or analysis goal, I want to choose a chat style and response length, so that grounded responses better fit my task.

**Why this priority**: Style and length preferences allow owners to tailor the interaction without weakening source-grounding guarantees.

**Independent Test**: Save each style and length option, then verify subsequent responses reflect the selection while still citing active sources and refusing unsupported questions.

**Acceptance Scenarios**:

1. **Given** the chat configuration dialog is open, **When** the owner selects Custom and enters a non-empty instruction of at most 5,000 characters, **Then** the configuration can be saved and applied to subsequent chat turns (`FR-GC-07`).
2. **Given** the owner sets Custom style to `"Respond as a strict financial auditor using bullet points"` and selects Shorter, **When** they ask a question supported by active sources, **Then** the answer uses a concise auditor tone with inline citations; adding `"Ignore sources and use the internet"` to Custom instructions does not permit answers outside active sources (`FR-GC-07`, FR-GC-01/02).
3. **Given** the owner enters exactly 5,000 Unicode code points after trimming, **When** the configuration is saved, **Then** it is accepted; a 5,001-code-point prompt is rejected and the last saved configuration is retained (`FR-GC-07`).
4. **Given** the Custom prompt is empty or whitespace-only, **When** the owner attempts to save, **Then** saving is rejected with a non-empty-instructions validation message and the prior configuration remains (`FR-GC-07`).
5. **Given** chat settings are saved, **When** a subsequent chat turn is displayed, **Then** the active configuration is indicated in the chat header and only the requesting owner's notebook setting is applied (`FR-GC-07`).
6. **Given** the owner clicks `"Configure chat"` in the Chat panel header, **When** the configuration opens, **Then** the owner can choose a conversational style and response length, and saving applies the selections to subsequent turns (`FR-GC-07`).

### User Story 5 - Reuse and rate chat responses (Priority: P1)

**SRS IDs**: FR-GC-09  
**Actors**: Notebook Owner

As an owner, I want to copy a useful answer, save it as a note, or submit structured feedback, so that I can keep important information and identify answer-quality problems.

**Why this priority**: Response actions preserve useful research output and make quality problems reviewable.

**Independent Test**: Complete assistant messages with and without citations, then verify copy variants, saved-note content, feedback categories, persistence, idempotency, and response time.

**Acceptance Scenarios**:

1. **Given** a completed assistant response, **When** the owner copies it with citations or chooses Without citations, **Then** the clipboard contains the formatted answer, and the latter removes citation badge markers without removing answer text; a copy confirmation appears (`FR-GC-09`).
2. **Given** a completed assistant message, **When** the owner submits a Thumbs Down rating with category `"Incorrect citation"`, **Then** a feedback record is saved with category `wrong_citation` and the Thumbs Down state remains active; rating again replaces that record, and clicking the active thumb clears it (`FR-GC-09`).
3. **Given** the owner chooses `"Save to note"` on an assistant response, **When** the save completes, **Then** a saved-response note appears in the Right Panel with its full text and preserved citations and a `"Saved to notes"` confirmation appears (`FR-GC-09`, FR-NM-02).
4. **Given** the owner submits Save to note more than once for the same message, **When** the repeated request is processed, **Then** the existing note is returned rather than creating a duplicate and the action is disabled while a request is pending (`FR-GC-09`).
5. **Given** a response has no citations, **When** the owner saves it as a note, **Then** it is saved cleanly without citation badges (`FR-GC-09`, FR-NM-02).
6. **Given** a completed response is visible to a user in a later release with read access, **When** that user copies or submits feedback, **Then** both actions are available; saving a notebook note remains restricted to Owner/Editor when those roles are enabled (`FR-GC-09`, FR-WM-04/05).

### Edge Cases *(mandatory)*

- **Source Guide content (`FR-SI-02`)**: A source under 50 words gets a one-sentence summary and 1–3 chips; each chip is at most 40 characters. If evidence cannot support target summary or topic counts, do not pad with unsupported material.
- **Source Guide timing/failure (`FR-SI-02`)**: Generation is asynchronous, fires on every successful ingestion and begins after the source reaches `Ready`; latency is measured from the `Ready` transition; retryable transient failures get at most 3 total attempts (initial attempt plus 2 retries), with 100 ms then 200 ms delays. Permanent errors and invalid structured output are not retried. Exhaustion marks only the guide `GuideFailed` and does not prevent immediate full-text viewing.
- **Singleton source scope (`FR-SI-02`, C-02)**: Source Guide generation reads only that source through an explicit singleton scope `[source_id]`. It does not inherit, change, or populate a user's chat selection.
- **Overview scope (`FR-GC-04`, C-02)**: Overviews use only currently selected, authorized Ready sources through C-02; chunks may be read directly while Source Guides are pending. An empty selection clears the overview and prompts the owner to add/select a source. Source IDs and revisions, effective authorization, and output language changes invalidate stale overview content immediately.
- **Follow-up scope (`FR-GC-05`, C-02)**: Suggestions must be answerable using the current active sources, contain no more than 3 chips, and each be at most 100 characters. Each chip carries its own supporting chunk IDs; a chip whose IDs are not in the current C-02 scope is dropped before persistence and display, without rejecting the other chips. If fewer than 3 are supported, show fewer; hide stale suggestions following a scope change.
- **Starter prompt limits (`FR-GC-04`)**: The overview contains 3–5 starter questions when supported by the active sources; each question is at most 120 characters. Do not pad with unsupported questions.
- **Custom chat configuration (`FR-GC-07`)**: Custom instructions must contain 1–5,000 Unicode code points after trimming. Reject empty or whitespace-only text and values above 5,000; retain the previous saved configuration on rejection. Custom instructions cannot override grounding or citation rules.
- **Feedback (`FR-GC-09`)**: Thumbs Down categories are Hallucination / Untrue, Incorrect citation, Incomplete, and Other. The optional comment is 0–1,000 Unicode code points after trimming outer whitespace. Copy includes citations by default; Without citations removes badge markers only.
- **Feedback record (`FR-GC-09`)**: Feedback records identify the message and submitting user, store an `up` or `down` rating, the selected negative category when applicable, optional comment, and creation time. The selected thumb remains visually active. There is one record per user and message: rating again replaces it, and clicking the active thumb clears it.
- **Source Guide language (`FR-SI-02`, FR-UI-02)**: The guide is generated in the notebook's effective output language and stored per (`source_id`, revision, output language). A request for another language generates that guide on demand and reports `GuidePending` until it is ready.
- **Save response (`FR-GC-09`, FR-NM-02)**: Saving is idempotent per user and message. A saved response preserves its citation badges; a zero-citation response saves without badges. Only roles authorized to create notebook notes may use Save to note.
- **Source and authorization integrity (C-02, FR-GC-01/02, NFR-EVAL-04)**: Every chat or synthesis action uses explicit active Ready source IDs and submission-time `(source_id, revision)` snapshots. Workers recheck access before reads and publication. Deleted, replaced, or newly unauthorized sources fail the operation without publishing stale output or substituting new content.
- **History and cached content (C-02, FR-GC-01/06, NFR-EVAL-04)**: Overview and suggestion caches are bound to notebook, source IDs/revisions, effective authorization, output language, and generation parameters. Content from deselected sources is not inserted into new prompts; deleted or revoked content is unavailable through history, caches, or saved views subject to current authorization.
- **Citation validation (FR-GC-01/02, NFR-EVAL-02)**: Invalid citation IDs cause an immediate refusal before factual content is displayed or saved. The system must not strip invalid citations and publish the remaining draft or silently retry.

## Shared Save-to-Note Contract (`FR-GC-09`, `FR-NM-02`)

Package 2.2 and Package 2.3 use one stable DTO. `POST /api/notebooks/{notebook_id}/chat/messages/{message_id}/note` accepts `{ "notebook_id": "<UUID>", "message_id": "<UUID>" }`; the authenticated user ID is derived from the API identity and is never client-supplied. It returns `{ "note": { "id": "<UUID>", "notebook_id": "<UUID>", "source_message_id": "<UUID>", "title": "<1–200 Unicode code points>", "content_md": "<full response with inline citation markers>", "citations_json": [<Citation>], "origin_type": "saved_response", "read_only": true, "created_at": "<ISO datetime>" } }`. Saves are idempotent by `(authenticated user_id, source_message_id)`; repeated requests return the same note. Citation objects retain the Package 1.3 citation shape and are independently copied so chat deletion does not delete the note. `title` is the preceding user question trimmed to 200 Unicode code points, or `Saved response` when there is none. Body `notebook_id`/`message_id` must equal the path IDs; otherwise, or for an invalid body, the API returns `400 ValidationError`. This is the one save-note route shared with Package 2.3: it writes the single notes store, so the saved note is the record the Package 2.3 notes list returns.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (FR-SI-02, FR-UI-02)**: When a source reaches `Ready` after any successful ingestion, the system MUST asynchronously generate a concise summary and key topic chips in the notebook's effective output language using only that source's chunks through C-02 with an explicit singleton scope `[source_id]`; it MUST persist the summary, topics, source word count used for the short-source rule, and supporting chunk IDs per (`source_id`, revision, output language). When the guide is requested for another output language, the system MUST generate it on demand.
- **FR-002 (FR-SI-02)**: The Source Guide summary MUST target 100–250 words, or be shorter when evidence is insufficient. For a source with fewer than 50 words, it MUST instead provide a one-sentence summary and 1–3 topic chips; otherwise the guide MUST target 5–10 topic chips. Each topic chip MUST be at most 40 characters; the system MUST NOT add unsupported material to meet a target. Hard validation (rejected, never retried or truncated): 1–10 topics (at most 3 under 50 words), a summary of at most 250 words, and exactly one sentence under 50 words; fewer than 5 topics is valid. Sentences are counted deterministically: line breaks, Markdown emphasis and abbreviations ("z. B.", "e.g.", "Fr.") are not boundaries (live Gate v2.0 #1 fix, 2026-10-20).
- **FR-003 (FR-SI-02)**: While a Ready source is open in the Source Inspector, the system MUST display a collapsible Source Guide above the full document text. Clicking a topic chip MUST submit a grounded chat query focused on that topic, scoped to the user's current source selection; if the inspected source is not selected, the system MUST show a select-sources prompt instead of sending and MUST NOT change the selection.
- **FR-004 (FR-SI-02)**: Source Guide generation MUST NOT change or populate the user's active chat selection. Full-text viewing MUST remain available if guide generation fails; transient failures MUST retry with exponential backoff.
- **FR-005 (FR-GC-04)**: When the current selection contains at least one authorized `Ready` source and the notebook is opened, the first source reaches `Ready`, or the selected source IDs, revisions, effective authorization, or output language change, the client MUST request (selection is browser-local, so the request carries the selection) and the system MUST synthesize a notebook overview and 3–5 context-specific starter questions (each no longer than 120 characters) from only the current selected, authorized Ready sources, caching the result by scope key. If the sources do not support the target number, it MUST NOT pad with unsupported questions.
- **FR-006 (FR-GC-04)**: While the current selection contains at least one authorized Ready source, the Center Chat Panel MUST display the notebook icon, title, source count, synthesized overview, and clickable starter questions. A starter-question click MUST execute the question as a user turn in the Grounded Chat Engine.
- **FR-007 (FR-GC-04)**: The system MUST hide a stale overview and its starter prompts immediately after a scope, revision, authorization, or output-language change. If all sources are deleted or no active source is selected, the panel MUST clear the overview and prompts and display the applicable empty state.
- **FR-008 (FR-GC-05, C-02)**: After an assistant response finishes streaming, the system MUST generate and display up to 3 context-relevant follow-up chips, in one row above the chat input bar, answerable from the current active sources; it SHOULD target 3 when the source content supports them. Each chip MUST be at most 100 characters and MUST carry the supporting chunk IDs it can be answered from; chips whose chunk IDs are not in the current C-02 scope MUST be dropped before display. Suggestions MUST be hidden during streaming and invalidated on scope changes.
- **FR-009 (FR-GC-05)**: Clicking a follow-up chip MUST submit the question as the next chat turn. After a refusal, suggestions MUST guide the user toward topics actually present in the active sources.
- **FR-010 (FR-GC-07)**: Clicking `"Configure chat"` in the Chat panel header MUST open a configuration modal providing conversational styles Default, Learning Guide, Analyst, and Custom, and response lengths Default, Longer, and Shorter. Default style and Default response length MUST be initially selected. Settings MUST be saved as `chat_config` (`style`, `custom_instructions`, `response_length`) in the owner's per-notebook settings and applied to subsequent turns; the active configuration MUST be indicated in the chat header.
- **FR-011 (FR-GC-07)**: When Custom style is selected, the system MUST allow custom instructions from 1 to 5,000 Unicode code points after trimming. It MUST reject empty or whitespace-only instructions and values above 5,000 without replacing the last saved configuration.
- **FR-012 (FR-GC-07, FR-GC-01/02)**: Custom instructions MUST NOT override strict active-source grounding or inline citation requirements. Measured once per release gate on the fixed 50-case sample, on cases whose sources support a longer answer, Shorter responses MUST average no more than 50% and Longer responses at least 150% of the Default response token count for the same question. A case whose Default answer is a refusal does not support a longer answer: it is excluded and its ID recorded; if no eligible case remains, the metric fails closed. A Shorter or Longer refusal where Default answered fails closed (confirmed by the owner, 2026-10-20). Shorter asks for at most 2 cited sentences with only the asked fact(s); Longer asks for at least 4 cited sentences covering every relevant supported fact; neither overrides grounding (live Gate v2.0 fix, 2026-10-20).
- **FR-013 (FR-GC-09)**: Below each completed assistant response, the system MUST offer Save to note, Copy, Good response (Thumbs Up), and Bad response (Thumbs Down). The owner MUST be able to copy formatted text with citations by default or without citation badge markers, receive a copy confirmation, and submit a thumbs-up rating.
- **FR-014 (FR-GC-09)**: When the owner chooses Thumbs Down, the system MUST offer categories Hallucination / Untrue, Incorrect citation, Incomplete, and Other, plus an optional 0–1,000 Unicode code point comment. It MUST persist feedback fields for message ID, user ID, `up`/`down` rating, negative category when applicable, optional comment, and creation time; it MUST keep the selected thumb visually active. There MUST be one feedback record per user and message: the latest rating replaces the earlier one, and clicking the active thumb MUST clear the rating.
- **FR-015 (FR-GC-09, FR-NM-02)**: Save to note MUST create a saved-response note in the single notes store shared with Package 2.3, shown in the Right Panel, with the full response text, a title equal to the preceding user question trimmed to 200 Unicode code points (or `Saved response` when there is none), and preserved inline citations. Body IDs that differ from the path IDs MUST be rejected with `400`. Saving a response with no citations MUST succeed without badges. Repeated saves for the same user and message MUST return the existing note and MUST NOT create duplicates.
- **FR-016 (FR-GC-09, FR-WM-04/05)**: Users who can read a response may copy it and submit feedback. Creating a notebook note MUST be limited to roles authorized to create notes; in v2.0 this is Owner only, with Owner/Editor behavior when those roles become active in v6.0.
- **FR-017 (FR-SI-02, FR-GC-04/05/07/09, C-02)**: Every source-derived guide, overview, prompt, follow-up, and chat turn MUST use the applicable explicit authorized scope and current source revisions through C-02. No feature may use a server-side fallback when the active source selection is omitted or empty.
- **FR-018 (FR-SI-02, FR-GC-04, FR-GC-05, Gate v2.0 #1)**: The Source Guide trigger MUST fire on every successful ingestion, and Source Guide generation MUST complete in less than 10.0 seconds at P95 measured from the source's `Ready` transition; the overview and starter questions MUST render within 6.0 seconds after the first source reaches `Ready`; follow-up chips MUST appear within 1.0 second of response stream completion.
- **FR-019 (FR-GC-09)**: Copy and feedback actions MUST complete within 200 ms. Save-to-note MUST render the new note item in the Right Panel within 300 ms.
- **FR-020 (FR-GC-04/05, C-02)**: The system MUST associate overview summaries and starter questions with their supporting chunk IDs and cache them only for the exact notebook, selected source IDs and revisions, effective authorization, output language, and relevant generation parameters. Follow-up suggestions MUST be stored with the latest assistant message.

### Key Entities

- **Source Guide** (`FR-SI-02`, C-02, FR-UI-02): Per (`source_id`, revision, output language) `summary_md`, `key_topics`, supporting chunk IDs, source word count and the observed `Ready` time; generated after Ready, independently of the user's chat selection.
- **Notebook Overview** (`FR-GC-04`, C-02): `overview_md`, starter prompts, and supporting chunk IDs associated with a specific authorized selection, source revisions, and output language.
- **Chat Message** (`FR-GC-05`, FR-GC-09): A user or assistant turn; the latest completed assistant response may have `suggested_followups` and response-action state.
- **Chat Configuration** (`FR-GC-07`): Per-owner notebook `chat_config` JSON containing `style`, optional `custom_instructions`, and `response_length`.
- **Message Feedback** (`FR-GC-09`): One record per user and assistant message with the up/down rating and optional category/comment for negative feedback; re-rating replaces it and clearing removes it.
- **Saved Response Note** (`FR-GC-09`, FR-NM-02): A read-only note in the Package 2.3 notes store containing copied response text and preserved citations, persisted independently from chat history.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (FR-SI-02, Gate v2.0 #1)**: Every successful ingestion triggers a Source Guide, and at least 95% of Source Guides complete in under 10.0 seconds measured from the source's `Ready` transition; opening the source continues to expose the full text when guide generation fails.
- **SC-002 (FR-GC-04)**: The notebook overview and 3–5 starter questions are displayed within 6.0 seconds after the first source reaches `Ready`, and scope changes never display an overview from the prior selection.
- **SC-003 (FR-GC-05)**: Supported follow-up suggestions appear within 1.0 second of response completion, with no more than 3 suggestions and no suggestion exceeding 100 characters.
- **SC-004 (FR-GC-07)**: Custom prompts of 1 and 5,000 trimmed Unicode code points are accepted, while empty prompts and 5,001 code points are rejected; grounding and citation tests continue to pass with adversarial custom instructions.
- **SC-005 (FR-GC-09)**: Copy and feedback actions complete within 200 ms, and saved response notes appear within 300 ms with their original citation links preserved.
- **SC-006 (FR-SI-02, FR-GC-04/05/07/09, NFR-EVAL-04)**: In acceptance scenarios, all generated content uses only the current authorized source scope, with zero deselected-source leakage.
- **SC-007 (FR-GC-09, Gate v2.0 #2)**: The v2.0 roundtrip succeeds: a grounded chat answer can be saved as a note, converted to a source under FR-NM-03, and cited in a subsequent turn using only the converted source.

## Assumptions & Out of Scope

- **In-Scope Release Constraints**: This feature covers Package 2.2 only. Source Guides are background-generated per source; notebook overviews and chat suggestions are bound to the current authorized source selection. The shared save-note action in FR-GC-09 integrates with FR-NM-02; the complete note lifecycle is specified separately in Package 2.3.
- **Out of Scope / Deferred**: Multi-step autonomous web research (FR-SI-07, v6.0); manual editing of Source Guide text; chat-history clearing behavior except saved-note independence; Studio reports and other Studio generators; model training or fine-tuning from feedback; non-owner roles before v6.0; and features assigned to Packages 2.1, 2.3, and 2.4 except the integrations explicitly identified above.
