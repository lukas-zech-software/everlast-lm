# Package 2.1 Interfaces

SRS IDs: `FR-WM-02`, `FR-WM-03`, `FR-UI-02`, `FR-GC-03`. All `/api/*` requests pass existing authentication; notebook-specific requests additionally require the authenticated owner. JSON errors retain the current `{ error: { code, message } }` envelope.

## API contracts

### `GET /api/notebooks`
Returns the existing list envelope with each notebook's `icon_emoji`, `created_at`, `updated_at`, and Ready-only `ready_source_count`, plus effective owner pin and last-opened metadata as needed for rendering. Sorting/pinning are owner-scoped and do not mutate notebook content timestamps.

### `PATCH /api/notebooks/:id/icon`
Request: `{ "icon_emoji": "🧬" }`.
- `200`: updated notebook metadata.
- `400 InvalidEmoji`: missing, malformed, or more than one emoji grapheme; stored icon remains unchanged.
- `403`: notebook belongs to another owner.
- `404`: notebook not found.

Custom icon selection sets sticky custom state. Only the first Ready-source event may set a topic icon, and only when no custom icon exists.

### `POST /api/notebooks/:id/opened`
Records the current owner's `last_opened_at`; does not change notebook `updated_at`. Returns `204` on success; standard `403`/`404` otherwise.

### `GET|PATCH /api/preferences`
Returns or updates the owner's display preferences: `view_mode`, `sort_order`, `theme`, `input_language`, `output_language`. Patch accepts only declared fields; invalid enums/tags return `400 InvalidPreference`. Changes are retained across visits. Theme and view/sort can be locally mirrored for immediate first paint, but server response is authoritative after authentication.

### `GET|PATCH /api/notebooks/:id/preferences`
Reads or updates the owner's notebook-scoped pin and language defaults/overrides. No other user's preference is exposed or mutated. `GET` returns the default preference record when none exists; invalid fields return `400`; foreign notebooks return `403`.

### Output language choices
A shared deterministic contract exports at least 35 supported BCP-47 choices and the resolver. The setting response includes the language tag and display name; unsupported tags are rejected for explicit selections. `auto` is accepted for input only. An explicit job language is a resolver input, not an implementation of a generation endpoint.

## Browser interface

- Home overview uses accessible Grid/List controls, a sort selector, pin/unpin buttons, icon and metadata, and an empty-state call to action. Local storage keys are versioned and validated; corrupt values fall back to `grid`, `recent`, `system`.
- Theme is applied to the document root before visible app paint and changes without reload. System theme follows `prefers-color-scheme`; all workspace panels and home controls use theme variables.
- Emoji picker selection updates visible cards/header immediately and persists through the icon API; failed persistence restores the authoritative current icon and announces the error accessibly.
- Preferences never change active source selections. Citation quote previews remain verbatim and un-translated.
