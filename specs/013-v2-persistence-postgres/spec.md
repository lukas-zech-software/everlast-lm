# Feature Specification: v2 Data Persistence (PostgreSQL)

**Feature Branch**: `013-v2-persistence-postgres`
**Created**: 2026-10-21
**Status**: Draft
**Package Source**: none (technical v3 prerequisite, not an FR package). Behaviour sources: `spec/requirements/v2/package_2_1_workspace_ui_comfort.md`, `package_2_2_proactive_context_intelligence_chat_control.md`, `package_2_3_notes_pinboard_lifecycle.md`, `package_2_4_studio_text_synthesis_reports.md`
**SRS IDs in Scope**: `DEV-04` (closure), `FR-WM-01`, `FR-WM-02`, `FR-WM-03`, `FR-WM-04`, `FR-UI-02`, `FR-SI-02`, `FR-GC-04`, `FR-GC-05`, `FR-GC-07`, `FR-GC-09`, `FR-NM-01`, `FR-NM-02`, `FR-NM-03`, `FR-NM-04`, `FR-ST-10`, `FR-ST-11`, `C-02`, `C-03`
**Release & Gate**: `v3.0` prerequisite (before `Gate v3.0`; SRS §5.6 "v2.0 Proof of Concept")
**Input**: User description: "v3 prerequisite (SRS §5.5 DEV-04, architecture D16): move all release v2 data from per-process memory to PostgreSQL. Scope: workspace preferences, notebook icons/topic-icon claim, pins and last-opened (Package 2.1); Source Guides, notebook overviews, chat configuration, message feedback and follow-up suggestions (Package 2.2); notes with revisions and saved-response citations (Package 2.3); Studio artifacts/jobs (Package 2.4); and the poc-bridge in-memory notebook mirror. Data must survive API restart/redeploy, keep existing API contracts and behaviour unchanged, and use the drafts in packages/db/migrations/v3-draft/ as the starting schema."

## Source Traceability & Package Scope *(mandatory)*

This feature adds no new user-facing behaviour. It removes the v2.0 proof-of-concept deviation `DEV-04` / `D16`: every v2 record the four v2 packages already define as "persisted" is kept durably instead of in the memory of one API process. Every behaviour below is the existing, already-specified v2 behaviour (specs/005–008) with one change: it now also holds after an API restart or redeploy.

| SRS ID | Requirement Title | FR Card Anchor | Architecture Decisions / Deviations |
| :--- | :--- | :--- | :--- |
| `DEV-04` | v2 data in process memory until v3 (closed by this feature) | SRS §5.5, §5.6 | `D16` (amended), `D4` |
| `FR-WM-02` | Notebook icons (custom, topic, default) | `package_2_1_workspace_ui_comfort.md` | `D16` |
| `FR-WM-03` | Pins, last opened, notebook overview | `package_2_1_workspace_ui_comfort.md` | `D16` |
| `FR-UI-02` | Theme and language preferences (server side) | `package_2_1_workspace_ui_comfort.md` | `D16` |
| `FR-SI-02` | Source Guides per source, revision and language | `package_2_2_proactive_context_intelligence_chat_control.md` | `D16` |
| `FR-GC-04` | Notebook overview and starter prompts | `package_2_2_proactive_context_intelligence_chat_control.md` | `D16` |
| `FR-GC-05` | Follow-up suggestions per message | `package_2_2_proactive_context_intelligence_chat_control.md` | `D16` |
| `FR-GC-07` | Chat configuration per notebook and user | `package_2_2_proactive_context_intelligence_chat_control.md` | `D16` |
| `FR-GC-09` | Message feedback | `package_2_2_proactive_context_intelligence_chat_control.md` | `D16` |
| `FR-NM-01..04` | Notes, saved responses, revisions, note assistant | `package_2_3_notes_pinboard_lifecycle.md` | `D16` (note-sources already in PostgreSQL) |
| `FR-ST-10/11` | Studio report artifacts and their job lifecycle | `package_2_4_studio_text_synthesis_reports.md` | `D12`, `D16`, `C-03` |
| `FR-WM-01`, `FR-WM-04` | Notebook deletion cascade; owner-only access | `spec/requirements/v1/package_1_1_workspace_foundation.md` | `D16` |

