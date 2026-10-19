# Data Model: Workspace & UI Comfort

SRS scope: `FR-WM-02`, `FR-WM-03`, `FR-UI-02`, `FR-GC-03`. This package extends the existing Notebook and owner-preference concepts; it does not alter C-01/C-02/C-03 or source selection.

## Notebook metadata (`FR-WM-02`)

| Field | Type | Validation / behavior |
|---|---|---|
| `id` | UUID | Existing notebook identity. |
| `owner_id` | string | Existing owner identity; all mutations are owner-authorized. |
| `title` | string | Existing title and validation. |
| `icon_emoji` | string | Exactly one valid Unicode emoji grapheme cluster; default `📓`. |
| `icon_source` | `default \| topic \| custom` | Default transitions to topic after the first Ready source when the enterprise Flash-Lite selector returns a valid emoji; selector failure leaves the current icon unchanged; custom is sticky and never overwritten by later ingestion. |
| `created_at` | ISO timestamp | Existing creation time. |
| `updated_at` | ISO timestamp | Changes on source add/remove/rename, note/artifact modification, title or icon mutation as specified; common mutation writers call `touchNotebookModified()`. |
| `ready_source_count` | nonnegative integer | Derived from sources in `Ready`; not incremented by failed/in-flight sources. |

Relationships: Notebook has 0..N sources; only Ready sources contribute to `ready_source_count`. A source-ready event may supply an optional topic emoji suggestion. No source text is read for UI metadata.

## Owner display preference (`FR-WM-03`, `FR-UI-02`)

| Field | Type | Default / scope |
|---|---|---|
| `owner_id` | string | Preference owner. |
| `theme` | `light \| dark \| system` | `system`; also kept in `localStorage` (read before first paint); a server value loaded after first paint replaces the local one. |
| `input_language` | `auto \| BCP-47 tag` | `auto`. |
| `output_language` | supported BCP-47 tag or null | Null means: supported browser locale, then `en-US`. |

## Browser overview preference (`FR-WM-03`)

Kept only in the browser's `localStorage` (key `everlast.v2.workspace`, validated, corrupt values fall back to defaults). No server copy exists.

| Field | Type | Default |
|---|---|---|
| `view_mode` | `grid \| list` | `grid` |
| `sort_order` | `recent \| title_asc \| created_desc` | `recent`; `GET /api/notebooks` without `sort_order` also uses `recent`. |

## Owner notebook preference (`FR-WM-03`, `FR-UI-02`)

Composite key `(owner_id, notebook_id)`; notebook ownership is rechecked for each API operation.

| Field | Type | Default / behavior |
|---|---|---|
| `is_pinned` | boolean | `false`; pinned notebooks always precede unpinned notebooks. |
| `last_opened_at` | nullable ISO timestamp | Null until opened; `recent` uses creation time when null. Opening changes this preference, not notebook `updated_at`. |
| `notebook_input_language` | `auto \| BCP-47 tag` or null | Notebook language set by the Owner (v1–v5). |
| `notebook_output_language` | supported BCP-47 tag or null | Notebook language set by the Owner (v1–v5). |

Personal per-notebook overrides (`input_language_override`, `output_language_override`) start in v6.0; in v2.0 the notebook preferences API rejects them with `400`.

## Effective language resolution (`FR-UI-02`, `FR-GC-03`)

Input: explicit job language, personal notebook override (from v6.0; unused in v2.0), notebook language, user default, supported browser locale, `en-US`. Output resolves first non-empty supported tag in this exact order. Input-language `auto` requests detection and does not translate stored source text. Citation quotation snippets always retain their source language.

## State and ordering rules

- Icon: `default -> topic -> custom`; `default/topic -> custom`; `custom` is terminal with respect to source-ingestion auto-updates. Selector failure preserves the current icon and does not fail source ingestion (FR-WM-02).
- Pin: `unpinned <-> pinned`; group pinned records first, then apply selected sort within each group (FR-WM-03).
- `recent`: descending `last_opened_at`, fallback to `created_at`; `title_asc`: case-insensitive `Intl.Collator` order for the UI locale, equal titles by `created_at` descending; `created_desc`: descending creation timestamp. Final stable tie-break by notebook ID.
- Grid/list and sort/theme changes are immediate. Empty notebook lists show the required call to action and do not expose active sorting controls (FR-WM-03).
