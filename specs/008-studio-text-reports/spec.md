# Feature Specification: Studio Text Synthesis & Reports

**Feature Branch**: `008-studio-text-reports`
**Created**: 2026-10-18
**Status**: Draft
**Package Source**: `spec/requirements/v2/package_2_4_studio_text_synthesis_reports.md`
**SRS IDs in Scope**: FR-ST-10, FR-ST-11; C-02, C-03; Gate v2.0 #3
**Release & Gate**: v2.0 (contributes to, but does not independently satisfy, Gate v2.0)
**Input**: User description: "Package 2.4"

## Clarifications

### Session 2026-10-18

- Q: If Source Guide metadata is still pending or failed when the owner opens Reports, what should happen to dynamic report suggestions? → A: Wait for pending Source Guides; if guide generation failed, explain that dynamic suggestions are unavailable while keeping standard and custom report creation usable. (Recommended default adopted because no user response was available.)

## Source Traceability & Package Scope *(mandatory)*

This specification transcribes Package 2.4 and applicable binding cross-package rules. The other v2.0 packages are tracked in separate feature specifications. Package 2.4 introduces C-03 and consumes the shared C-02 source-reading boundary.

| SRS ID | Requirement Title | FR Card Anchor | Architecture Decisions / Deviations |
| :--- | :--- | :--- | :--- |
| FR-ST-10 | Standard Report Templates | [Package 2.4](../../spec/requirements/v2/package_2_4_studio_text_synthesis_reports.md#fr-st-10--standard-report-templates-briefing-doc-study-guide-faq-timeline) | C-02, C-03; Gate v2.0 #3 |
| FR-ST-11 | Dynamic & Custom Prompted Reports | [Package 2.4](../../spec/requirements/v2/package_2_4_studio_text_synthesis_reports.md#fr-st-11--dynamic--custom-prompted-reports) | C-02, C-03 |

- **Within-Release Prerequisites (`spec/requirements/README.md`)**: FR-ST-10 depends on FR-SI-03, FR-UI-01, C-02, and C-03. FR-ST-11 depends on FR-ST-10, FR-SI-02, C-02, and C-03. Package 2.4 defines C-03; the package prerequisite table requires the earlier v2 packages and their contracts for an integrated v2 release.
- **Role Phasing (`FR-WM-04/05`, `NFR-SEC-02`)**: v2.0 is Owner-only. Editor permissions described by the report cards remain deferred until v6.0.
- **Data Residency (`D3`)**: EU preferred, with `europe-west4` as the default; no package-specific region exception is defined here.
- **Upstream Flow-Back Status (`CC-01`)**: The 2026-10-18 clarification (Source Guide pending/failed behavior) and the plan refinements below are flowed back into the FR card (`FR-ST-11` edge cases). The revised card (PR #127, 2026-10-20) is flowed back here in §Card Revision 2026-10-20. No SRS scope change or new `DEV-xx` is required; D16 wording is updated for the Vertex report adapter.
- **v2.0 proof of concept (D16, SRS §5.5 DEV-04)**: Studio artifacts live in the memory of the single running API instance until v3. "Persisted" in this package means kept by the running API; "after reload" means within one running API instance. Access control, sources and chat stay in PostgreSQL (`C-02`).
- **Model routing (architecture "Model routing", D3, `NFR-SEC-01`)**: Reports use Vertex AI **Flash** (`gemini-2.5-flash`); dynamic report suggestions use **Flash-Lite** through the Package 2.2 structured-generation client. Both run in `europe-west4` with keyless ADC. *Owner default 2026-10-20:* reports use Flash only; Pro routing for "long reports" waits until "long report" is defined.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate a standard report from selected sources (Priority: P1)

**SRS IDs**: FR-ST-10, C-02, C-03, Gate v2.0 #3  
**Actors**: Notebook Owner

As an owner, I want to create a Briefing Doc, Study Guide, FAQ, or Timeline from my active sources, so that I can produce useful reference documents without writing a report prompt.

**Why this priority**: The four standard templates are the primary Studio report experience and the third measurable criterion of Gate v2.0.

**Independent Test**: Use a Ready source set with known facts, dates, and actors; launch each standard report and verify asynchronous progress, report sections, grounding, lifecycle, and revision handling.

**Acceptance Scenarios**:

1. **Given** a notebook with two active sources containing dated historical events and technical definitions, **When** the owner starts Briefing Doc, Study Guide, FAQ, and Timeline, **Then** four asynchronous report jobs reach Completed, the Study Guide has a glossary and short-answer questions with an answer key, the Timeline has chronological events and a Cast of Characters, and no report includes facts from unselected sources (`FR-ST-10`, C-02/03).
2. **Given** a report job captured Source A revision 1, **When** Source A is deleted before publication, **Then** the job fails with a source-changed explanation, publishes no stale or silently regenerated report, and retry requires a fresh explicitly scoped request (`FR-ST-10`, C-02/03). The same applies when a source is replaced by a new revision once re-sync exists (`FR-SI-05`, v3.0).
3. **Given** the owner starts a report, **When** the job is queued or running, **Then** its status appears in the Studio list while the owner can continue reading sources or chatting (`FR-ST-10`, C-03).
4. **Given** a completed report artifact, **When** the owner opens it, **Then** a formatted Markdown report is displayed with Copy, Convert to source (saves the report as a note and converts that note through `FR-NM-03`) and Delete (with confirmation) actions (`FR-ST-10`, FR-NM-03).
5. **Given** active sources contain no dated events, **When** the owner generates a Timeline, **Then** it completes with an explicit no-dated-events notice under `events` plus a non-empty `cast_of_characters` section and invents no dates; without any supported actor it fails (`FR-ST-10`).

### User Story 2 - Choose a domain-relevant or custom report (Priority: P2)

**SRS IDs**: FR-ST-11, FR-SI-02, C-02, C-03  
**Actors**: Notebook Owner

As a domain expert, I want suggested report formats tailored to my active sources and the option to define my own structure, tone, and audience, so that I can produce reports suited to my work.

**Why this priority**: Dynamic suggestions and custom prompts expand report usefulness beyond the four fixed templates while preserving source scope.

**Independent Test**: Open the report modal with a known source set, verify suggestions and timing, edit a suggestion, submit a custom prompt at its boundaries, and check the resulting artifact and source grounding.

**Acceptance Scenarios**:

1. **Given** three Ready vendor architecture proposals, **When** the owner opens the Reports modal, **Then** Suggested Format displays 3–4 context-specific report cards (`FR-ST-11`).
2. **Given** a suggested report format, **When** the owner edits its pre-filled prompt to add `"Include a risk matrix"` and clicks Generate, **Then** the resulting report includes a risk matrix grounded in the three vendor sources (`FR-ST-11`, C-02/03).
3. **Given** the owner selects Create Your Own, **When** they provide a custom report structure, tone, and target audience, **Then** the system creates a report job through the shared report lifecycle (`FR-ST-11`, C-03).
4. **Given** a custom prompt containing one non-whitespace character, **When** the owner submits it, **Then** Generate is enabled; an empty or whitespace-only prompt is rejected, and prompts over 5,000 code points are rejected (`FR-ST-11`).
5. **Given** Source Guide metadata for the active source set is available, **When** dynamic suggestions load, **Then** 3–4 suggestions are shown within three seconds and are tailored to those active sources (`FR-ST-11`).
6. **Given** Source Guides for the active sources are still generating, **When** the owner opens Reports, **Then** dynamic suggestions show a loading state until the guides are ready, while standard and custom report options remain usable (`FR-ST-11`).
7. **Given** Source Guide generation failed for an active source, **When** the owner opens Reports, **Then** the modal explains that dynamic suggestions are unavailable and standard and custom report options remain usable (`FR-ST-11`).

### Edge Cases *(mandatory)*

- **Empty active scope (`FR-ST-10`, C-02)**: With no selected Ready source, standard report actions are disabled. The system must not substitute all Ready sources when the selection is omitted or empty.
- **Insufficient evidence (`FR-ST-10/11`, C-03)**: Report targets do not justify invented facts or unsupported padding. Produce fewer supported items, or fail with a refusal; a report with a missing or empty required section is `Failed`, never `Completed` (FR-015).
- **Timeline without dates (`FR-ST-10`)**: The only exception to FR-015: the Timeline completes with an explicit notice under `events` that the selected sources contain no dated events, plus the `cast_of_characters` section; it never invents dates or ordering.
- **Source revision or authorization changes (`FR-ST-10/11`, C-02/03)**: Jobs capture explicit source ID/revision snapshots at submission and recheck authorization before reading and publishing. A deleted, replaced, or newly unauthorized captured source causes failure without stale output or silent substitution. Retry is a new attempt with fresh authorization and scope.
- **Report failure (`C-03`)**: Report job lifecycle is Queued → Running → Completed or Failed. `Cancelled` exists in C-03 for later plugins, but v2 has no cancel action (card: "Cancelled exists in C-03, but v2 has no cancel action"). Errors do not produce a success-shaped artifact.
- **Custom prompt boundary (`FR-ST-11`)**: Accept a non-whitespace prompt of 1–5,000 Unicode code points after trimming outer whitespace; reject empty or over-limit content rather than truncating.
- **Dynamic suggestions (`FR-ST-11`, C-02)**: Suggestions are derived only from the current active Ready source set and its Source Guide metadata in the effective output language. They are cached by the full scope key (notebook, source revisions, effective authorization, output language); any change misses the cache. Without a configured Vertex model the suggestions report `SuggestionsUnavailable`, never an endless loading state (owner default 2026-10-20).
- **Unavailable Source Guides (`FR-ST-11`)**: While active Source Guides are pending, show a loading state for dynamic suggestions without blocking standard or custom reports. If guide generation failed, explain that suggestions are unavailable; do not block standard or custom reports.
- **Grounding and citations (`FR-ST-10/11`, C-02/03, NFR-EVAL-01..04)**: Validate citations against scoped C-01 chunks before publication. If citation validation fails, fail with a refusal explanation and publish no draft with removed citations. Each retry captures fresh authorization and explicit scope.
- **Role restrictions (`FR-WM-04/05`, NFR-SEC-02)**: Studio report generation and artifact actions are Owner-only in v2.0; later role permissions do not activate early.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (FR-ST-10)**: The Studio Right Panel MUST provide a Reports tile or modal with four standard templates: Briefing Doc, Study Guide, FAQ, and Timeline.
- **FR-002 (FR-ST-10)**: A Briefing Doc MUST include the required sections `executive_summary`, `core_themes`, `key_takeaways` and `quotes` (verbatim, cited).
- **FR-003 (FR-ST-10)**: A Study Guide MUST include the required sections `topic_review`, `short_answer_questions`, `answer_key` (answers to those questions), `essay_questions` and `glossary`.
- **FR-004 (FR-ST-10)**: An FAQ MUST provide at least one question with its detailed answer (section `faq`), grounded only in the current active sources.
- **FR-005 (FR-ST-10)**: A Timeline MUST list dated events from the active sources in chronological order (section `events`) and include a `cast_of_characters` section. If no dated events are present, `events` MUST carry an explicit no-dated-events notice and MUST NOT invent dates.
- **FR-005a (FR-ST-10)**: Required sections are identified by stable section keys in `payload_json.sections` (`{ key, heading }`); heading text follows the effective output language (`FR-UI-02`), while keys never change.
- **FR-006 (FR-ST-10, C-02/03)**: When the Owner launches a standard template with at least one explicitly selected authorized Ready source, the system MUST create an asynchronous report artifact job with the submitted source IDs and revision snapshot, show its progress in the Studio list, and allow other notebook work to continue.
- **FR-007 (FR-ST-10, C-02/03)**: Report jobs MUST use the shared C-03 registry and lifecycle Queued → Running → Completed or Failed. `Cancelled` exists in C-03, but v2 offers no cancel action. Completed jobs MUST persist (D16: in the running API) a Markdown report with its citations, sections and `source_revisions_snapshot`.
- **FR-008 (FR-ST-10, FR-NM-03)**: The owner MUST be able to open a completed artifact in the Markdown viewer, copy it, delete it after confirmation, or convert it to a source: Convert to source saves the report as a note and converts that note through `FR-NM-03` (citation markers removed from the source text, kept as `origin_citations`).
- **FR-009 (FR-ST-11, FR-SI-02)**: When the Owner opens the Create report modal, the system MUST analyze Source Guide metadata (in the effective output language) from the current active source set and offer 3–4 context-specific suggested report formats, each with a title, description, and pre-filled prompt. Dynamic suggestions MUST load within 3.0 seconds and MUST be cached by the full scope key: notebook, source revisions, effective authorization, output language.
- **FR-010 (FR-ST-11, FR-GC-01/02)**: The Create report modal MUST provide Create Your Own, allowing the Owner to specify a custom report structure, tone, and target audience using a 1–5,000 Unicode code point prompt after trimming outer whitespace. Empty and over-limit prompts MUST be rejected without truncation. The prompt changes only structure, tone and audience; `FR-GC-01` grounding and `FR-GC-02` citations stay non-overridable.
- **FR-011 (FR-ST-11, C-03, FR-GC-01/02)**: The Owner MUST be able to generate a report from a suggested format (subtype `dynamic`), edit its pre-filled prompt before generation, or submit a Create Your Own prompt (subtype `custom`); each action MUST create a C-03 report job. Edited suggestion prompts are bound by the same non-overridable grounding and citation rules as FR-010.
- **FR-011a (FR-UI-02, FR-ST-10/11)**: Reports and suggestions use the effective output language; a request without `output_language` resolves it server-side (notebook > user > `en-US`) and the artifact stores it.
- **FR-012 (FR-ST-10/11, C-02)**: Every report and dynamic suggestion MUST use only the current explicitly selected, authorized Ready sources. An empty or omitted selection MUST NOT trigger an all-sources fallback; report controls MUST be disabled when the active source set is empty.
- **FR-013 (FR-ST-10/11, C-02/03)**: Every report job MUST capture source IDs and revisions at submission and recheck access before reading and publication. A deleted, replaced, or unauthorized captured source MUST fail the job with an explanation, publish no stale artifact, and require a new attempt with fresh authorization and explicit scope.
- **FR-014 (FR-ST-10/11, C-02/03)**: The system MUST validate factual citation IDs against the scoped C-01 chunks before publication. Citation validation failure MUST fail the report with a refusal explanation; the system MUST NOT publish a draft with citations stripped or silently retry.
- **FR-015 (FR-ST-10/11, C-03)**: Requested report content and counts MUST be constrained by the available evidence. A missing or empty required section makes the job `Failed` (`InsufficientEvidence`), never `Completed`. The only exception is a Timeline over sources with no dated events, which completes with the explicit no-dated-events notice plus a non-empty `cast_of_characters`.
- **FR-016 (FR-ST-10, FR-WM-04/05, NFR-SEC-02)**: In v2.0, report generation and artifact management MUST be available to the notebook Owner only. Later-release role permissions MUST remain deferred until their authorized release.
- **FR-017 (FR-ST-10, Gate v2.0 #3)**: All four standard templates MUST generate valid, grounded Markdown documents in 100% of release-gate cases, with P95 generation time at or below 25.0 seconds. A report is valid when every required section key is present and every factual sentence of a required section cites a chunk in its captured scope.
- **FR-018 (FR-ST-11)**: If Source Guide metadata for active sources is pending, the system MUST show a loading state for dynamic suggestions while keeping standard and custom report options usable. If Source Guide generation failed, the system MUST explain that dynamic suggestions are unavailable and MUST keep standard and custom report options usable.

### Key Entities

- **Studio Report Job** (`FR-ST-10/11`, C-03): An asynchronous generation attempt with template or custom subtype, explicit source/revision snapshot, current status, progress information, and failure or cancellation details.
- **Studio Artifact** (`FR-ST-10/11`, C-03): A completed Markdown report with title, subtype, `payload_json { content_md, citations, sections }`, `source_revisions_snapshot` (source IDs with revisions), output language, creation time, and copy, convert-to-source, and delete actions.
- **Suggested Report Format** (`FR-ST-11`, FR-SI-02, C-02): A context-specific report title, description, and prompt template derived from Source Guide metadata for the current active source set.
- **Custom Report Prompt** (`FR-ST-11`): Owner-provided instructions describing report structure, tone, and target audience, limited to 1–5,000 trimmed Unicode code points.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (FR-ST-10, Gate v2.0 #3)**: 100% of the four standard templates produce valid Markdown with required sections and citations supported by active sources; P95 generation time is at most 25.0 seconds.
- **SC-002 (FR-ST-10, C-02/03, NFR-EVAL-04)**: No report contains facts from deselected or unauthorized sources; leakage is zero, and replaced or revoked source revisions cannot produce a published artifact.
- **SC-003 (FR-ST-11)**: 3–4 context-specific suggested formats are available within 3.0 seconds for the current active source set.
- **SC-004 (FR-ST-11)**: Custom prompts of 1 and 5,000 trimmed Unicode code points are accepted; empty prompts and 5,001 code points are rejected without truncation.
- **SC-005 (FR-ST-10/11, C-03)**: Each report job ends in a valid Queued → Running → Completed or Failed lifecycle (`Cancelled` is reserved in C-03; v2 has no cancel action); no failed or incomplete report is presented as completed.
- **SC-006 (FR-ST-10/11)**: Owners can open, copy, convert to source, and delete completed report artifacts from the Studio viewer.

## Plan Refinements *(flow-back from `/speckit-plan`, 2026-10-19)*

- **C-03 shape (C-03)**: `StudioGeneratorPlugin` = `manifest` + `triggerJob(request)` (synchronous validation) + `generate(ctx)`; the shared runner owns lifecycle, access re-checks and citation validation. See [plan](plan.md) and [contracts](contracts/interfaces.md).
- **Insufficient evidence (FR-015)**: *(superseded 2026-10-20 by the revised card)* every required section must be non-empty, otherwise the job fails with a refusal; the Timeline no-dated-events case is the only exception. See [data-model](data-model.md).
- **Citation validation (FR-014)**: besides chunk-ID membership and revision match, verbatim quotes and timeline dates must literally occur in the cited chunk text.
- **Retry (FR-013, C-03)**: retry is only for `Failed` (and C-03 `Cancelled`) artifacts, requires a fresh explicit `active_source_ids`, and creates a new attempt row; the old row is immutable.
- **Suggestions (FR-009, FR-018)**: result states `SuggestionsLoading`, `SuggestionsReady` (3–4 items), `SuggestionsUnavailable`; suggestion generation is bounded by a 3,000 ms timeout and cached per notebook, exact `(source_id, revision)` set, subject, language.
- **Deletion hygiene (Constitution III)**: reading an artifact whose captured sources are deleted, replaced or unauthorized returns an unavailable placeholder instead of content.

## Card Revision 2026-10-20 *(flow-back from `/speckit-converge`, PR #127)*

- Section keys (FR-002..FR-005a), the FR-015 rule with the Timeline exception, the Gate v2.0 #3 validity rule (FR-017 / SC-001), no cancel action in v2 (FR-007, Edge Cases), the deletion scenario before publication (US1/AC2), Convert to source via a note and Delete with confirmation (FR-008), non-overridable grounding for custom and edited prompts (FR-010/011), the full suggestion cache key (FR-009), the effective output language (FR-011a, `FR-UI-02`), the persisted `source_revisions_snapshot` field, the D16 meaning of "persisted", and the model routing (Flash for reports, Flash-Lite for suggestions, `europe-west4`, keyless ADC) are taken from the revised card (`FR-ST-10`, `FR-ST-11`, `C-03`, Constitution I / `CC-01`).
- Owner defaults 2026-10-20: reports use Flash only (no Pro routing until "long report" is defined); the snapshot field is renamed to `source_revisions_snapshot`; without a configured Vertex model suggestions show "unavailable"; the cancel route and UI are removed.

## Assumptions & Out of Scope

- **In-Scope Release Constraints**: This specification covers Package 2.4 (FR-ST-10 and FR-ST-11), consumes C-02, and defines the shared C-03 registry for report generators. v2.0 is Owner-only. Markdown reports may be converted to sources using the existing FR-NM-03 source-conversion capability.
- **Out of Scope / Deferred**: Interactive Learning Overviews (FR-ST-12, v4.0); Mindmaps and Data Tables (v3.0); Flashcards, quizzes, slides, and infographics (v4.0); audio and video overviews (v5.0); direct PDF/DOCX report export; external Word/LaTeX template uploads; and non-owner report permissions before v6.0.