- **Within-Release Prerequisites (`spec/requirements/README.md`)**: Completed v2 packages 2.1–2.4 (specs/005–008, merged). Must land before the v3 packages that read v2 data (3.3 Studio consumes the Studio artifact lifecycle).
- **Role Phasing (`FR-WM-04/05`, `NFR-SEC-02`)**: Owner-only (v1.0–v5.0). Stored records keep their owner so v6.0 roles can be added without reshaping them.
- **Data Residency (`D3`)**: `europe-west4` default; v2 data lives in the same managed database as v1 data. No exception.
- **Clarifications**: 2026-10-21 (owner): durability only; the single-API-instance constraint stays (FR-012).
- **Upstream Flow-Back Status (`CC-01`)**: On completion, `DEV-04` (SRS §5.5) is marked closed, the SRS §5.6 PoC note, `D16` in `docs/solution-architecture.md`, and the "v2.0 proof of concept" notes in the four v2 FR cards are amended to say v2 data is persisted (owner approval for these amendments: 2026-10-21).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Notes and Studio reports survive a restart (Priority: P1)

**SRS IDs**: `FR-NM-01`, `FR-NM-02`, `FR-NM-03`, `FR-ST-10`, `FR-ST-11`, `DEV-04`
**Actors**: Owner

An owner writes notes, saves chat answers as notes and generates Studio reports. The service is redeployed. When the owner reopens the notebook, every note (title, content, revision, order, saved-response citations) and every finished report is still there and behaves exactly as before.

**Why this priority**: Notes and reports are user-authored or expensive to regenerate; losing them on every deploy is the main reason the PoC is not usable beyond demos.

**Independent Test**: Create notes and a completed report through the API, restart the API process against the same database, and read them back unchanged.

**Acceptance Scenarios**:

1. **Given** a notebook with 3 manual notes and 1 saved-response note with 2 citations, **When** the API restarts, **Then** listing notes returns the same 4 notes with identical ids, titles, content, revisions, display order and citations (`FR-NM-01`, `FR-NM-02`).
2. **Given** a note at revision 3, **When** the API restarts and the owner saves an edit based on revision 3, **Then** the save succeeds as revision 4; an edit based on revision 2 is rejected as a revision conflict, as before (`FR-NM-01`).
3. **Given** a completed Briefing Doc report, **When** the API restarts, **Then** the report is listed with status `Completed`, the same content, citations and source revision snapshot (`FR-ST-10`).
4. **Given** a note already converted to a note-source, **When** the API restarts and the owner runs a note assistant action on the same unchanged note, **Then** the existing note-source is reused and no new source slot is used (`FR-NM-03`, `FR-NM-04`).

---

### User Story 2 - Workspace preferences and notebook metadata survive a restart (Priority: P2)

**SRS IDs**: `FR-WM-02`, `FR-WM-03`, `FR-UI-02`, `DEV-04`
**Actors**: Owner

An owner picks a custom emoji, pins notebooks, sets theme and languages, and opens notebooks. After a redeploy the notebook list shows the same icons, pins and "last opened" order, and the settings are unchanged.

**Why this priority**: Visible on every visit; losing it is irritating but no work is lost.

**Independent Test**: Set icon, pin, theme and languages through the API, restart, and read the notebook overview and preferences back.

**Acceptance Scenarios**:

