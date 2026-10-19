# Implementation Plan: Workspace & UI Comfort

**Branch**: `005-workspace-ui-comfort` | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)
**Package Source**: `spec/requirements/v2/package_2_1_workspace_ui_comfort.md` + [binding cross-package rules](../../spec/requirements/README.md)
**SRS IDs in Scope**: `FR-WM-02`, `FR-WM-03`, `FR-UI-02`, `FR-GC-03` | **Release Gate**: v2.0 contribution only
**Input**: `specs/005-workspace-ui-comfort/spec.md`

## Summary

Implement Package 2.1 only: notebook metadata and topic/default/custom emoji, Ready-source counts and modification dates; owner-specific overview sorting, pinning, view preferences and last-opened tracking; and global/notebook input/output language preferences plus Light/Dark/System theme. This package adds preferences that downstream language-sensitive generators can consume; it does not implement Source Guide, notes, chat or Studio generation (Packages 2.2–2.4). It uses the existing TypeScript/pnpm, shared Zod contracts, API service and in-memory repository/test harness. No new framework, datastore, cloud resource, or infrastructure change is required (D1–D4, D14).

## Technical Context

- **Language/Version**: TypeScript 5.x strict ESM, Node.js 24, pnpm workspaces.
- **Primary Dependencies**: Existing Zod contracts in `packages/contracts`; native Node HTTP API; existing `apps/web` modules and browser APIs. No model SDK dependency is introduced.
- **Storage**: Existing repository in-memory backing stores are the feature's local/test adapter; maintain service/repository boundaries compatible with the existing optional `pg` client convention. No schema migration is planned in this worktree. Production persistence remains the established single Cloud SQL/PostgreSQL design (D1/D4); no alternative persistent store is introduced.
- **Authentication & Residency**: Existing API identity middleware and owner-only release policy; no model endpoint is needed for preference persistence. No region exception; D3 applies.
- **Testing**: Vitest unit/contract/integration tests in existing package suites; Playwright is available for browser flows but unit/integration tests are the required minimum. Root scripts: `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`, `node scripts/check-spec-integrity.mjs`.
- **Execution Model**: Deterministic metadata and preference operations. Input-language `auto` is stored as a preference; no speech transcription or source translation is added. Output language is resolved to an effective BCP-47 value for consumers; this feature does not implement downstream generation.
- **Performance Goals**: Metadata visible within 200 ms of navigation; overview sorting/view switching for up to 500 notebooks within 100 ms; theme applied across panels within 50 ms without a prior-theme flash (SC-001–SC-003).
- **Constraints**: Single valid Unicode emoji grapheme cluster; Ready-only source count; per-owner pin and last-opened data; view mode `grid|list`; sort `recent|title_asc|created_desc`; theme `light|dark|system`; input language `auto` or BCP-47; at least 35 supported output languages; owner-only in v2.0. Preserve language precedence and original-language citation quotations (FR-GC-03).
- **Within-Release Prerequisites**: FR-WM-02 consumes FR-WM-01 notebook and FR-SI-01 source lifecycle/counts; FR-WM-03 consumes FR-WM-01 and FR-WM-02; FR-UI-02 depends on FR-UI-01. Preferences precede language-sensitive generators. No C-01/C-02/C-03 extension is needed.

## Constitution Check (`CC-01`..`CC-08`)

*Design gate: explicitly evaluated before research and after design. Runtime verification is deferred to implementation.*

