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
| FR-WM-02 | Metadata & Visual Organization | [Package 2.1](../../spec/requirements/v2/package_2_1_workspace_ui_comfort.md#fr-wm-02--metadata--visual-organization) | Solution Architecture §2.1 Flash-Lite topic-icon routing; D3 residency; no deviation |
| FR-WM-03 | Home Overview, Sorting & Pinning | [Package 2.1](../../spec/requirements/v2/package_2_1_workspace_ui_comfort.md#fr-wm-03--home-overview-sorting--pinning) | No deviation recorded |
| FR-UI-02 | Theme & Language Configuration | [Package 2.1](../../spec/requirements/v2/package_2_1_workspace_ui_comfort.md#fr-ui-02--theme--language-configuration) | D3 data residency; no package-specific region exception |
| FR-GC-03 | Citation fidelity constraint | [SRS](../../spec/System_Requirements_Specification_Gemeni_Notebook.md) | Preserve original-language citation quotations; no generation-scope expansion |

- **Within-Release Prerequisites (`spec/requirements/README.md`)**: FR-WM-02 depends on FR-WM-01 and FR-SI-01; FR-WM-03 depends on FR-WM-01 and FR-WM-02; FR-UI-02 depends on FR-UI-01. Package 2.1 language preferences precede language-sensitive generators. Packages 2.2 and 2.3 share a save-note contract; Package 2.4 defines C-03, and those packages are outside this feature.
- **Role Phasing (`FR-WM-04/05`, `NFR-SEC-02`)**: Owner-only in v2.0 (v1.0–v5.0); Editor, Viewer Full, and Viewer Chat-Only permissions are not active until v6.0.
- **Data Residency (`D3`)**: EU preferred, with `europe-west4` as the default; this package defines no region exception.
- **v2.0 Proof of Concept (`D16`, SRS §5.5 `DEV-04`)**: v2 data lives in API process memory until v3. "Persisted" in this specification means kept by the running API; "across sessions" and "after reload" in scenarios mean within one running API instance. View mode and sort order are kept only in the browser's `localStorage` and therefore survive reloads in the same browser. Access control, sources and chat stay in PostgreSQL.
- **Upstream Flow-Back Status (`CC-01`)**: Plan/analyze refinement: list rows show both creation and modified dates; the supported output-language list and Flash-Lite topic-icon selection/failure behavior are fixed in the Package 2.1 card and this specification. Convergence (2026-10-20) flowed the revised Package 2.1 card (PR #127) into this specification: SC-002 is measured at 100 notebooks, view mode and sort order are browser-local, Title sort uses `Intl.Collator` with a `created_at` tie-break, theme is kept locally and on the server, the input language is the question language for typed input, and personal per-notebook language overrides start in v6.0.

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
4. **Given** the home overview in grid view, **When** the owner switches to list view and reloads the overview in the same browser, **Then** list view remains selected; the choice is kept in that browser's `localStorage` only (`FR-WM-03`).
5. **Given** the owner has no notebooks, **When** the home overview opens, **Then** it displays a `"Create your first notebook"` call to action and hides or disables sorting controls (`FR-WM-03`).
6. **Given** a new notebook with the default icon, **When** its first source reaches `Ready`, **Then** the approved Flash-Lite selector chooses a topic icon unless the owner has already chosen a custom icon; selector failure leaves the existing icon and source Ready (`FR-WM-02`, Solution Architecture §2.1, D3).
7. **Given** a notebook with two Ready sources, **When** another source fails ingestion, **Then** its displayed count remains `"2 sources"`; when a note or artifact is modified, **Then** the notebook's modified timestamp updates (`FR-WM-02`).
8. **Given** the owner selects List view, **When** the overview displays notebooks, **Then** each row shows the icon, title, Ready-source count, creation date, and last-modified date; the Role column is a v6.0 item and v2.0 shows `Owner` (`FR-WM-03`).
9. **Given** a changed sort order, **When** the owner reloads the overview in the same browser, **Then** the selected sort order is retained from `localStorage`; no server copy exists and the server list defaults to `recent` (`FR-WM-03`).

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
4. **Given** input language is set to `auto`, **When** the owner types a question, **Then** the chat model detects the question language without translating stored source text; with a configured BCP-47 tag, that tag is passed to the chat model as the language of the question. v2.0 has typed input only; spoken input arrives in v5.0 (`FR-UI-02`).
5. **Given** no theme preference exists, **When** the owner opens Settings, **Then** System is selected by default; selecting Light or Dark applies the choice across panels without reloading (`FR-UI-02`).
6. **Given** the owner opens output-language settings, **When** the supported choices are displayed, **Then** exactly the 40 versioned enterprise locales are available, and with no saved user output language the selection shows the supported browser locale, or `en-US` when the browser locale is unsupported; the effective language follows explicit job, personal notebook override (from v6.0), notebook language, user default, supported browser locale, and `en-US` fallback in that order (`FR-UI-02`).

### Edge Cases *(mandatory)*

- **Invalid icon (`FR-WM-02`)**: A value that is not a single valid Unicode emoji grapheme cluster, including supported multi-code-point emoji sequences, is rejected; the existing icon remains unchanged.
- **Source state (`FR-WM-02`)**: A source that fails ingestion does not increase the displayed count of Ready sources. Adding, removing, or renaming a source, or modifying a note or artifact, updates the notebook's modified timestamp and source counter as applicable.
- **Notebook organization (`FR-WM-03`)**: With zero notebooks, the empty-state call to action is shown and sort controls are hidden or disabled. Pinned notebooks remain ahead of unpinned notebooks for each supported sort order. Title sort is case-insensitive using `Intl.Collator` for the UI locale; equal titles sort by `created_at` descending.
- **Preference scope (`FR-WM-03`, FR-UI-02)**: Pinning belongs to the owner's notebook preference; changing one user's preference does not change another user's preference. View mode and sort order are per browser (`localStorage`); another browser starts at `grid`/`recent`. Theme is kept in `localStorage` and in the user's server-side preferences; a server value loaded after first paint replaces the local one. In v2.0, the only active role is Owner.
- **Input language (`FR-UI-02`)**: `auto` lets the chat model detect the question language; stored source text is never translated. v2.0 has typed input only.
- **Citation fidelity (`FR-UI-02`, FR-GC-03)**: Verbatim citation quotations remain in their original source language even when generated responses use another language.
- **Language precedence (`FR-UI-02`)**: An explicit job language takes precedence over a personal notebook override (from v6.0), the notebook language, user default, supported browser locale, and finally `en-US`. If no configured or detected locale is supported, `en-US` is the fallback. In v1.0–v5.0 the notebook preferences API rejects personal override fields with `400`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (FR-WM-02)**: The system MUST display each notebook's emoji/icon, title, creation date, last-modified date, and count of sources in `Ready` state on the home overview. The count MUST use the localized `"<n> sources"` or `"<n> Quellen"` label, and dates MUST use a readable localized format.
- **FR-002 (FR-WM-02)**: When a notebook is created, the system MUST assign the default "📓" icon and use the approved enterprise Flash-Lite topic-emoji selector (Solution Architecture §2.1, D3), based on the title of the first source to reach `Ready`, to update the icon unless the owner has manually selected an icon. Selector failure MUST NOT fail ingestion and MUST leave the current icon unchanged.
- **FR-003 (FR-WM-02)**: The owner MUST be able to select a single valid Unicode emoji grapheme cluster, including multi-code-point emoji sequences, from the icon picker on a notebook card or workspace header; the choice MUST be saved immediately. Invalid non-emoji input MUST be rejected without changing the current icon.
- **FR-004 (FR-WM-02)**: When a source is added, removed, or renamed, or a note or artifact is modified, the system MUST update the notebook's last-modified timestamp and keep its displayed Ready-source count current.
- **FR-005 (FR-WM-03)**: The home overview MUST offer Grid and List views and sort choices for Most recently opened, Title (A–Z), and Created date (newest first). Most recently opened MUST sort by the owner's last-opened time and use creation time for a notebook that has never been opened. Title MUST sort case-insensitively using `Intl.Collator` for the UI locale, with equal titles ordered by `created_at` descending. The default view MUST be Grid and the default sort MUST be Most recently opened.
- **FR-006 (FR-WM-03)**: In List view, the system MUST display the notebook icon, title, Ready-source count, creation date, and last-modified date. The Role column is a v6.0 item; in v2.0 the row shows `Owner`.
- **FR-007 (FR-WM-03)**: The owner MUST be able to pin or unpin a notebook using its pin control or card menu. Pinned notebooks MUST remain before unpinned notebooks in the overview regardless of selected sort order; pin preference MUST be per user and notebook and default to unpinned.
- **FR-008 (FR-WM-03)**: When the owner changes view mode or sort order, the overview MUST update immediately and persist the view mode and sort order only in the browser's `localStorage` (per browser, no server copy). The server-side preference API MUST NOT accept or return `view_mode` or `sort_order`, and `GET /api/notebooks` without `sort_order` MUST use the default `recent`.
- **FR-009 (FR-WM-03)**: When the owner has no notebooks, the overview MUST display `"Create your first notebook"` and hide or disable sort controls.
- **FR-010 (FR-UI-02)**: The owner MUST be able to select Light, Dark, or System theme. The default MUST be System, which follows the operating system/browser `prefers-color-scheme`. The selected theme MUST apply across all workspace panels without a page reload and be applied before first visible paint to avoid a flash of the previous theme. The theme MUST be kept in `localStorage` (read before first paint) and in the user's server-side preferences; a server value loaded after first paint MUST replace the local one and be written to `localStorage`, so the next load paints the server theme.
- **FR-011 (FR-UI-02)**: The system MUST support global and notebook-level input-language preferences using BCP-47 language tags. The effective input-language tag MUST be passed to the chat model as the language of the user's question; `auto` (the default) lets the model detect it. Stored source text MUST NOT be translated. v2.0 has typed input only; spoken input arrives in v5.0. In v1.0–v5.0 the Owner sets the notebook language.
- **FR-012 (FR-UI-02)**: The system MUST support global and notebook-level output-language preferences using BCP-47 language tags and the following 40 supported enterprise locales: `ar-SA`, `bg-BG`, `bn-BD`, `cs-CZ`, `da-DK`, `de-DE`, `el-GR`, `en-US`, `es-ES`, `et-EE`, `fa-IR`, `fi-FI`, `fr-FR`, `he-IL`, `hi-IN`, `hr-HR`, `hu-HU`, `id-ID`, `it-IT`, `ja-JP`, `ko-KR`, `lt-LT`, `lv-LV`, `ms-MY`, `nl-NL`, `no-NO`, `pl-PL`, `pt-BR`, `ro-RO`, `ru-RU`, `sk-SK`, `sl-SI`, `sv-SE`, `th-TH`, `tr-TR`, `uk-UA`, `ur-PK`, `vi-VN`, `zh-CN`, and `zh-TW`. When no notebook/job-specific value applies, the default MUST resolve from the user default, then the supported browser locale, then `en-US`; there is no fixed German default. The settings display and the workspace's effective output language MUST use that resolved supported tag, never a raw unsupported browser locale. Notebook and job precedence is defined by FR-013. The list is versioned with the contract and only these supported locales are offered.
- **FR-013 (FR-UI-02)**: Chat, Source Guide, Note Assistant, and Studio synthesis responses MUST use the effective output language regardless of the language of source documents. The effective preference MUST follow this precedence: explicit job language, personal notebook override (from v6.0), notebook language, user default, supported browser locale, then `en-US`. In v1.0–v5.0 the personal-override slot stays unused: the notebook preferences API MUST reject `input_language_override` and `output_language_override` with `400`, and the Owner sets the notebook language through `notebook_input_language`/`notebook_output_language`. Source Guides are stored per (source, revision, language); that rule is owned by [`specs/006-source-guide-chat-control`](../006-source-guide-chat-control/spec.md).
- **FR-014 (FR-UI-02, FR-GC-03)**: Verbatim quotations shown in citation previews MUST remain in the original source language.
- **FR-015 (FR-WM-02, FR-WM-03, FR-UI-02)**: During v2.0, these capabilities MUST be available to the notebook Owner only. Editor and Viewer permissions, the List-view Role column, and personal per-notebook language overrides (for every role) MUST remain deferred until v6.0; from v6.0 the notebook language becomes a default that only Owner/Editor can change.

### Key Entities

- **Notebook** (`FR-WM-02`, `FR-WM-03`): A workspace with an icon, title, creation and modification dates, and a count of Ready sources.
- **Owner notebook preference** (`FR-WM-03`, `FR-UI-02`): The owner's per-notebook pin state, last-opened time, and the notebook input/output language set by the Owner. Personal per-notebook overrides start in v6.0.
- **Owner display preference** (`FR-UI-02`): The owner's theme and global input/output language, kept server-side (in API memory under D16); the theme is also kept in `localStorage`.
- **Browser overview preference** (`FR-WM-03`): View mode and sort order, kept only in the browser's `localStorage`.
- **Language preference** (`FR-UI-02`): A BCP-47 input or output language setting at user or notebook scope, including `auto` input detection and the defined output-language precedence.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (FR-WM-02)**: Notebook metadata and Ready-source counts are current on the home overview within 200 ms of navigation, measured from the successful notebook-list response to visible metadata in the supported Chromium browser test run.
- **SC-002 (FR-WM-03)**: Client sorting and switching view modes for 100 notebooks (the v1–v5 per-user notebook limit, SRS §5.6) completes within 100 ms, measured with `performance.now()` in the supported Chromium browser test run.
- **SC-003 (FR-UI-02)**: Theme changes apply across all panels within 50 ms in the supported Chromium browser test run; initial theme is applied before first visible paint, with no visible flash of the prior theme.
- **SC-004 (FR-UI-02)**: Exactly 40 versioned enterprise locales are available as output-language choices.
- **SC-005 (FR-WM-02, FR-WM-03, FR-UI-02)**: In scripted acceptance testing, 100% of notebook identification, view/sort/pin, and theme/language preference tasks produce the expected visible outcomes defined in the acceptance scenarios.

## Assumptions & Out of Scope

- **In-Scope Release Constraints**: This feature covers only Package 2.1 (FR-WM-02, FR-WM-03, FR-UI-02). v2.0 role permissions remain Owner-only. Language preferences are established before language-sensitive generators in Package 2.2; this specification does not claim to implement those generators.
- **Out of Scope / Deferred**: Source Guide, notebook overview and chat controls, notes and note-to-source conversion, Studio reports, and C-03 (Packages 2.2–2.4); multi-user sharing badges and analytics (v6.0); nested notebook folders; custom raster or SVG notebook cover images; translation of raw source documents in the Source Inspector; and role permissions or notebook preference overrides for non-owners before v6.0.