1. **Given** a notebook with a custom emoji and another with a topic emoji, **When** the API restarts, **Then** both icons and their source (`custom`, `topic`) are unchanged, and a later first Ready source does not replace either (`FR-WM-02`).
2. **Given** a pinned notebook and a recorded last-opened time, **When** the API restarts, **Then** the overview lists the notebook as pinned and sorts by the same last-opened time; opening a notebook still does not change its content modified time (`FR-WM-03`).
3. **Given** theme `Dark mode`, user output language `de-DE` and a notebook output language `fr-FR`, **When** the API restarts, **Then** the preferences endpoints return the same values and the effective output language of that notebook is still `fr-FR` (`FR-UI-02`).
4. **Given** a notebook whose content changed (note edit, report finished) after its last v1 update, **When** the API restarts, **Then** the notebook's modified time still reflects that content change (`FR-WM-03`).

---

### User Story 3 - Source Guides, overviews, chat settings and feedback survive a restart (Priority: P2)

**SRS IDs**: `FR-SI-02`, `FR-GC-04`, `FR-GC-05`, `FR-GC-07`, `FR-GC-09`, `DEV-04`
**Actors**: Owner

Source Guides, the notebook overview with starter prompts, per-message follow-up suggestions, chat configuration (persona, goal, response length) and thumbs feedback are kept after a redeploy, so no model call is repeated just because the service restarted.

**Why this priority**: These records are regenerable, but regenerating them costs model calls and time, and settings/feedback are user input.

**Independent Test**: Produce a Ready guide, an overview, follow-ups, a chat configuration and feedback; restart; read them back without any new model call.

**Acceptance Scenarios**:

1. **Given** a `GuideReady` Source Guide for source A revision 1 in `en-US`, **When** the API restarts and the owner opens A, **Then** the same guide is returned and no generation is started (`FR-SI-02`).
2. **Given** a guide for revision 1, **When** source A gets revision 2, **Then** the revision 1 guide is not shown for revision 2, as before (`FR-SI-02`).
3. **Given** a chat configuration with a custom goal and response length `Longer`, **When** the API restarts, **Then** the next chat turn uses the same configuration (`FR-GC-07`).
4. **Given** thumbs-down feedback on an answer and its stored follow-ups, **When** the API restarts, **Then** the feedback state and the follow-ups for that message are returned unchanged (`FR-GC-05`, `FR-GC-09`).
5. **Given** a cached notebook overview, **When** the API restarts and the source set is unchanged, **Then** the cached overview is served without regeneration (`FR-GC-04`).

---

### User Story 4 - Interrupted background work is never left hanging (Priority: P3)

**SRS IDs**: `FR-SI-02`, `FR-ST-10`, `FR-ST-11`, `C-03`
**Actors**: Owner

If the service stops while a Studio report or a Source Guide is being generated, the owner never sees a job that spins forever after the restart.

**Why this priority**: Rare, but a stuck "generating" state cannot be cleared by the user today.

**Independent Test**: Leave a report `Running` and a guide `GuidePending` in the database, start the API, and observe the resulting states.

**Acceptance Scenarios**:

1. **Given** a report left `Queued` or `Running` by a stopped process, **When** the API starts again, **Then** within 2 minutes the report is `Failed` with an "interrupted" explanation and can be retried with a fresh explicitly scoped request; no partial payload is published (`FR-ST-10`, `C-03`).
2. **Given** a guide left `GuidePending` by a stopped process, **When** the API starts again, **Then** the guide is generated again for the same source, revision and language, or marked `GuideFailed` if generation is unavailable (`FR-SI-02`).

---

### Edge Cases *(mandatory)*