| Gate ID | Principle | Pre-Research Status | Post-Design Status | Verification Evidence / Notes |
| :--- | :--- | :--- | :--- | :--- |
| `CC-01` | I. Traceability | PASS | PASS | All planned requirements and files map to FR-WM-02, FR-WM-03, FR-UI-02, or FR-GC-03. No new behavior or upstream refinement is introduced. |
| `CC-02` | II. Test-First | PASS | PASS | Tasks put schema, repository, API and UI acceptance/boundary tests before each corresponding behavior implementation. |
| `CC-03` | III. Scope & Snapshot | PASS | PASS | No source-content read or generation path is added; Ready counts are metadata only and do not affect the active source selection. |
| `CC-04` | III. Citations & Leakage | PASS | PASS | No answer/artifact generation or citation path is changed. Citation quote language remains as required by FR-GC-03. |
| `CC-05` | IV. Contracts & Pipelines | PASS | PASS | Additive package DTOs use shared Zod contracts; operations are deterministic. No C-01/C-02/C-03 contract is duplicated or altered. |
| `CC-06` | V. Release & Package Order | PASS | PASS | Feature is Package 2.1 in v2.0; prerequisites are noted and language preference is established before Packages 2.2–2.4. No release gate is claimed complete. |
| `CC-07` | VI. Security, RBAC & Residency | PASS | PASS | Every API operation remains behind existing authentication and notebook ownership checks; v2.0 is owner-only. D3 has no region exception. |
| `CC-08` | Platform & Cost | PASS | PASS | Uses existing pnpm/TS/Zod/Vitest/native HTTP/browser stack and test stores; no framework, datastore, cloud API, model call, or fixed-cost component. |

## Project Structure and Ownership

### Documentation

`specs/005-workspace-ui-comfort/{plan.md,research.md,data-model.md,contracts/interfaces.md,quickstart.md,checklists/ux.md,tasks.md,analysis.md}`.

### Source boundaries

- `packages/contracts/src/package-v2-1.ts`: additive Zod schemas, supported output-language choices, preference resolution helpers and types. `packages/contracts/src/index.ts`: one export line only; this shared barrel is serialized with concurrent package owners.
- `packages/contracts/test/package-v2-1.test.ts`: schema, Unicode emoji, language-tag, precedence and enum boundary tests.
- `packages/db/src/workspace-preferences.ts`: in-memory preference/metadata operations using existing notebook/source stores; export through `packages/db/src/index.ts` only if consumers need it.
- `packages/db/test/workspace-preferences.test.ts`: owner isolation, per-notebook state, pin/sort/opened timestamps, Ready-only counts and mutation timestamps.
- `apps/api/src/services/workspace.ts`, `apps/api/src/routes/notebooks.ts`, and new `apps/api/src/routes/workspace-preferences.ts` (or equivalent single route module): integrate validated operations and owner checks. `apps/api/src/server.ts`: register only if required; no auth bypass.
- `apps/api/test/workspace-preferences.test.ts`: HTTP contract, authorization, invalid emoji 400, invalid preferences and owner isolation.
- `apps/web/src/notebooks.ts` plus new `apps/web/src/workspace-preferences.ts` and `apps/web/src/workspace-preferences.css` (or existing stylesheet): overview grid/list, sorting, pin, metadata, empty state, settings controls and theme application. `apps/web/src/main.ts` / `index.html` are touched only for boot integration and flash-free initial theme.
- `apps/web/test/workspace-preferences.test.ts` and focused browser integration coverage: user-visible scenarios, storage persistence and performance targets.

**Ownership rule**: Keep the new contract in its own `package-v2-1.ts` as requested. Shared barrels, app manifests, lockfile, migrations, infrastructure and CI are not changed unless tests prove a necessary integration; any such change is serialized and minimal. Do not edit unrelated dirty files.

## Design and Phase Outputs

- [Research](research.md): existing adapter choices and resolved implementation questions.
- [Data model](data-model.md): notebook metadata, owner preferences and language resolution.
- [Interfaces](contracts/interfaces.md): API and browser state contracts.
- [Quickstart](quickstart.md): runnable focused and final validation commands.

## Source precedence and integration constraints

The SRS, Package 2.1 FR card, and `spec/requirements/README.md` govern visible behavior. The architecture confirms Flash-Lite for topic emoji selection and Cloud SQL preference persistence, but this implementation does not call a model or claim production persistence: it adds no new provider and uses the existing in-memory local adapter. Theme selection and overview preferences may use browser storage as specified; server-owned notebook pinning and language preferences remain owner-scoped in the repository. A model-backed topic decision and persistent database adapter remain integration dependencies, not silently mocked claims. Any discovery requiring a behavior, limit, or technical change must flow to `spec.md` and the upstream source before implementation, then rerun analyze.

## Complexity Tracking

None. All gates pass at design level; no exception, new architecture decision, scope deferral, or new dependency is required.
