# Research: Workspace & UI Comfort

Date: 2026-10-19. Scope: Package 2.1 (`FR-WM-02`, `FR-WM-03`, `FR-UI-02`, `FR-GC-03`). Research is bounded to the repository's accepted architecture and existing implementation; no external dependencies or new cloud services are needed.

## Decisions

### Typed package contract
- **Decision**: Add only additive Package 2.1 Zod schemas and helpers in `packages/contracts/src/package-v2-1.ts`, with one barrel export.
- **Rationale**: The constitution requires shared typed contracts. The current `workspace.ts` contract covers v1 notebook title/identity and is already consumed broadly; an isolated package module avoids changing existing notebook DTO consumers and accommodates concurrent changes to `index.ts`.
- **Alternatives considered**: Extend the v1 contract in place (higher cross-release regression and concurrent conflict risk); ad-hoc route validation (duplicates rules and type contracts).

### Repository persistence boundary
- **Decision**: Add owner-specific metadata/preference repository operations to the existing `packages/db` package, using its current in-memory store path for this project’s unit/integration harness and preserving the optional PostgreSQL client shape.
- **Rationale**: Current notebook operations and feature tests use in-memory stores; this is the established local adapter. Architecture D1/D4 continues to name the single Cloud SQL/PostgreSQL store as production persistence. The implementation must not present an in-memory-only adapter as deployed database durability.
- **Alternatives considered**: Introduce a second persistence technology (forbidden without a Dn); write a migration and direct SQL without an available production runtime path (would not be exercised by this codebase and violates the requested in-memory harness approach).

### Preference placement
- **Decision**: Persist `is_pinned`, `last_opened_at`, notebook input/output overrides and notebook defaults per owner/notebook; persist user-level theme, overview mode/sort and input/output defaults by owner. Resolve effective output language with the exact required precedence. Keep view/sort/theme locally mirrored for immediate rendering and reload behavior.
- **Rationale**: This follows FR-WM-03/FR-UI-02 entity scope and keeps per-user state isolated while allowing the browser to render instantly.
- **Alternatives considered**: Put all preferences on `Notebook` (leaks user-specific state); use localStorage as the sole source for notebook pin/language settings (not server-owned and cannot meet API persistence expectations).

### Theme initialization and application
- **Decision**: Read a validated saved theme before app rendering, set a root `data-theme`/color-scheme attribute, and use CSS variables for theme colors. `system` follows `prefers-color-scheme`; changes update the attribute without reload.
- **Rationale**: Avoids a flash of the previous theme and uses browser-native mechanisms, meeting the 50 ms target without a framework.
- **Alternatives considered**: Hard-coded light/dark styles without root variables (incomplete panel coverage); reload-based application (explicitly disallowed).

### Emoji validity and first-source topic icon
- **Decision**: Validate exactly one Unicode emoji grapheme (including ZWJ/skin-tone/flag sequences) at the shared contract/API boundary; reject invalid API values with HTTP 400. Keep custom-icon state distinct from the default/auto-topic state so later source-ready events cannot overwrite a manual choice. Route topic assignment through a deterministic source-ready operation that accepts the topic's emoji suggestion from the existing ingestion/topic boundary.
- **Rationale**: These distinctions are required by FR-WM-02; Unicode code-point count is insufficient for emoji graphemes. Existing architecture calls for Flash-Lite topic emoji selection, but no model integration is in this feature's current runtime. The interface should permit a future authorized model-backed suggestion without fabricating one today.
- **Alternatives considered**: Regex that accepts only one code point (rejects many valid emoji); unrestricted text; always deriving emoji from local title keywords (would invent topic semantics not backed by the current source/topic data).

### Supported language set and fallback
- **Decision**: Use a deterministic, documented list of at least 35 valid BCP-47 enterprise language tags and validate saved explicit preferences against the supported list. `auto` applies only to input language. Output resolution is job override > personal notebook override > notebook default > user default > supported browser locale > `en-US`.
- **Rationale**: The card sets a minimum language count and exact precedence; one shared list keeps settings choices and resolution consistent.
- **Alternatives considered**: Accept arbitrary tags into the output picker (cannot guarantee available generation support); implicit runtime locale without a deterministic fallback (not reproducible).

## Resolved implementation questions

- The current server uses native Node HTTP dispatch and authenticates all `/api/*` paths before calling the notebook route. Add routes under this existing authenticated dispatcher and reuse `ownerId`; no framework is introduced.
- The existing notebook list endpoint and web module form the integration point for home metadata; preserve current creation/title/delete behavior.
- The current source data is in the ingestion repository; counts include only sources in `Ready`, never Failed/Uploading/Processing.
- No unresolved technical clarification remains at plan time. If topic detection cannot provide a topic emoji from its existing source-ready input, keep the default emoji and record a flow-back rather than invent a topic. This limitation is flagged as an integration caveat for analysis/implementation.
