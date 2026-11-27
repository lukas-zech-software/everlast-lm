# Implementation Plan: UI Skeleton & Quality Gates

**Branch**: `spec/v1-functional-requirements` | **Date**: 2026-10-17 | **Spec**: [spec.md](spec.md)
**Package Source**: `spec/requirements/v1/package_1_4_ui_skeleton_quality_gates.md`
**SRS IDs**: FR-UI-01, NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01, C-01, C-02, Gate v1.0
**Input**: `specs/004-ui-skeleton-quality-gates/spec.md`, clarified in `47c4e90`.


## Dependency PR #197 review — 2026-11-15 (CC-09)

Traceability: C-01..C-03, NFR-SEC-01/02, NFR-EVAL-02/04. Reviewer: Codex.
Reviewed dependency head: `79e900e2a4c43de4e350d84c1bc83d6d6f5e4e32`, against `8c159515c52e04c0b926b328e11530dd0b4381fb`.

Playwright remains a development-only dependency in the root and apps/web manifests. Browser binaries are installed by the existing CI command from the matching Playwright version. No browser production import, application interface or deployment dependency is added.

Manual boundary review: PASS for this manifest/lockfile-only dependency delta. No workspace edge, public export, route/service responsibility, quota, transaction, cancellation or publication fence changes. Existing 90 exact D21 exceptions remain unchanged; this review does not close their removal tasks.

