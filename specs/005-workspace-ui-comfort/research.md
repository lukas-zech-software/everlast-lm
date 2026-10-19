# Research: Workspace & UI Comfort

Date: 2026-10-19. Scope: Package 2.1 (`FR-WM-02`, `FR-WM-03`, `FR-UI-02`, `FR-GC-03`). Research follows the repository's accepted architecture and existing implementation; it introduces no new cloud product or framework.

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
- **Decision**: Validate exactly one Unicode emoji grapheme (including ZWJ/skin-tone/flag sequences) at the shared contract/API boundary; reject invalid API values with HTTP 400. Keep custom-icon state distinct from default/topic state so later source-ready events cannot overwrite a manual choice. For the first source to reach Ready, call the architecture-approved Flash-Lite model through Vertex AI using only the source title and media type, validate one emoji result, and apply it only if the owner has not set a custom icon. A model/configuration/validation failure leaves the source Ready and the existing icon unchanged.
- **Rationale**: FR-WM-02 specifies topic-based icon assignment and the Solution Architecture §2.1 model-routing table assigns Flash-Lite topic emoji selection. Using the existing enterprise Vertex AI client preserves the approved model route and D3 residency and avoids consumer keys; this requires no additional cloud product. No source text/chunks are submitted, so icon enrichment is not a source-read or generation bypass. The testable service accepts an injected model client and fails closed to the existing icon.
- **Alternatives considered**: Regex that accepts only one code point (rejects many valid emoji); unrestricted text; deterministic title keyword mapping (not the architecture-approved topic model and may misclassify); failing source ingestion when a decorative icon call is unavailable (unrelated to source readiness).

### Supported language set and fallback
- **Decision**: Use a deterministic, documented list of exactly 40 valid BCP-47 enterprise language tags and validate saved explicit preferences against the supported list. `auto` applies only to input language. Output resolution is job override > personal notebook override > notebook default > user default > supported browser locale > `en-US`.
- **Rationale**: The card sets a minimum language count and exact precedence; one shared list keeps settings choices and resolution consistent.
- **Alternatives considered**: Accept arbitrary tags into the output picker (cannot guarantee available generation support); implicit runtime locale without a deterministic fallback (not reproducible).

### Requirement refinements
- **Decision**: List rows show both creation and last-modified dates because FR-001 requires both and FR-WM-03 reference behavior says Created/Modified date. Supported output choices are a fixed, versioned set of 40 locales, not a changing external list. System theme follows `prefers-color-scheme` and is applied before initial paint. Performance checks use synthetic 500-notebook fixtures in the supported Chromium test run and start metadata timing after the successful list response.
- **Rationale**: These are explicit resolutions of existing card/spec ambiguities, not new features. The details flow back to the package card and feature spec.

## Resolved implementation questions

- The current server uses native Node HTTP dispatch and authenticates all `/api/*` paths before calling the notebook route. Add routes under this existing authenticated dispatcher and reuse `ownerId`; no framework is introduced. The home overview and active workspace both expose settings, with global preferences hydrated from `/api/preferences` and notebook defaults from the owner-scoped notebook preference route.
- The existing notebook list endpoint and web module form the integration point for home metadata; preserve current creation/title/delete behavior.
- The current source data is in the ingestion repository; counts include only sources in `Ready`, never Failed/Uploading/Processing.
- Topic model calls are enrichment only: source ingestion and the Ready transition succeed independently, while a missing endpoint/configuration or invalid response leaves the current icon unchanged. Live endpoint verification is `UNAVAILABLE` without enterprise Vertex AI credentials; deterministic adapter tests remain required.
