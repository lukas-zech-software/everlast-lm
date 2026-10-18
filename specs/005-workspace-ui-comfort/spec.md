# Feature Specification: Workspace & UI Comfort

**Feature Branch**: `005-workspace-ui-comfort`
**Created**: 2026-10-18
**Status**: Draft
**Package Source**: `spec/requirements/v2/package_2_1_workspace_ui_comfort.md`
**SRS IDs in Scope**: FR-WM-02, FR-WM-03, FR-UI-02
**Release & Gate**: v2.0 (contributes to, but does not independently satisfy, Gate v2.0)
**Input**: User description: "v2.0" — scoped to Package 2.1, the first v2.0 package, because the constitution requires one FR package per feature specification.

## Source Traceability & Package Scope *(mandatory)*

The normative scope below is transcribed from the SRS, Package 2.1 FR cards, and the binding cross-package rules. The other v2.0 packages (2.2–2.4) require separate feature specifications.

| SRS ID | Requirement Title | FR Card Anchor | Architecture Decisions / Deviations |
| :--- | :--- | :--- | :--- |
| FR-WM-02 | Metadata & Visual Organization | [Package 2.1](../../spec/requirements/v2/package_2_1_workspace_ui_comfort.md#fr-wm-02--metadata--visual-organization) | No deviation recorded |
| FR-WM-03 | Home Overview, Sorting & Pinning | [Package 2.1](../../spec/requirements/v2/package_2_1_workspace_ui_comfort.md#fr-wm-03--home-overview-sorting--pinning) | No deviation recorded |
| FR-UI-02 | Theme & Language Configuration | [Package 2.1](../../spec/requirements/v2/package_2_1_workspace_ui_comfort.md#fr-ui-02--theme--language-configuration) | D3 data residency; no package-specific region exception |

- **Within-Release Prerequisites (`spec/requirements/README.md`)**: FR-WM-02 depends on FR-WM-01 and FR-SI-01; FR-WM-03 depends on FR-WM-01 and FR-WM-02; FR-UI-02 depends on FR-UI-01. Package 2.1 language preferences precede language-sensitive generators. Packages 2.2 and 2.3 share a save-note contract; Package 2.4 defines C-03, and those packages are outside this feature.
- **Role Phasing (`FR-WM-04/05`, `NFR-SEC-02`)**: Owner-only in v2.0 (v1.0–v5.0); Editor, Viewer Full, and Viewer Chat-Only permissions are not active until v6.0.
- **Data Residency (`D3`)**: EU preferred, with `europe-west4` as the default; this package defines no region exception.
- **Upstream Flow-Back Status (`CC-01`)**: No clarifications or downstream refinements have been made; no upstream source changes are required for this transcription.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recognize and organize notebooks (Priority: P2)

**SRS IDs**: FR-WM-02, FR-WM-03  
**Actors**: Notebook Owner

As an owner managing multiple notebooks, I want recognizable notebook metadata and flexible overview controls, so that I can find and return to important work quickly.

**Why this priority**: Visual identification, sorting, and pinning make the notebook overview usable as the number of workspaces grows.

**Independent Test**: Create notebooks with known metadata, source states, and pin preferences; verify displayed fields, ordering, and view preference persistence against the scenarios below.

**Acceptance Scenarios**:

1. **Given** a notebook with the default icon `"📓"`, **When** the owner selects `"🧬"` in the emoji picker, **Then** the selected icon appears on the workspace header and home overview after navigating back (`FR-WM-02`).
2. **Given** a notebook showing `"2 sources"` on the home overview, **When** a new PDF reaches `Ready`, **Then** the source count becomes `"3 sources"` and the modified timestamp updates (`FR-WM-02`).
3. **Given** three notebooks where `"Beta"` is pinned and `"Alpha"` and `"Zeta"` are not, **When** the owner sorts by title, **Then** `"Beta"` appears first, followed by `"Alpha"` and `"Zeta"` (`FR-WM-03`).
4. **Given** the home overview in grid view, **When** the owner switches to list view and reloads the overview, **Then** list view remains selected (`FR-WM-03`).
5. **Given** the owner has no notebooks, **When** the home overview opens, **Then** it displays a `"Create your first notebook"` call to action and hides or disables sorting controls (`FR-WM-03`).
6. **Given** a new notebook with the default icon, **When** its first source reaches `Ready`, **Then** its icon updates to reflect the source topic unless the owner has already chosen a custom icon (`FR-WM-02`).
7. **Given** a notebook with two Ready sources, **When** another source fails ingestion, **Then** its displayed count remains `"2 sources"`; when a note or artifact is modified, **Then** the notebook's modified timestamp updates (`FR-WM-02`).
8. **Given** the owner selects List view, **When** the overview displays notebooks, **Then** each row shows the icon, title, Owner role, Ready-source count, and creation or modified date (`FR-WM-03`).
9. **Given** a changed sort order, **When** the owner reloads the overview, **Then** the selected sort order is retained (`FR-WM-03`).

### User Story 2 - Set display and language preferences (Priority: P2)

**SRS IDs**: FR-UI-02  
**Actors**: Notebook Owner

As an owner working across languages and display conditions, I want to choose a theme and input/output languages, so that the workspace is comfortable to use and generated responses match my preferred language.

**Why this priority**: Consistent display and language settings support everyday use across devices and source languages.

**Independent Test**: Change global and notebook preferences, reload or open another workspace, and verify theme, input handling, generated response language, and original-language citation quotations.

**Acceptance Scenarios**:

1. **Given** the workspace is open, **When** the owner selects Light, Dark, or System from Settings, **Then** the selected theme applies across panels without reloading and remains the chosen preference (`FR-UI-02`).
2. **Given** a notebook containing only an English source and its output language set to German (`de-DE`), **When** the owner asks a question, **Then** the response is in German and citations still identify the original English passages (`FR-UI-02`).
3. **Given** a citation hover contains a verbatim source quotation, **When** the response language differs from the source language, **Then** the quotation remains in the original source language (`FR-UI-02`, FR-GC-03).
4. **Given** input language is set to `auto`, **When** the owner provides typed or spoken input, **Then** the system detects the input language without translating stored source text (`FR-UI-02`).
5. **Given** no theme preference exists, **When** the owner opens Settings, **Then** System is selected by default; selecting Light or Dark applies the choice across panels without reloading (`FR-UI-02`).
6. **Given** the owner opens output-language settings, **When** the supported choices are displayed, **Then** at least 35 enterprise languages are available and account, browser, and `en-US` fallbacks are applied in that order when no explicit language is selected (`FR-UI-02`).

### Edge Cases *(mandatory)*

- **Invalid icon (`FR-WM-02`)**: A value that is not a single valid Unicode emoji grapheme cluster, including supported multi-code-point emoji sequences, is rejected; the existing icon remains unchanged.
- **Source state (`FR-WM-02`)**: A source that fails ingestion does not increase the displayed count of Ready sources. Adding, removing, or renaming a source, or modifying a note or artifact, updates the notebook's modified timestamp and source counter as applicable.
- **Notebook organization (`FR-WM-03`)**: With zero notebooks, the empty-state call to action is shown and sort controls are hidden or disabled. Pinned notebooks remain ahead of unpinned notebooks for each supported sort order.
- **Preference scope (`FR-WM-03`, FR-UI-02)**: Pinning belongs to the owner's notebook preference; changing one user's preference does not change another user's preference. In v2.0, the only active role is Owner.
- **Input language (`FR-UI-02`)**: `auto` detects input language but never translates stored source text.
- **Citation fidelity (`FR-UI-02`, FR-GC-03)**: Verbatim citation quotations remain in their original source language even when generated responses use another language.
- **Language precedence (`FR-UI-02`)**: An explicit job language takes precedence over a personal notebook override, notebook default, user default, supported browser locale, and finally `en-US`. If no configured or detected locale is supported, `en-US` is the fallback.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (FR-WM-02)**: The system MUST display each notebook's emoji/icon, title, creation date, last-modified date, and count of sources in `Ready` state on the home overview. The count MUST use the localized `"<n> sources"` or `"<n> Quellen"` label, and dates MUST use a readable localized format.
- **FR-002 (FR-WM-02)**: When a notebook is created, the system MUST assign the default `"📓"` icon and MUST update it to reflect the first uploaded source's topic unless the owner has manually selected an icon.
- **FR-003 (FR-WM-02)**: The owner MUST be able to select a single valid Unicode emoji grapheme cluster, including multi-code-point emoji sequences, from the icon picker on a notebook card or workspace header; the choice MUST be saved immediately. Invalid non-emoji input MUST be rejected without changing the current icon.
- **FR-004 (FR-WM-02)**: When a source is added, removed, or renamed, or a note or artifact is modified, the system MUST update the notebook's last-modified timestamp and keep its displayed Ready-source count current.
- **FR-005 (FR-WM-03)**: The home overview MUST offer Grid and List views and sort choices for Most recently opened, Title (A–Z), and Created date (newest first). Most recently opened MUST sort by the owner's last-opened time and use creation time for a notebook that has never been opened. The default view MUST be Grid and the default sort MUST be Most recently opened.
- **FR-006 (FR-WM-03)**: In List view, the system MUST display the notebook icon, title, current role, Ready-source count, and creation or modified date. In v2.0, the displayed role is Owner.
- **FR-007 (FR-WM-03)**: The owner MUST be able to pin or unpin a notebook using its pin control or card menu. Pinned notebooks MUST remain before unpinned notebooks in the overview regardless of selected sort order; pin preference MUST be per user and notebook and default to unpinned.
- **FR-008 (FR-WM-03)**: When the owner changes view mode or sort order, the overview MUST update immediately and retain the view and sort preferences for subsequent visits.
- **FR-009 (FR-WM-03)**: When the owner has no notebooks, the overview MUST display `"Create your first notebook"` and hide or disable sort controls.
- **FR-010 (FR-UI-02)**: The owner MUST be able to select Light, Dark, or System theme. The default MUST be System. The selected theme MUST apply across all workspace panels without a page reload and persist as the owner's preference.
- **FR-011 (FR-UI-02)**: The system MUST support global and notebook-level input-language preferences using BCP-47 language tags. Input language MUST default to `auto`; automatic detection MUST NOT translate stored source text. Spoken input uses the configured preference wherever spoken-input functionality is available.
- **FR-012 (FR-UI-02)**: The system MUST support global and notebook-level output-language preferences using BCP-47 language tags and at least 35 supported enterprise languages. In the absence of an explicit preference, the default MUST resolve from the account/user locale, then supported browser locale, then `en-US`.
- **FR-013 (FR-UI-02)**: Chat, Source Guide, Note Assistant, and Studio synthesis responses MUST use the effective output language regardless of the language of source documents. The effective preference MUST follow this precedence: explicit job language, personal notebook override, notebook default, user default, supported browser locale, then `en-US`.
- **FR-014 (FR-UI-02, FR-GC-03)**: Verbatim quotations shown in citation previews MUST remain in the original source language.
- **FR-015 (FR-WM-02, FR-WM-03, FR-UI-02)**: During v2.0, these capabilities MUST be available to the notebook Owner only. Editor and Viewer permissions and their personal notebook-level overrides MUST remain deferred until v6.0.

### Key Entities

- **Notebook** (`FR-WM-02`, `FR-WM-03`): A workspace with an icon, title, creation and modification dates, and a count of Ready sources.
- **Owner notebook preference** (`FR-WM-03`, `FR-UI-02`): The owner's per-notebook pin state and language overrides.
- **Owner display preference** (`FR-WM-03`, `FR-UI-02`): The owner's selected overview view, sort order, and theme.
- **Language preference** (`FR-UI-02`): A BCP-47 input or output language setting at user or notebook scope, including `auto` input detection and the defined output-language precedence.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (FR-WM-02)**: Notebook metadata and Ready-source counts are current on the home overview within 200 ms of navigation.
- **SC-002 (FR-WM-03)**: Sorting and switching view modes for up to 500 notebooks completes within 100 ms.
- **SC-003 (FR-UI-02)**: Theme changes apply across all panels within 50 ms, without a visible flash of the previous theme.
- **SC-004 (FR-UI-02)**: At least 35 enterprise languages are available as output-language choices.
- **SC-005 (FR-WM-02, FR-WM-03, FR-UI-02)**: In scripted acceptance testing, 100% of notebook identification, view/sort/pin, and theme/language preference tasks produce the expected visible outcomes defined in the acceptance scenarios.

## Assumptions & Out of Scope

- **In-Scope Release Constraints**: This feature covers only Package 2.1 (FR-WM-02, FR-WM-03, FR-UI-02). v2.0 role permissions remain Owner-only. Language preferences are established before language-sensitive generators in Package 2.2; this specification does not claim to implement those generators.
- **Out of Scope / Deferred**: Source Guide, notebook overview and chat controls, notes and note-to-source conversion, Studio reports, and C-03 (Packages 2.2–2.4); multi-user sharing badges and analytics (v6.0); nested notebook folders; custom raster or SVG notebook cover images; translation of raw source documents in the Source Inspector; and role permissions or notebook preference overrides for non-owners before v6.0.
