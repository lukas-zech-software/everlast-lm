# Data Model: Workspace & UI Comfort

SRS scope: `FR-WM-02`, `FR-WM-03`, `FR-UI-02`, `FR-GC-03`. This package extends the existing Notebook and owner-preference concepts; it does not alter C-01/C-02/C-03 or source selection.

## Notebook metadata (`FR-WM-02`)

| Field | Type | Validation / behavior |
|---|---|---|
| `id` | UUID | Existing notebook identity. |
| `owner_id` | string | Existing owner identity; all mutations are owner-authorized. |
| `title` | string | Existing title and validation. |
| `icon_emoji` | string | Exactly one valid Unicode emoji grapheme cluster; default `📓`. |
| `icon_source` | `default \| topic \| custom` | Default transitions to topic after first Ready source if a valid topic suggestion exists; custom is sticky and never overwritten by later ingestion. |
| `created_at` | ISO timestamp | Existing creation time. |
| `updated_at` | ISO timestamp | Changes on source add/remove/rename, note/artifact modification, title or icon mutation as specified. |
| `ready_source_count` | nonnegative integer | Derived from sources in `Ready`; not incremented by failed/in-flight sources. |

Relationships: Notebook has 0..N sources; only Ready sources contribute to `ready_source_count`. A source-ready event may supply an optional topic emoji suggestion. No source text is read for UI metadata.

## Owner display preference (`FR-WM-03`, `FR-UI-02`)

| Field | Type | Default / scope |
|---|---|---|
| `owner_id` | string | Preference owner. |
| `view_mode` | `grid \| list` | `grid`; mirrored to browser storage for immediate preference restoration. |
| `sort_order` | `recent \| title_asc \| created_desc` | `recent`; mirrored to browser storage. |
| `theme` | `light \| dark \| system` | `system`; mirrored to browser storage and applied to all panels. |
| `input_language` | `auto \| BCP-47 tag` | `auto`. |
| `output_language` | supported BCP-47 tag | Account/user locale, then browser locale, then `en-US` when no explicit setting. |

## Owner notebook preference (`FR-WM-03`, `FR-UI-02`)

Composite key `(owner_id, notebook_id)`; notebook ownership is rechecked for each API operation.

| Field | Type | Default / behavior |
|---|---|---|
| `is_pinned` | boolean | `false`; pinned notebooks always precede unpinned notebooks. |
| `last_opened_at` | nullable ISO timestamp | Null until opened; `recent` uses creation time when null. Opening changes this preference, not notebook `updated_at`. |
| `input_language_override` | `auto \| BCP-47 tag` or null | User's personal override; in v2.0 the only active role is Owner. |
| `output_language_override` | supported BCP-47 tag or null | Personal override. |
| `notebook_input_language` | `auto \| BCP-47 tag` | Notebook default; editable by owner. |
| `notebook_output_language` | supported BCP-47 tag or null | Notebook default. |

## Effective language resolution (`FR-UI-02`, `FR-GC-03`)

Input: explicit job language, personal notebook override, notebook default, user default, supported browser locale, `en-US`. Output resolves first non-empty supported tag in this exact order. Input-language `auto` requests detection and does not translate stored source text. Citation quotation snippets always retain their source language.

## State and ordering rules

- Icon: `default -> topic -> custom`; `default/topic -> custom`; `custom` is terminal with respect to source-ingestion auto-updates (FR-WM-02).
- Pin: `unpinned <-> pinned`; group pinned records first, then apply selected sort within each group (FR-WM-03).
- `recent`: descending `last_opened_at`, fallback to `created_at`; `title_asc`: locale-aware title ascending; `created_desc`: descending creation timestamp. Stable tie-break by notebook ID.
- Grid/list and sort/theme changes are immediate. Empty notebook lists show the required call to action and do not expose active sorting controls (FR-WM-03).
