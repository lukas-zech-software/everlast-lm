# Implementation Plan: Workspace & UI Comfort

**Branch**: `005-workspace-ui-comfort` | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)
**Package Source**: `spec/requirements/v2/package_2_1_workspace_ui_comfort.md` + [binding cross-package rules](../../spec/requirements/README.md)
**SRS IDs in Scope**: `FR-WM-02`, `FR-WM-03`, `FR-UI-02`, `FR-GC-03` | **Release Gate**: v2.0 contribution only
**Input**: `specs/005-workspace-ui-comfort/spec.md`

## Summary

Implement Package 2.1 only: notebook metadata and topic/default/custom emoji, Ready-source counts and modification dates; owner-specific overview sorting, pinning, view preferences and last-opened tracking; and global/notebook input/output language preferences plus Light/Dark/System theme. This package adds preferences that downstream language-sensitive generators can consume; it does not implement Source Guide, notes, chat or Studio generation (Packages 2.2–2.4). It uses the existing TypeScript/pnpm, shared Zod contracts, API service and in-memory repository/test harness. No new framework, datastore, cloud resource, or infrastructure change is required (D1–D4, D14).

## Technical Context

- **Language/Version**: TypeScript 5.x strict ESM, Node.js 24, pnpm workspaces.
- **Primary Dependencies**: Zod in `packages/contracts`; native Node HTTP API; browser APIs; the architecture-approved `@google/genai` Vertex AI client in `apps/worker` for first-source topic emoji selection only (Flash-Lite, enterprise endpoint).
- **Storage**: Existing repository in-memory backing stores are the feature's local/test adapter; maintain service/repository boundaries compatible with the existing optional `pg` client convention. No schema migration is planned in this worktree. Production persistence remains the established single Cloud SQL/PostgreSQL design (D1/D4); no alternative persistent store is introduced.
- **Authentication & Residency**: Existing API identity middleware and owner-only release policy. Topic emoji uses the enterprise Vertex AI endpoint with keyless auth in `europe-west4`, no consumer key, and no region exception (D3, NFR-SEC-01).
- **Testing**: Vitest unit/contract/integration tests in existing package suites; Playwright is available for browser flows but unit/integration tests are the required minimum. Root scripts: `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`, `node scripts/check-spec-integrity.mjs`.
- **Execution Model**: Deterministic metadata and preference operations. First-Ready-source icon enrichment is a bounded structured Flash-Lite call through the enterprise Vertex AI endpoint in `europe-west4` (Solution Architecture §2.1/D3); failure leaves the source Ready and current icon unchanged. Input-language `auto` is stored as a preference; no speech transcription or source translation is added. Output language is resolved to an effective BCP-47 value and passed to the existing chat model boundary; downstream Source Guide, Note Assistant, and Studio consumers are exposed to this shared resolver but are implemented in later packages.
- **Performance Goals**: Metadata visible within 200 ms from successful list response; client sorting/view switching for 500 synthetic records within 100 ms; theme application within 50 ms and before first visible paint, measured in the supported Chromium run (SC-001–SC-003). The feature acceptance suite is `pnpm test:e2e --grep "Workspace comfort Chromium acceptance"`.
- **Constraints**: Single valid Unicode emoji grapheme cluster; Ready-only source count; per-owner pin and last-opened data; view mode `grid|list`; sort `recent|title_asc|created_desc`; theme `light|dark|system`; input language `auto` or BCP-47; exactly 40 supported output languages; owner-only in v2.0. Preserve language precedence and original-language citation quotations (FR-GC-03).
- **Within-Release Prerequisites**: FR-WM-02 consumes FR-WM-01 notebook and FR-SI-01 source lifecycle/counts; FR-WM-03 consumes FR-WM-01 and FR-WM-02; FR-UI-02 depends on FR-UI-01. Preferences precede language-sensitive generators. No C-01/C-02/C-03 extension is needed.

## Constitution Check (`CC-01`..`CC-08`)

*Design gate: explicitly evaluated before research and after design. Runtime verification is deferred to implementation.*

| Gate ID | Principle | Pre-Research Status | Post-Design Status | Verification Evidence / Notes |
| :--- | :--- | :--- | :--- | :--- |
| `CC-01` | I. Traceability | PASS | PASS | All planned requirements and files map to FR-WM-02, FR-WM-03, FR-UI-02, or FR-GC-03. List-date, fixed locale set, theme behavior, and architecture-approved topic-icon refinements are recorded in the feature spec and Package 2.1 FR card. |
| `CC-02` | II. Test-First | PASS | PASS | Tasks put schema, repository, API and UI acceptance/boundary tests before each corresponding behavior implementation. |
| `CC-03` | III. Scope & Snapshot | PASS | PASS | No source-content read or generation path is added; Ready counts are metadata only and do not affect the active source selection. |
| `CC-04` | III. Citations & Leakage | PASS | PASS | No answer/artifact generation or citation path is changed. Citation quote language remains as required by FR-GC-03. |
| `CC-05` | IV. Contracts & Pipelines | PASS | PASS | Additive package DTOs use shared Zod contracts; operations are deterministic. No C-01/C-02/C-03 contract is duplicated or altered. |
| `CC-06` | V. Release & Package Order | PASS | PASS | Feature is Package 2.1 in v2.0; prerequisites are noted and language preference is established before Packages 2.2–2.4. No release gate is claimed complete. |
| `CC-07` | VI. Security, RBAC & Residency | PASS | PASS | Every API operation remains behind existing authentication and notebook ownership checks; v2.0 is owner-only. Topic-emoji selection uses the keyless enterprise Vertex AI endpoint, no consumer key, and no region exception (D3, NFR-SEC-01). |
| `CC-08` | Platform & Cost | PASS | PASS | Uses existing pnpm/TS/Zod/Vitest/native HTTP/browser stack and test stores; no new framework, datastore, cloud product, or fixed-cost component; the only model call is the bounded Vertex AI Flash-Lite topic-icon enrichment specified in Solution Architecture §2.1 (D3 residency). |