- **Notebook deletion (`FR-WM-01`)**: Deleting a notebook removes all of its v2 records (metadata, preferences, guides, overviews, configuration, feedback, follow-ups, notes, Studio artifacts) in the same deletion, so nothing of a deleted notebook can be read afterwards, including after a restart.
- **Cross-owner access (`FR-WM-04`)**: A v2 record is only ever returned to the owner of its notebook; requests for another owner's notebook keep returning the existing not-found/forbidden responses. Access is still decided from the v1 notebook ownership, never from a v2 record.
- **Concurrent writes (`FR-NM-01`, `FR-WM-02`)**: Two saves of the same note based on the same revision: exactly one succeeds, the other gets the existing revision conflict. Two first-Ready-source events for one notebook: at most one topic icon selection runs, and it never overrides a custom icon.
- **Saved-response uniqueness (`FR-NM-02`)**: Saving the same chat answer twice returns the existing saved note, never a duplicate.
- **Studio payload integrity (`FR-ST-10`, `C-03`)**: A Studio artifact has a payload if and only if it is `Completed`; its source revision snapshot is never empty.
- **Source change after capture (`FR-ST-10`, `C-02`)**: A report whose captured source was deleted before publishing still fails with the source-changed explanation; persistence does not allow a stale publish.
- **Existing data at upgrade (`DEV-04`)**: v2 data held in memory by the running PoC at the moment of the first deploy of this feature is not migrated; it is lost once more, as it is on every PoC deploy today.
- **Limits unchanged**: Existing v2 limits (note title and content limits, report and guide limits, chat configuration limits) are enforced exactly as before; storage never truncates a value that the API accepted.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (`DEV-04`)**: *(Ubiquitous)* The system MUST store every v2 record listed under Key Entities durably, so it is unchanged after an API restart or redeploy.
- **FR-002 (`DEV-04`)**: *(Ubiquitous)* All existing v2 API routes, request and response shapes, status codes, error codes and messages MUST stay unchanged; the existing v2 test suites (specs/005–008) MUST pass unchanged against the durable stores.
- **FR-003 (`FR-WM-02`, `FR-WM-03`, `FR-UI-02`)**: *(Ubiquitous)* The system MUST persist notebook icon and icon source, the topic-icon selection claim, the notebook content modified time set by v2 content changes, pins, last-opened times, owner workspace preferences (theme, input and output language) and notebook language defaults.
- **FR-004 (`FR-SI-02`, `FR-GC-04`, `FR-GC-05`, `FR-GC-07`, `FR-GC-09`)**: *(Ubiquitous)* The system MUST persist Source Guides keyed by notebook, source, revision and output language; notebook overviews keyed by their cache identity; chat configuration per notebook and user; message feedback and message follow-ups per notebook, user and message.
- **FR-005 (`FR-NM-01..04`)**: *(Ubiquitous)* The system MUST persist notes with title, Markdown content, origin type, source message, citations, origin note, revision, display order and timestamps.
- **FR-006 (`FR-ST-10`, `FR-ST-11`, `C-03`)**: *(Ubiquitous)* The system MUST persist Studio artifacts with their full lifecycle (`Queued`, `Running`, `Completed`, `Failed`, `Cancelled`), parameters, payload, source revision snapshot, output language, progress, failure, attempt and retry link.
- **FR-007 (`FR-WM-04`)**: *(Ubiquitous)* Notebook ownership, archive state and ready-source counts used by v2 features MUST be read from the v1 records; the in-process notebook mirror MUST be removed.
- **FR-008 (`FR-WM-01`)**: *(Event-driven)* When a notebook is deleted, the system MUST delete all of its v2 records together with it.
- **FR-009 (`FR-NM-01`, `FR-NM-02`, `FR-WM-02`)**: *(Unwanted)* If two requests change the same note revision, save the same answer as a note, or claim the topic icon of the same notebook at the same time, then the system MUST let exactly one succeed and answer the other with the existing conflict or reuse behaviour.
- **FR-010 (`FR-ST-10`, `FR-ST-11`, `C-03`)**: *(Event-driven)* When the API starts and finds Studio artifacts `Queued` or `Running` that no live process is working on, the system MUST mark them `Failed` with an interrupted explanation within 2 minutes, publishing no payload, and allow Retry as for any failed report.
- **FR-011 (`FR-SI-02`)**: *(Event-driven)* When the API starts and finds Source Guides `GuidePending` that no live process is working on, the system MUST generate them again or mark them `GuideFailed` when generation is unavailable.
- **FR-012 (`DEV-04`, `D16`)**: *(State-driven)* While the deployment runs exactly one API instance (unchanged from the PoC; owner decision 2026-10-21), the system MUST keep running v2 background work (Source Guides, topic icons, Studio reports) in the API process; making background work safe across several API instances is out of scope.
- **FR-013 (`DEV-04`)**: *(Ubiquitous)* The v2 schema MUST be added as ordered migrations after the latest existing migration, starting from the drafts in `packages/db/migrations/v3-draft/`, and the draft folder MUST be removed once its tables are migrated.