Automated evidence on the reviewed dependency head: [CI run](https://github.com/lukas-zech-software/everlast-lm/actions/runs/43524522027) passed typecheck, unit/contract, PostgreSQL integration, deterministic evaluation and Chromium journeys. The separate required Spec integrity run passed link/spec checks, all 39 architecture fixtures and the boundary scan (zero findings, 90 exact exceptions), then correctly rejected the missing changed-feature evidence. This review supplies that evidence without changing the checker or migration policy.

This is dependency maintenance evidence, not new feature implementation or release acceptance. No live cloud workload or judged release run is claimed.

## Summary

Implement exactly package 1.4 from [FR cards](../../spec/requirements/v1/package_1_4_ui_skeleton_quality_gates.md) and [binding rules](../../spec/requirements/README.md). Prerequisite plan created before task generation; no application code is produced here. Main infrastructure baseline `6f3d6b2` (`D14` OpenTofu in `infra/stacks/v1_foundation/`) is merged and aligned across packages 1.1–1.3 (`d797ca0`, `e2725ee`, `ff04006`).

## Technical Context

- TypeScript 5.x strict ESM, Node24, pnpm baseline; pin compatible versions in the implementation lockfile, reuse package1.1 native HTTP/browser adapters instead of adding frameworks.
- Shared Zod contracts; Cloud SQL PostgreSQL+pgvector/FTS, Cloud Storage, Cloud Tasks and Cloud Run in europe-west4 by default. Use existing `infra/stacks/v1_foundation/main.tf` and modules, never duplicate infrastructure.
- Deterministic UI state and eval orchestration; model calls only in judged eval cases and the already-owned chat pipeline. No Studio generator.
- Vitest unit/contract/integration/eval and Playwright browser suites. No application runners exist yet: UNAVAILABLE.
- 1.1–1.3 provide real notebook, source, inspector and chat features; UI shell and test datasets can be prepared early, but full Gate v1.0 requires the integrated runnable application.
- Owner-only v1–v5; explicit nonempty Ready source IDs, immutable submission revisions, current authorization before reads/publication, singleton inspection without selection mutation. All source reads go through C-02; history/cache eligibility covers complete provenance, not only citations. Deleted/revoked content is hidden or unavailable; invalid factual citations cause immediate refusal before publication. Byte and word limits are independent and inclusive. All future roles, overview/chips/Source Guide, personas, re-sync, media and Studio features remain in their assigned releases.

## Constitution Check (CC-01..CC-09)

Pre-research scope review passed before selecting implementation details; post-design review covers the contract/data/validation documents, not runtime success. No tests are claimed executed. Full analyze is required after tasks before implementation.

| Gate | Principle | Pre-research | Post-design | Evidence |
| :--- | :--- | :--- | :--- | :--- |
| CC-01 | Traceability | PASS | PASS | All EARS/scenarios/limits/errors from each card are mapped in tasks coverage annex; no source requirements changed. |
| CC-02 | Test-first | PASS | PASS | Per-story Red tasks precede all behavior implementation; real runners required; missing dependency is not Red. |
| CC-03 | Scope/snapshot | PASS | PASS | C-02 sole read boundary; explicit Ready set and revision/authorization rechecks in contracts. |
| CC-04 | Citation/leakage | PASS | PASS | D13 buffering, refusal and full history/cache provenance enforced across integrations. |
| CC-05 | Contracts/pipelines | PASS | PASS | Import 1.1 C-01/C-02 once; deterministic components except 1.3 reasoning; no C-03 runtime in v1. |
| CC-06 | Release order | PASS | PASS | 1.1–1.3 provide real notebook, source, inspector and chat features; UI shell and test datasets can be prepared early, but full Gate v1.0 requires the integrated runnable application. |
| CC-07 | Security/residency | PASS | PASS | Owner authorization and no-training enterprise routes; EU default with verified service region map; no API activation. |
| CC-08 | Platform/cost | PASS | PASS | Reuse TypeScript/Cloud Run/single Postgres/Storage/Tasks and OpenTofu D14; no new framework/fixed-cost service. |
| CC-09 | Architectural boundaries | PASS | PASS | C-01..C-03: tooling boundary inventory below; automated dependency and artifact checks plus 39 fixtures pass, with 90 exact D21 migration exceptions after replacing `apps/api` and `apps/worker` wildcard exports with explicit subpath exports on current `main`. Manual workflow review remains required for application changes. |

## Project Structure and Ownership

Documentation owned by this session: this package's `plan.md`, `research.md`, `data-model.md`, `contracts/interfaces.md`, `quickstart.md`, `tasks.md` on branch `spec/v1-functional-requirements` (base `47c4e90`). Runtime paths below are proposed package-owner boundaries; publish task/file reservations before implementation. Shared manifests, schema exports, migrations, entrypoints and CI remain serialized under one owner.

| Component | Exact intended files | Trace |
| :--- | :--- | :--- |
| Use adaptive workspace | `apps/web/test/workspace-layout.spec.ts`, `apps/web/src/workspace-layout.ts`, `apps/web/src/workspace-state.ts`, `apps/web/src/main.ts`, `apps/web/src/workspace.css` | FR-UI-01 |
| Enforce evaluation and security gates | `packages/evals/test/release-v1.test.ts`, `packages/evals/src/runner.ts`, `packages/evals/src/metrics.ts`, `packages/evals/src/report.ts`, `packages/evals/src/security-preflight.ts` | NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01 |

Shared dependencies: `packages/contracts/src/document-chunk.ts`, `scoped-context.ts`, `source-admission.ts`, `workspace.ts` belong to package1.1 baseline. Schema extensions must update all consumers/tests through the same files; no second C-01/C-02. Package-specific DTOs live in `packages/contracts/src/package-v1-4.ts`. Manifests/lockfile/CI changes require the shared owner and preserve OpenTofu scripts/workflow. No cloud apply or API enablement is authorized.

## Design and Phase Outputs

- [Research](research.md): decisions and alternatives.
- [Data model](data-model.md): relationships, state transitions and exact input constraints.
- [Interfaces](contracts/interfaces.md): behavior and failure contracts.
- [Quickstart](quickstart.md): required tests, setup and evidence.

## Source precedence and integration constraints

The SRS/cards/README override lower-priority architecture prose: v1 source limits remain deployment configurable 50–300; daily generation quotas and all v2+ features are excluded. The 2 s notebook deletion metric applies to database/chunk removal per FR-WM-01; do not silently extend it to outstanding signed upload capabilities. Use the 1.1 immediate-access fence and tracked all-generation purge. Any unresolved change to these contracts requires source-aligned plan updates and rerun analyze before dependent implementation.

Package 1.1's plan (`d797ca0`) is reconciled with integrated `D14` and actual `infra/stacks/v1_foundation/` paths. These package plans consume the approved baseline, and no competing infrastructure files are created.

## Complexity Tracking

No new framework, datastore, cloud service, scope deferral or constitution exception. Canonical representation, request provenance and explicit publication checks implement existing C-01/C-02/D13 requirements. Deployment endpoint/IdP/processor configuration is a live validation prerequisite, not an assumed successful deployment.

## Implementation Discoveries (flow-back, 2026-10-19)

- **Runtime and layout (Gate v1.0):** Node 24 runs the TypeScript sources directly (type stripping; relative imports use `.ts`, `tsconfig` sets `allowImportingTsExtensions`, `rewriteRelativeImportExtensions`, `erasableSyntaxOnly`). Two workspace packages were added: `packages/cloud` (Cloud Storage, Vertex AI embeddings, Document AI OCR adapters) and `packages/testkit` (test-only PDF fixture builder). One container image serves API and worker (`SERVICE_ROLE`).
- **Tests (CC-02):** Vitest projects `unit` and `integration`; integration suites need PostgreSQL 16 + pgvector via `TEST_DATABASE_URL` (`pnpm db:test:up`) and fail with UNAVAILABLE when it is unset. Playwright runs against `apps/web/test/e2e-server.ts` (real API, database and worker; labelled test doubles for embeddings and the model).
- **SPA:** vanilla TypeScript DOM modules compiled by `tsc` (`scripts/build-web.mjs`), served by the API with an SPA fallback. Panel preferences in `localStorage`; selection in `sessionStorage` per notebook; the inspector renders all pages up to the cited page eagerly so the scroll target cannot move.
- **Evaluation:** `packages/evals` generates a deterministic synthetic corpus (fictional "Kestrel Vantage", 10 PDF/Markdown documents) and a 222-case golden dataset (110 unanswerable, 32 deselected-source, 20 history carry-over, 60 synthesis), hashed in every report instead of a committed `golden.jsonl`. `pnpm eval:deterministic` (every PR, test doubles, adversarial pass) measures Precision_ID and leakage; `pnpm eval:judged` (Vertex AI chat + Flash-Lite judge) adds hallucination, semantic support and rejection. Reports go to `reports/` (`eval-report-v1.json`, `.md`, `gate-audit.jsonl`); Playwright writes Gate #1/#3 evidence to `reports/gate-v1-ui.json`.
- **Judged release sample (Constitution v2.0.0):** `pnpm eval:judged` runs once per release gate on a fixed stratified 50-case sample (`releaseSample`: 25 unanswerable, 7 deselected-source, 4 history carry-over, 14 synthesis); case IDs and method are written into the report. With 25 unanswerable cases, rejection ≥ 0.99 requires 25/25. The CI `judged` job runs only on a release-gate `workflow_dispatch`; `--full` runs all 222 cases.
- **Gate lifecycle:** GatePassed only for a release run with all metrics passing, NFR-SEC-01 preflight passing and UI evidence for #1 and #3; any failure fails closed; missing evidence stays GatePending. Semantic citation support is gated at 1.0.
- **Preflight (NFR-SEC-01):** inspects the actual SDK clients (Vertex AI, no API key, `europe-west4`), forbids developer keys in the runtime environment, accepts Document AI in `europe-west4` or `eu` (D3 region map), checks ADC live, and reports no-training separately from retention.

## Architecture Boundary Evidence — 2026-11-07 amendment (C-01..C-03, NFR-EVAL-02/04)

The original gates above describe the historical product work. For this tooling-only amendment,
CC-01 maps ARCH-01..04 to Package 1.4; CC-02 requires failing fixtures first; CC-03/04/05 preserve
runtime contracts without modifying them; CC-06 is v1 quality maintenance; CC-07 changes no
credentials/resources; CC-08 reuses Node and TypeScript; CC-09 follows the inventory below.
Pre-research and post-design assessment: PASS for the proposed tooling boundaries; implementation
and CI execution evidence must be recorded separately. R1/R2 application remediation is deferred.

| SRS / contract | Module and owner | Responsibility | Public interface | Allowed dependencies | Composition root | Regression evidence |
| --- | --- | --- | --- | --- | --- | --- |
| C-01..C-03 | scripts/check-architecture.mjs; quality-gate maintainer | Parse/resolve/check/report | inspectArchitecture, checkArchitecture | Node built-ins, pinned typescript-compiler alias | CLI entry | scripts/test/architecture.test.mjs |
| C-01..C-03 | scripts/architecture-policy.json; project owner | Individual migration records | Versioned JSON | D21, removal tasks | Checker CLI | Exception lifecycle fixtures |
| NFR-EVAL-02/04 | scripts/check-architecture-artifacts.mjs; quality-gate maintainer | Changed-feature evidence | CLI with base ref | Node/git | lint and required CI job | Artifact fixtures |
| NFR-EVAL-02/04 | .github/workflows/spec-integrity.yml; project owner | Required CI wiring | Existing job context | Existing pinned setup actions | GitHub Actions | Local command chain and workflow inspection |

Tests use isolated temporary repositories; no fixtures are imported into production. No workflow,
transaction, quota, cancellation, recovery or publication behavior is moved. No new service, SDK,
API or deployment dependency. TypeScript 7 exposes no legacy compiler API; a pinned dev-only TypeScript 6 alias supplies the parser/resolver without changing the application compiler. No simplistic route scanner is
claimed to prove service ownership. Exceptions are exact, expire 2027-02-05, and are removable
only; enlarging them needs a separately reviewed governance amendment (D21). Enforcement rollout
reuses the existing required check so an unpublished new context cannot block unrelated PRs.

## Pre-V4 CC-09 boundary inventory (D21, D23)

| Trace | Owner and module | Responsibility and interface | Allowed dependency / composition | Regression |
| --- | --- | --- | --- | --- |
| NFR-EVAL-01..04 | 004 `packages/evals/src/runner.ts`, `report.ts` | Evaluation workflow, structured attempts, lifecycle and durable release evidence | Local judge/runner/report interfaces and public feature ports. `cli.ts` composes adapters. | Judge resilience, judge/report integration, release report and fixed sample tests |
| NFR-EVAL-01..03 | 004 `packages/evals/src/judge.ts` | Structured Vertex judge, bounded provider retries and redacted attempt metadata | Google SDK adapter and Zod. CLI supplies the keyless client. | Provider retries, invalid verdicts, no content in attempts |
| NFR-SEC-01, NFR-EVAL-01..04 | 004 `cli.ts`, `source-guide-gate.ts`, `studio-gate.ts`, judged CI | CLI/CI own invocation and report transport. Models expose actual provider identities. | Committed 003 Gemini configuration and chat, 006 structured Guide, 008 Studio reports, 011 Studio structures, 012 qualified profile. Final startup integration follows producer commits. | Local doubles for evidence and final candidate provider/wiring verification |
| NFR-EVAL-01..04, D4, D24/DEV-07 | 004/001 `packages/testkit/src/live-fixtures.ts`, `packages/evals/src/cli.ts`, `source-guide-gate.ts`, `apps/api/test/{identity,code-execution-runtime}.integration.test.ts`, `apps/worker/test/notebook-cleanup.integration.test.ts` | Dev-only live cloud smoke tests, permission prompt before starting scaled-to-zero `everlast-dev-pg`/`everlast-dev-api`, and automatic scale-down afterward unless manually started beforehand | `@everlast/testkit/live-fixtures` (`@everlast/contracts` + Node built-ins) and opt-in integration/CLI scripts | [packages/testkit/test/live-fixtures.test.ts](../../packages/testkit/test/live-fixtures.test.ts) |
| C-01..C-03, FR-WM-01..04, FR-WM-07 | Owning packages per [D21 ledger](d21-ownership.md) | R1 public ports, R2 application use cases and R3 explicit exports | Named composition roots and serialized policy removals. Routes retain transport, database adapters own SQL and transactions. | Feature-specific behavior and architecture checks per owning fix |

CC-09 local work reviews existing evaluator edges against the exact D21 baseline and
adds no application import or deployment edge. No changes to authorization, atomic quota
transactions, durable dispatch, cancellation, publication or D16 placement are part of
the evaluator evidence slice. Pre-V4 status stays pending until the actual graph,
behavior and live evidence are validated against the assembled candidate.

### Combined candidate evidence labels (D23, NFR-SEC-01, NFR-EVAL-01..04)

The Guide and report release harnesses record the identity returned by the
actual adapters in `packages/evals/src/source-guide-gate.ts` and
`packages/evals/src/studio-gate.ts`. The first consumes the public cloud
structured adapter and the second uses the report port's `id` through its
existing D21 exception. The evaluator owns evidence labels, while the
adapters own model and transport selection. Focused Guide/Studio tests and
the deterministic evaluator exercise the integration. T039 still owns the
judge transport and role-specific endpoint preflight. The label updates
do not establish live qualification or change publication, authorization,
transactions, or deployment.

The Gate v3 candidate applies the T039 transport subset for chat and the
judge. The CLI supplies the explicit D23 routes, separates the regional
embedding client, and stops before inference when preflight fails. The judge
owns its existing bounded retry loop and disables nested SDK retries. EVS-05
checks distinct approved endpoints, cross-role substitution and a lookalike
host. Full deployed preflight and Studio structure identity evidence remain
part of T039/T040.

### Hobby-tier KPI threshold alignment & T036/T039/T040 closure (D24 / DEV-07, CC-09)

`packages/contracts/src/package-v1-4.ts` aligns `evaluateGateMetrics` with D24 (`hallucination_rate < 0.10`, `negative_rejection_rate >= 0.90`), preserving deterministic ID precision (`1.00`) and zero scoping leakage (`0`).

- **T036 retired**: `packages/contracts/src/scoped-context.ts` replaces `node:crypto` with an inline pure TypeScript SHA-256 helper (`sha256Hex`) verified bit-for-bit against Node `createHash("sha256")`, and `packages/contracts/package.json` removes the unused `"./*"` wildcard export. The 2 remaining `T036` exceptions in `scripts/architecture-policy.json` are removed (`90 -> 88` exact `T035` records).
- **T039 / T040 completed**: `DeterministicMindmapModel` and `DeterministicDataTableModel` expose explicit adapter identities recorded in `runStudioStructureDeterministicEval()` and `packages/evals/src/cli.ts`; chat and judge `D23` endpoints and regional embedding separation pass EVS-05 preflight; under `D24`/`DEV-07`, deterministic/PostgreSQL/Playwright verification satisfies Gate v3.0 without requiring a paid live judged campaign.

## Dependency PR #194 review — 2026-11-15 (CC-09)

Traceability: C-01..C-03, NFR-SEC-01/02, NFR-EVAL-02/04. Reviewer: Codex.
Reviewed dependency head: `221bb8048bd7e33413e7459b303fc393a3adaa59`, against `8c159515c52e04c0b926b328e11530dd0b4381fb`.

The patch changes Node type declarations only across the root, API, worker, render, cloud, notes and testkit manifests. Runtime imports, public exports and deployment wiring are unchanged. Node remains major 26.

Manual boundary review: PASS for this manifest/lockfile-only dependency delta. No workspace edge, public export, route/service responsibility, quota, transaction, cancellation or publication fence changes. Existing 90 exact D21 exceptions remain unchanged; this review does not close their removal tasks.

Automated evidence on the reviewed dependency head: [CI run](https://github.com/lukas-zech-software/everlast-lm/actions/runs/43524466716) passed typecheck, unit/contract, PostgreSQL integration, deterministic evaluation and Chromium journeys. The separate required Spec integrity run passed link/spec checks, all 39 architecture fixtures and the boundary scan (zero findings, 90 exact exceptions), then correctly rejected the missing changed-feature evidence. This review supplies that evidence without changing the checker or migration policy.

This is dependency maintenance evidence, not new feature implementation or release acceptance. No live cloud workload or judged release run is claimed.

## Tier-2 TypeScript Clean-Code Conventions & Lint Gates — 2026-11-26 (CC-09)

Traceability: C-01..C-03, NFR-EVAL-02/04, CC-09.

### Scope & Tooling
- Added dev-only formatting and static-analysis tooling in root `package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml`: `prettier`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`, `eslint-plugin-sonarjs`, `eslint-plugin-unicorn`, and `globals`.
- Added `.prettierrc.json`, `.prettierignore`, `eslint.config.mjs` (using `node:module` `registerHooks` to route `typescript-eslint` to the existing pinned `typescript-compiler` `6.0.2` while preserving TypeScript `7.0.2` as the application compiler), `docs/code-conventions.md`, and a reference in `CONTRIBUTING.md`.
- Wired `pnpm format`, `pnpm format:check`, `pnpm lint:eslint`, and `pnpm lint:eslint:fix` in `package.json`, and integrated Prettier + ESLint checks into `scripts/lint.mjs`.
- Applied Tier-2 formatting, Zod v4 API migrations (`z.uuid()`, `z.iso.datetime()`, `z.url()`, `"custom"`, `{ error }`), complexity/depth/parameter decompositions, and strict TypeScript narrowing across `apps/*` and `packages/*`, replacing the global `Response.json(): Promise<any>` override (`apps/api/test/studio-fetch-json.d.ts`) with typed `readJson<T>` in `apps/api/test/support.ts`.

### CC-09 Boundary Review
- **PASS (manual + automated)**: No new runtime dependencies, workspace package edges, cross-app imports, shared-to-app edges, or `packages/contracts` runtime dependencies were introduced.
- Preserved all C-01/C-02/C-03 schema semantics, authorization/snapshot checks, transaction atomicity, and public exports.
- Preserved all **88** exact `D21` (`specs/004-ui-skeleton-quality-gates T035`) legacy exceptions in `scripts/architecture-policy.json` without widening or modifying the policy (using `// prettier-ignore` on the 12 legacy import lines whose formatting or quotes would otherwise alter AST token fingerprints). Zero `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any` suppressions were added.

## Grill remediation: failure visibility — 2026-11-27 (CC-09)

Traceability: NFR-SEC-01, FR-GC-01, FR-SI-01, FR-SI-02, C-03, D16; grill report 2026-11-26 findings F5, F8a, F21, F22.

### Scope
- `packages/cloud/src/log.ts` (`@everlast/cloud/log`): `logFailure(scope, context, err, severity)` writes one structured line per failure, with IDs-only context, error name, message (≤ 500 characters), upstream status, cause and capped stack (NFR-SEC-01).
- `AppError` (`packages/contracts`) and `ModelUnavailableError` (`apps/api/src/chat/model.ts`) accept `{ cause }`. `sendError` and the chat SSE catch log 5xx AppErrors and unexpected errors; response bodies are unchanged.
- ADK sessions are deleted in `finally` for chat `generate()` and the code-correction `run()` (F21).
- `v2Pool()` fails closed with `V2PersistenceUnboundError`. The in-memory double needs the TEST-ONLY `allowV2MemoryStores()` opt-in, which the root `vitest.setup.ts` applies to every test file (F8a, D16).
- Under `K_SERVICE`, a missing worker URL or Document AI processor fails at startup, and `WORKER_POLL_MS` must be a positive integer (F22).
- Terminal transitions now log their cause: Studio runner, ingestion and sync attempts, Ready hooks, Source Guide dispatch and generation, render executions, and note-source ingestion (F5).

### CC-09 Boundary Review
- **Automated: PASS.** `pnpm check:architecture` reports 0 findings with the 88 `D21` exceptions unchanged, and `pnpm test:architecture` passes.
- **Manual: PASS.**
  - The only new workspace edges point to `@everlast/cloud/log`, from `apps/api`, `apps/worker`, `apps/render` and `packages/notes`, which already depend on `@everlast/cloud`.
  - `packages/contracts` gains no dependency.
  - Workflow, transaction, authorization, C-02 scope and publication-fence ownership are unchanged: the changes add logging and fail-closed guards only.
  - D16 execution placement is unchanged.

| SRS / contract | Module path, owner | Responsibility | Public exports / ports | Allowed consumers | Composition root | Regression evidence |
| --- | --- | --- | --- | --- | --- | --- |
| NFR-SEC-01 | `packages/cloud/src/log.ts`, @lukas-zech-software | Logging adapter | `logFailure`, `FailureSeverity`, `FailureContext` (`@everlast/cloud/log`) | api, worker, render, notes | n/a (pure function) | `packages/cloud/test/log.test.ts` LOG-01..07 |
| D16 | `packages/db/src/v2-persistence.ts` | Persistence selection (adapter) | `v2Pool`, `allowV2MemoryStores` (test-only), `V2PersistenceUnboundError` | `packages/db` v2 stores | `apps/api/src/v2/runtime.ts`, `apps/worker/src/studio/handler.ts` | `packages/db/test/v2-persistence.test.ts` V2P-01..05; unit, integration and e2e suites |
| FR-GC-01 | `apps/api/src/chat/model.ts`, `service.ts`, `routes/chat.ts`, `http.ts` | Model adapter, service, transport | unchanged | unchanged | `apps/api/src/server.ts` | `chat-session-cleanup.test.ts` CHAT-SESS-01..03, `http-send-error.test.ts`, `chat.test.ts` CHAT-LOG-01 |
| FR-SI-01, FR-SI-02, C-03 | `apps/worker/src/{studio/runner,ingestion/*,ready-hooks}.ts`, `apps/render/src/main.ts`, `packages/notes/src/note-sources.ts`, `apps/api/src/v2/runtime.ts` | Logging at terminal transitions | unchanged | unchanged | unchanged | `ready-hooks-logging.test.ts` LOG-HOOK-01, `studio-plugin-flow.test.ts` LOG-STUDIO-01, `job-notifier.test.ts`, `poll-interval.test.ts`, `ocr.test.ts` CFG-03/04 |