## Project Structure and Ownership

### Documentation

`specs/005-workspace-ui-comfort/{plan.md,research.md,data-model.md,contracts/interfaces.md,quickstart.md,checklists/ux.md,tasks.md,analysis.md}`.

### Source boundaries

- `packages/contracts/src/package-v2-1.ts`: additive Zod schemas, supported output-language choices, preference resolution helpers and types. `packages/contracts/src/index.ts`: one export line only; this shared barrel is serialized with concurrent package owners.
- `packages/contracts/test/package-v2-1.test.ts`: schema, Unicode emoji, language-tag, precedence and enum boundary tests.
- `packages/db/src/workspace-preferences.ts`: in-memory preference/metadata operations using existing notebook/source stores; export through `packages/db/src/index.ts` only if consumers need it.
- `packages/db/test/workspace-preferences.test.ts`: owner isolation, per-notebook state, pin/sort/opened timestamps, Ready-only counts and mutation timestamps.
- `apps/api/src/services/workspace.ts`, `apps/api/src/routes/notebooks.ts`, and new `apps/api/src/routes/workspace-preferences.ts` (or equivalent single route module): integrate validated operations and owner checks. `apps/api/src/server.ts`: register only if required; no auth bypass.
- `apps/api/test/workspace-preferences.test.ts` and `apps/api/test/chat-language.test.ts`: HTTP contract, authorization, invalid emoji 400, invalid preferences, owner isolation and language propagation to the existing chat model boundary.
- `apps/web/src/notebooks.ts`, `apps/web/src/workspace-layout.ts`, plus `apps/web/src/workspace-preferences.ts` and the existing `workspace.css`: overview grid/list, sorting, pin, metadata, empty state, overview/workspace settings, notebook-scoped language settings and theme application. `apps/web/src/main.ts` / `index.html` load notebook title/icon and apply flash-free initial theme.
- `apps/api/src/chat/agent.ts` and `apps/api/src/routes/chat.ts`: carry effective input/output language into the current grounded-chat model adapter while retaining source-language citation snippets.
- `apps/web/test/workspace-preferences.test.ts` and `apps/web/test/workspace-comfort.spec.ts`: settings hydration/persistence, notebook header metadata, theme behavior, user-visible scenarios and Chromium performance targets.
- `apps/worker/src/ingestion/topic-emoji.ts`, `apps/worker/test/topic-emoji.test.ts`, `apps/worker/src/ingestion/pipeline.ts`, `apps/worker/package.json`, and `pnpm-lock.yaml` when the approved client is added: injected, testable Flash-Lite topic emoji selection; use enterprise Vertex AI configuration and fall back without failing ingestion.

**Ownership rule**: Keep the new contract in its own `package-v2-1.ts` as requested. Shared barrels, app manifests, lockfile, migrations, infrastructure and CI are not changed unless tests prove a necessary integration; any such change is serialized and minimal. Do not edit unrelated dirty files.

## Design and Phase Outputs

- [Research](research.md): existing adapter choices and resolved implementation questions.
- [Data model](data-model.md): notebook metadata, owner preferences and language resolution.
- [Interfaces](contracts/interfaces.md): API and browser state contracts.
- [Quickstart](quickstart.md): runnable focused and final validation commands.

## Source precedence and integration constraints

The SRS, Package 2.1 FR card, and `spec/requirements/README.md` govern visible behavior. The Solution Architecture §2.1 model-routing table assigns topic emoji selection to Flash-Lite. Only the source title and media type needed for the first-source emoji decision is sent through the existing enterprise Vertex AI path in `europe-west4`; no consumer API key or new cloud product is introduced (D3, NFR-SEC-01). The test suite injects a model client and does not claim live model acceptance without credentials. The existing database package currently uses in-memory stores for local/test behavior; owner preferences use that same adapter pattern and are not represented as durable Cloud SQL persistence. Theme and overview preferences are browser-mirrored; server-owned notebook pinning and language preferences remain owner-scoped in the repository. A production persistence adapter remains an explicitly documented integration limitation. Any discovery requiring a behavior, limit, or technical change must flow to `spec.md` and the upstream source before implementation, then rerun analyze.

## Complexity Tracking

None. All gates pass at design level; no architecture exception, scope deferral, or new cloud product is required. The `@google/genai` dependency is an existing architecture-approved client (Solution Architecture §1), scoped to the first-source topic-icon call.
