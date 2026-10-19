# Package 2.1 — Workspace & UI Comfort

- **Release:** v2.0
- **Goal:** Enrich the notebook home overview and workspace UI with visual metadata (custom emoji/icon, timestamps, source counters), grid/list view switching, sorting, pinning, dark/light theme support, and output language configuration.
- **FRs:** FR-WM-02, FR-WM-03, FR-UI-02
- **Gate criteria (SRS §5.4):** No direct Gate v2.0 item; metadata, theme and language acceptance tests support the integrated v2 release, but do not substitute for Gate v2.0 #1–3.
- **v2.0 proof of concept (D16, SRS §5.5 DEV-04):** v2 data lives in API process memory until v3. "Persisted" in this package means kept by the running API; "across sessions" and "after reload" in scenarios mean within one running API instance. Access control, sources and chat stay in PostgreSQL.
- **Out of scope:** Multi-user sharing badges and analytics (`v6.0` — `FR-WM-05`, `FR-WM-06`).

**Cross-package rules:** [Binding scope, roles, lifecycle, quotas and validation](../README.md#binding-cross-package-rules).

---

### FR-WM-02 — Metadata & Visual Organization

| Field | Value |
| :- | :- |
| Release / Package | v2.0 / 2.1 |
| Priority (within package) | P2 |
| Actors | Owner; Editor, Viewer read-only (from v6.0) |
| Depends on | FR-WM-01, FR-SI-01 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Ubiquitous:* The system shall assign and display for every notebook an emoji/icon, title, creation/last-modified timestamp, and current count of `Ready` sources (`"<n> sources"` / `"<n> Quellen"`).
- *Event:* When a new notebook is created, the system shall assign a default emoji icon and use the approved enterprise Flash-Lite topic-emoji selector (Solution Architecture §2.1 model-routing table; D3), based on the title of the first source to reach `Ready`, to update the icon (unless manually overridden by the owner). Selector failure does not fail ingestion and leaves the current icon unchanged.
- *Event:* When the Owner/Editor clicks the emoji icon on the notebook card or in the workspace header and selects a new emoji from the picker, the system shall persist the chosen emoji immediately.
- *Event:* When a source is added, removed, or renamed, or a note/artifact is modified, the system shall update the notebook's `updated_at` timestamp and source counter.

**User story:** As a knowledge worker managing dozens of notebooks, I want each notebook to display an expressive emoji icon, its source count, and its last modified date, so that I can visually scan and recognize my projects at a glance.

**Reference behaviour**
1. Each notebook card on the home screen shows a large emoji in the top-left corner, the notebook title, the date of last modification (or creation), and `"<n> sources"`.
2. Clicking the emoji inside the notebook header opens an emoji picker popover.
3. Selecting an emoji updates the header and the home screen card immediately.

Evidence: `https://support.google.com/notebooklm/answer/16164461`, `SRS §3.1 FR-WM-02` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Emoji icon | Unicode Emoji string | Single valid Unicode emoji grapheme cluster (including multi-code-point ZWJ and skin-tone sequences) | "📓" (Flash-Lite topic selection after first source reaches Ready, unless custom) |
| Source count | Integer | $0 \le n \le N_{\text{max}}$ | $0$ |

**Outputs & state**
- Visible: Emoji, title, formatted date (e.g., `"Oct 15, 2026"`), and `"<n> sources"` on home cards and list rows.
- Persisted: `icon_emoji`, `icon_source` (`default` / `topic` / `custom`), `created_at`, and `updated_at` on the `Notebook` entity. `ready_source_count` is derived from sources in `Ready` state.
- States: `DefaultIcon` $\rightarrow$ `AutoTopicIcon` $\rightarrow$ `CustomUserIcon`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Custom emoji selection persists across sessions
  Given an existing notebook with default icon "📓"
  When the owner clicks the notebook icon and selects "🧬" from the emoji picker
  And navigates back to the home overview
  Then the notebook card displays the "🧬" icon

Scenario: Adding a source increments the card source counter
  Given a notebook showing "2 sources" on the home overview
  When the owner uploads a new PDF that reaches state "Ready"
  Then the notebook metadata displays "3 sources" and updates the modified timestamp
```

**Edge & error cases**
- Non-emoji characters submitted to the icon API endpoint $\rightarrow$ Rejected with HTTP `400 Bad Request`.
- Source fails ingestion (`Failed` state) $\rightarrow$ Does not increment the `Ready` source counter shown on the card.

**Measurable criteria**
- Metadata updates reflect on the home overview within $\le 200\text{ ms}$ from the successful notebook-list response to visible metadata in the supported Chromium browser test run.

**Deviations from reference:** None.

**Out of scope:** Uploading custom raster/SVG image files as notebook cover backgrounds.

**Open questions:** `None`

---

### FR-WM-03 — Home Overview, Sorting & Pinning

| Field | Value |
| :- | :- |
| Release / Package | v2.0 / 2.1 |
| Priority (within package) | P2 |
| Actors | Owner; Editor, Viewer (from v6.0) |
| Depends on | FR-WM-01, FR-WM-02 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Ubiquitous:* The home overview shall provide a toggle between a **Grid View** (cards) and a **List View** (tabular rows) and a sort dropdown offering `Most recently opened` (`Zuletzt geöffnet`; per-user `last_opened_at` descending, falling back to `created_at` for unopened notebooks), `Title` (`Titel A–Z`), and `Created date` (`Erstellungsdatum`).
- *Event:* When the user clicks the pin icon (or selects `"Pin"` from the card menu) on a notebook, the system shall mark the notebook as pinned for that user and keep pinned notebooks anchored at the top of the overview ahead of unpinned notebooks.
- *Event:* When the user switches between Grid View and List View or changes the sort order, the system shall re-render the list immediately and persist view mode and sort order in the browser's `localStorage`.

**User story:** As a power user with many notebooks, I want to switch between grid and list views, sort by recency or title, and pin my active priority notebooks to the top, so that I can reach important workspaces immediately.

**Reference behaviour**
1. Top-right of the home screen shows a view-switcher button group (Grid icon | List icon) and a sort dropdown defaulting to `Most recent`.
2. Clicking List View switches the cards into a compact table showing Icon, Title, Role (from v6.0), Ready-source count, creation date, and last-modified date.
3. Selecting `Title` sorts notebooks alphabetically.

Evidence: `https://support.google.com/notebooklm/answer/16164461`, `SRS §3.1 FR-WM-03` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| View mode | Enum | `grid` \| `list` | `grid` |
| Sort order | Enum | `recent` \| `title_asc` \| `created_desc` | `recent` |
| `is_pinned` | Boolean | Per user-notebook association | `false` |

**Outputs & state**
- Visible: Grid cards or tabular list rows; active pin badge on pinned notebooks.
- Persisted: `is_pinned` and `last_opened_at` in database (`UserNotebookPreference`); opening a notebook does not change its content `updated_at`; view mode and sort order in `localStorage` (per browser).
- States: `Unpinned` $\leftrightarrow$ `Pinned`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Pinned notebooks remain at the top regardless of sort order
  Given 3 notebooks: "Alpha" (unpinned), "Beta" (pinned), and "Zeta" (unpinned)
  When the user sorts the home overview by "Title"
  Then "Beta" appears first in the list, followed by "Alpha" and "Zeta"

Scenario: Switching between Grid and List view persists across page reloads
  Given the user is on the home overview in "grid" view
  When the user clicks the "List view" toggle and reloads the browser
  Then the home overview renders in "list" view
```

**Edge & error cases**
- User has $0$ notebooks $\rightarrow$ Overview displays an empty-state call-to-action (`"Create your first notebook"`) and hides/disables sort controls.
- `Title` sort is case-insensitive using `Intl.Collator` for the UI locale; equal titles sort by `created_at` descending.

**Measurable criteria**
- Sorting and view-mode toggling up to $100$ notebooks (the v1–v5 per-user notebook limit, SRS §5.6) completes client-side in $\le 100\text{ ms}$.

**Deviations from reference:** Explicit pinning is included as a first-class feature (`FR-WM-03`) in addition to the reference's sort-by-recency/title controls.

**Out of scope:** Nested folder hierarchies for notebooks.

**Open questions:** `None`

---

### FR-UI-02 — Theme & Language Configuration

| Field | Value |
| :- | :- |
| Release / Package | v2.0 / 2.1 |
| Priority (within package) | P2 |
| Actors | Owner; Editor, Viewer, Chat-only (from v6.0) |
| Depends on | FR-UI-01 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the user selects `Light mode`, `Dark mode`, or `System` (`Device default`) from the top-right Settings menu, the system shall apply the selected color theme across all panels without reloading the page and persist the preference in `localStorage` and in the user's server-side preferences. `System` shall follow the operating system/browser `prefers-color-scheme`; the initial theme shall be set before first visible paint.
- *Event:* When a user configures input language globally or for a notebook, the system shall pass that BCP-47 tag to the chat model as the language of the user's question (v2 has typed input only; spoken input arrives in v5); `auto` lets the model detect it. Stored source text is never translated. In v1–v5 the Owner sets the notebook language. From v6.0 it becomes a notebook default that only Owner/Editor can change, and each user may set a personal per-notebook override.
- *Event:* When the user selects an `Output language` (`Ausgabesprache`) in the global or notebook-level settings, the system shall instruct all chat, Source Guide, Note Assistant, and Studio synthesis agents to generate their responses in that target language, regardless of the language of the uploaded source documents. Source Guides are generated at `Ready` in the notebook's effective output language and stored per (source, revision, language); opening the Source Inspector with a different effective output language generates that language's guide on demand.

**User story:** As an international enterprise user, I want to toggle Dark/Light mode and set the output language of my notebook, so that I can read foreign-language sources and receive summaries, chats, and reports in my preferred working language.

**Reference behaviour**
1. User clicks the Settings gear icon in the top-right header.
2. Menu offers `Output language` (modal with dropdown of supported languages, defaulting to browser/account language) and theme toggle (`Light` / `Dark` / `Device`).
3. Selecting `Deutsch` while querying English PDF sources produces German chat responses and German Studio artifacts with citations pointing back to the English chunks.

Evidence: `https://support.google.com/notebooklm/answer/16164461`, `SRS §3.6 FR-UI-02` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Theme preference | Enum | `light` \| `dark` \| `system` | `system` |
| Output language | BCP-47 language tag | Versioned supported set: `ar-SA`, `bg-BG`, `bn-BD`, `cs-CZ`, `da-DK`, `de-DE`, `el-GR`, `en-US`, `es-ES`, `et-EE`, `fa-IR`, `fi-FI`, `fr-FR`, `he-IL`, `hi-IN`, `hr-HR`, `hu-HU`, `id-ID`, `it-IT`, `ja-JP`, `ko-KR`, `lt-LT`, `lv-LV`, `ms-MY`, `nl-NL`, `no-NO`, `pl-PL`, `pt-BR`, `ro-RO`, `ru-RU`, `sk-SK`, `sl-SI`, `sv-SE`, `th-TH`, `tr-TR`, `uk-UA`, `ur-PK`, `vi-VN`, `zh-CN`, `zh-TW` (exactly 40) | User default, then supported browser locale, then `en-US`; no fixed German default |

**Outputs & state**
- Visible: Immediate CSS theme switch; generated AI text appears in the configured target language.
- Persisted: `theme` in `localStorage` (read before first paint) and in the user's server-side preferences; a server value loaded after first paint replaces the local one; `input_language` and `output_language` on `User`, with notebook defaults and personal per-notebook overrides. Effective precedence: explicit job language > personal notebook override (from v6.0) > notebook language > user default > supported browser locale > `en-US`; input defaults to `auto`.
- States: `LightTheme` $\leftrightarrow$ `DarkTheme` $\leftrightarrow$ `SystemTheme`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Cross-lingual grounded chat respects configured output language
  Given a notebook containing an English-only source "Annual_Report_2025.pdf"
  And the user sets the notebook output language to "Deutsch (de-DE)"
  When the user asks a question in the chat
  Then the assistant responds in German
  And inline citations [1] still link to the original English passages in "Annual_Report_2025.pdf"
```

**Edge & error cases**
- Verbatim quote snippet inside citation hover tooltip (`FR-GC-03`) $\rightarrow$ Remains in the **original source language** so that exact document verification is never altered by translation.

**Measurable criteria**
- Theme switch completes in $\le 50\text{ ms}$ without flash of unstyled content (FOUC); initial theme is applied before first visible paint and System follows the OS/browser `prefers-color-scheme`.

**Deviations from reference:** Allows per-notebook language override in addition to the global user language setting.

**Out of scope:** Full automatic translation of the raw source document inside the Source Inspector (`FR-SI-04`).

**Open questions:** `None`