### Key Entities *(include if feature involves data)*

- **Notebook metadata** (`FR-WM-02`, `FR-WM-03`): per notebook; icon emoji, icon source (`default`/`topic`/`custom`), topic-selection claimed flag, v2 content modified time.
- **Owner workspace preferences** (`FR-UI-02`): per owner; theme, input language, output language.
- **Owner notebook preferences** (`FR-WM-03`, `FR-UI-02`): per owner and notebook; pinned flag, last opened time, notebook language settings.
- **Source Guide** (`FR-SI-02`): per notebook, source, revision and output language; status (`GuidePending`/`GuideReady`/`GuideFailed`), summary and topics; belongs to a v1 source.
- **Notebook overview** (`FR-GC-04`): per cache identity (notebook, source set and revisions, language) and owner; summary and starter prompts.
- **Chat configuration** (`FR-GC-07`): per notebook and user; persona/goal, response length.
- **Message feedback** (`FR-GC-09`) and **message follow-ups** (`FR-GC-05`): per notebook, user and chat message.
- **Note** (`FR-NM-01..04`): per notebook and owner; see FR-005. Note-sources stay v1 sources (already persisted).
- **Studio artifact** (`FR-ST-10`, `FR-ST-11`, `C-03`): per notebook and owner; see FR-006.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (`DEV-04`)**: After an API restart, 100% of v2 records created before the restart are returned unchanged (verified per entity type by restart tests).
- **SC-002 (`DEV-04`)**: 100% of the existing v2 automated tests (specs/005–008) pass against the durable stores without changing their assertions.
- **SC-003 (`FR-ST-10`, `FR-SI-02`)**: After a restart, 0 Studio reports or Source Guides remain in a generating state for more than 2 minutes without a live process working on them.
- **SC-004 (`FR-WM-01`)**: After deleting a notebook, 0 v2 records of that notebook can be read, before or after a restart.
- **SC-005 (`DEV-04`)**: User-visible response times of the v2 features stay within their existing targets (for example note auto-save within 1.0 s of a typing pause, `FR-NM-01`).

## Assumptions & Out of Scope

- **In-Scope Release Constraints**: The durable store is the existing managed relational database already used for v1 data (`D4`), in the same region (`D3`). Access control stays in the v1 path (authenticate, check notebook ownership) before any v2 handler.
- **Assumption — interrupted work**: Interrupted Studio reports fail (with Retry) rather than resume, because a report run is short and reports already have a Retry path; interrupted Source Guides are regenerated because guides are created automatically. (Default chosen; can be revisited in `/speckit-clarify`.)
- **Assumption — no data migration**: The PoC's in-memory data is not carried over (see Edge Cases).
- **Assumption — note-sources**: Note-sources and their provenance are already persisted (`0004_note_sources.sql`) and are not changed.
- **Out of Scope / Deferred**: Running more than one API instance (cross-instance claims for background work; with the v3 staging/prod setup); new v2 behaviour or limits; the region move to a Cloud Tasks region; staging/prod environments; multi-region; v6.0 roles and personal notebook overrides (`FR-UI-02` from v6.0); deferred Package 6.3 (`D5`/`DEV-03`).
