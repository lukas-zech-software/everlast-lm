# Implementation Plan: Studio Mindmaps & Data Tables

**Branch**: `codex/v3-refresh2-3-3-20261021` | **Date**: 2026-10-21 | **Spec**: [spec.md](spec.md)
**Package Source**: `spec/requirements/v3/package_3_3_studio_structure_data_extraction_mindmaps_tables.md`
**SRS IDs in Scope**: `FR-ST-08/09/18`, `C-01/C-02/C-03`, `FR-SI-03/05`, `FR-GC-01/02/06`, `NFR-SEC-01/02`, `NFR-EVAL-01..04` | **Release Gate**: Gate v3.0 #3

## Summary (`FR-ST-08/09/18`, `C-03`)

Add independent `mindmap` and `data_table` plugins to the existing Studio registry and lifecycle. Code orchestrates scoped structured Gemini generation, validates structure and every factual citation, then atomically publishes a typed payload. A deterministic SVG viewer supplies map navigation, guarded node-to-chat drilldown and SVG/2× PNG downloads. Tables preserve individually cited conflicting values, missing-evidence cells and safe CSV/XLSX downloads. No tasks or implementation are produced by this plan.

## Technical Context (`C-01..C-03`, `NFR-SEC-01/02`)

**Language/Version**: TypeScript 5.x strict ESM, Node.js 24, pnpm workspaces; existing browser DOM/SVG modules.
**Primary Dependencies**: Existing shared Zod schemas, `@google/genai`, Cloud Tasks/Cloud Run; select ExcelJS as an XLSX serialization library during implementation with a locked reviewed version. No new UI/agent framework. CSV and SVG serializers remain deterministic TypeScript; browser Canvas produces PNG.
**Storage**: Main `dc25c46` includes applied migration `0008_studio_artifacts.sql` and `PostgresStudioArtifactRepository`; specs/013 has closed DEV-04 for all v2 stores. Extend that existing report table/repository with typed plugin variants and an additive next-numbered migration for kind/subtype constraints and durable dispatch/lease fencing; do not recreate storage or edit applied0005–0008. Existing row-locked transitions and retry records are reusable; admission outbox, worker leases and atomic source/attempt publication remain planned. Private Cloud Storage remains optional for export bytes with authorization-checked delivery. No new datastore or always-on component.
**Authentication & Residency**: Identity Platform generic OIDC/SAML; owner-only v3, notebook/document authorization; enterprise no-training model endpoint in `europe-west4`; region exception: None. Browser rendering uses already-authorized data and performs no external font/image fetches.
**Execution Model**: Deterministic pipelines with schema-constrained Flash-tier model calls, not ADK agent loops. Existing grounded-chat agent handles a successfully authorized drilldown. Use the smallest approved model meeting quality/timing; no silent tier escalation.
**Testing**: Vitest unit/contract/integration and deterministic/LLM-judged evals; Playwright navigation/download/performance coverage. Existing generic runners exist, but package-specific suites, integrated deployment and timing/eval results are UNAVAILABLE at planning time.
**Performance Goals**: Mindmap submission-to-Completed ≤20.0s P95 on declared fixtures (includes queue/model/validation/persistence); ≤16ms frames and 60fps target on declared browser/hardware for up to120 nodes. No invented table latency target. Drilldown reuses standard chat validated-answer TTFT contract; package3.4 owns integrated benchmarks.
**Constraints**: Map target depth2–5,15–120 nodes, labels≤80 trimmed Unicode code points; expand depth2 initially. Table targets2–25 columns,1–500 rows; prompt0–2,000 trimmed code points. Evidence-limited lower counts need explanation; zero evidence refuses. Any requested comparison requiring>500 rows or>25 columns fails, no table. C-01 byte/word quotas and multimodal locator union remain unchanged.
**Within-Release Prerequisites**: Package3.1 C-01 adapters, v1 C-02/chat/citation consumers, v2.1 language preferences and v2.4 C-03 registry/lifecycle. Package3.2 completed planning is inherited in lineage, but map/table generation does not require executing code. Gate v2.0 is owner-approved override per `docs/gate-v2-live-evaluation.md`; post-fix live re-run was not executed and approval is not measured acceptance. Preserve the override and pending follow-ups; no v3 implementation/deployment occurs here. R6 sandbox qualification remains pending for3.2; it is not waived or claimed here.

## Constitution Check (`CC-01`..`CC-08`)

Statuses assess design compliance, not runtime evidence. Pre-research review occurred before Phase0; post-design review covers the artifacts below.

| Gate | Principle | Pre-Research | Post-Design | Evidence |
| :--- | :--- | :--- | :--- | :--- |
| CC-01 | Traceability | PASS | PASS | Each design area cites SRS IDs; package card/spec and architecture record refinements including D16/specs/013 storage reuse and remaining Studio delivery durability; no release scope changes. |
| CC-02 | Test-first | PASS | PASS | Test strategy below mandates spec-derived Red before implementation, Green then refactor; no tasks generated here. |
| CC-03 | Scope/snapshot | PASS | PASS | C-02-only reads; explicit Ready selection and exact snapshot, recheck before publication; contracts document all reads. |
| CC-04 | Citations/leakage | PASS | PASS | Validate every factual map field/table alternative; no retry or stripped publication; drilldown preflight precedes text construction; exports reauthorize. |
| CC-05 | Contracts/pipelines | PASS | PASS | Additive C-03 plugin variants in shared contracts only; preserve report API/schema/plugin behavior; deterministic bounded evidence processing. |
| CC-06 | Release/order | PASS | PASS | Recorded Gate v2 owner override retained without claiming a live pass;3.1 before consumers;3.4 benchmarks integrated result; deferred packages excluded. |
| CC-07 | Security/residency | PASS | PASS | Owner-only; notebook/document ACLs; EU enterprise endpoint; invalidation; no source creation or slot reservations introduced. |
| CC-08 | Platform/cost | PASS | PASS | Existing TypeScript/Cloud Run/Cloud SQL; native SVG/Canvas and XLSX library add no new framework, API or fixed idle cost. |

## Project Structure & Ownership (`C-03`, `FR-ST-08/09/18`)

Feature artifacts: `refresh-report.md`, `checklists/studio-structure.md`, `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/interfaces.md`, `quickstart.md`, existing `checklists/requirements.md`. `tasks.md` belongs to the next workflow stage.

Intended implementation boundaries (paths are planned, not created here):

| Area | Owned paths / shared integration |
| :--- | :--- |
| Contracts | `packages/contracts/src/package-v3-3.ts` for payload/DTO validation; serialize compatible extension of `src/package-v2-4.ts` and `src/index.ts` before consumers. |
| Persistence | Extend `packages/db/src/studio-artifacts.ts` / `PostgresStudioArtifactRepository`; add a new numbered ALTER migration after existing migrations to widen valid plugin/subtype pairs and add dispatch/lease/version state. Preserve applied `0008_studio_artifacts.sql`, existing rows, IDs, payloads, attempt/retry_of and ordering. Extend `packages/db/src/jobs.ts`/outbox kind constraints compatibly for Studio identifier-only delivery atomic with new-kind admission. |
| Worker | New `apps/worker/src/studio/mindmaps/` and `tables/` plugins/pipelines; reuse report batching/citation/context ports through common helpers, preserve report plugin files/behavior. Registry/bootstrap and common job runner extensions are serialized. Replace report-only validation dispatch in `studio/runner.ts` with registered typed validation while retaining report validation as its plugin strategy. Extend existing row-locked lifecycle transitions with durable claim/lease/version fencing for new-kind recovery; AbortControllers remain local interruption helpers. |
| API | Extend `apps/api/src/routes/studio.ts`, `studio/service.ts` and actual composition `apps/api/src/v2/runtime.ts`; move durable execution wiring to `apps/worker/src/server.ts` and shared `studio/dispatcher.ts` adapter. Current InlineStudioDispatcher runs in the API process, not an existing durable Studio worker. Add guarded export/drilldown and a new authenticated cancel action for new plugins (v2 report route has no cancel action); preserve report routes. Reuse `apps/api/src/chat/service.ts` request-bound C-02, admission, history, verifier and SSE serialization. |
| Web | Extend `apps/web/src/studio/api.ts`, `artifact-list.ts`; new `mindmap-viewer.ts`, `mindmap-layout.ts`, `mindmap-export.ts`, `table-viewer.ts`; reuse chat controls and citation navigation. |
| Tests/evals | Package3.3 contract tests, DB migration/integration tests, API/worker/web suites and golden cases under `packages/evals`; Playwright browser scenarios. |

No ingestion, sandbox implementation, v4 renderer, new infra service or v6 roles are owned here. Initial v2 persistence is already delivered by specs/013 (D16, DEV-04 closed). This package owns only Studio typed variants and remaining durable dispatch/fencing;3.1 owns its remaining Guide refresh lifecycle, and other v2 stores are reused. Keep shared integration edits serialized with prerequisites and retain report contract/behavior regression suites.

## Phase0 Research (`FR-ST-08/09/18`, `C-03`)

[research.md](research.md) resolves contract extensibility, evidence merging, safe export and rendering choices. Research was performed inline because orchestration requires one active package agent and forbids nested agents. All technical choices fit existing architecture. No unresolved product clarifications remain.

## Phase1 Design (`FR-ST-08/09/18`, `C-01..C-03`)

[data-model.md](data-model.md) defines typed payloads and evidence, [contracts/interfaces.md](contracts/interfaces.md) defines user/API/plugin boundaries, and [quickstart.md](quickstart.md) defines validation prerequisites and scenarios.

1. Extend shared typed contracts and existing PostgreSQL Studio storage additively, widening report-only kind/subtype constraints through a new migration. Preserve report wire shapes, validators and plugin implementation. A consumer discriminates `plugin_type` before parsing payload or offering actions. New generic job plumbing delegates to registered validators; it never treats a mindmap as report Markdown. Existing exported report schemas remain valid. This is intended C-03 extension, not a breaking C-01/C-02 change.
2. Snapshot scope and effective language at submission; atomically persist queued artifact/attempt plus durable delivery outbox through C-03. Delivery failure after commit is recovered; transport retries target the same attempt and never rerun a terminal citation failure. User retry creates a fresh attempt. For new plugin attempts, worker claim leases and attempt/version fences permit recovery after a crash without double publication; cancellation is durable. Preserve legacy report restart behavior: interrupted Queued/Running reports become Failed/GenerationError and require explicit retry, not automatic resumption. Before admitting new durable plugin jobs, narrow the existing startup sweep to legacy report rows so it cannot fail live leased attempts; fence/drain old inline processes during rollout. Do not enable additional API instances under the retained D16 single-instance limit. Recheck live source ownership/revisions transactionally with Completed publication so source mutation/deletion cannot race a separate check. API and worker share the PostgreSQL adapter; initialize each background entry with its app-scoped `runWithV2Persistence(pool, ...)` context (or explicit injected pool), preserving isolation across app instances. Ownership already resolves from PostgreSQL through `getNotebookOwner`; carry captured owner/revisions rather than recapturing scope. Read all-original evidence through the captured owner-bound C-02 snapshot; retain existing `listAllSnapshotChunks` keyset traversal initially and add bounded streaming behind the C-02 port where required. Do not replace this with current chat top-k retrieval or recapture a newer source revision. Worker obtains all original scoped chunks through C-02, bounded map-reduce if necessary (D12), retaining chunk IDs and a coverage manifest so missing batches fail. Source Guides are optional routing aids. Merge candidate facts/entities before the final shape validation, detecting required row/column overflow rather than truncating.
3. Validate rooted tree/depth/counts/labels and complete factual references, or rectangular table/key uniqueness/cell variants/citations. Failed validation publishes no payload; invalid citations refuse immediately without silent model retry. Factual root/category labels and summaries require evidence too; purely structural decoration is labelled illustration. Recheck exact revisions/access at atomic Completed publication; cancellation or invalidation wins the fence.
4. Viewer lays out currently expanded nodes deterministically; transform one SVG group for pan/zoom and animate bounded changed branches. Export uses full expanded-tree bounds independent of viewport pan/zoom, safe escaped SVG text and locally rendered2× PNG. Accessible controls distinguish chevron from body action.
5. Guard drilldown server-side using artifact/node identity, current explicit selection and parent/node provenance before constructing any node-derived prompt. Missing supporting revisions prompt selection; no implicit source selection. Reuse normal chat history filtering, citation validation and single-active-request rejection preserving draft.
6. Serve table exports with current access/provenance checks, deterministic row/column order and individually cited conflicts flattened as text; CSV uses UTF-8 BOM, RFC4180 CRLF/quoting and apostrophe escape for formula-risk cells, XLSX emits explicit strings and no formulas/macros/external links. Apply sanitization to headings and item labels too. Sort changes presentation only, never persisted factual values or citations.

## Test Strategy & Release Evidence (`CC-02`, `FR-ST-08/09/18`, `NFR-EVAL-01..04`)

Derive failing tests from every spec FR001–017 and SC001–011 before implementation; use schema-valid UUIDv7 chunks instead of symbolic IDs. Coverage matrix:

| Tests first | Governing requirements / outcomes |
| :--- | :--- |
| Contract/tree fixtures | FR001–004/013, SC001–004: cyclic/orphan/duplicate/root/depth/120/121 and80/81-code-point boundaries;15-node target with evidence exception;2× export and25 visible labels. |
| Table model/export | FR007–009/013/015/016, SC005/006/009/010:3 vendors;missing attributes;conflicting alternatives;500/501 rows,25/26 cols;0/2,000/2,001 prompt;quotes/commas/CRLF/BOM/formula prefixes including whitespace/control prefixes. Parse CSV with independent parser and XLSX with independent OOXML reader/application; assert no formula elements/external links. |
| Scope/security/lifecycle | FR005/006/010–012/014, SC007/008: no scope/foreign source/stale snapshot, access revocation/deletion races, invalid citation refusal, cancel/retry/redelivery fencing, historical deselection versus new prompt, exports and cache invalidation, restart/worker-crash/outbox notification loss, concurrent claim recovery, cancellation versus completion fences and regression of report lifecycle/conversion and consumers (FR017/SC011). |
| Browser/performance | FR004–009, SC002–005: pan/zoom/fit/collapse/body action,120-node frame captures, full-bounds25-node PNG/SVG, sortable cited/conflicting cells, downloaded files, persisted grounded drilldown; declared hardware/browser/dataset/percentile/sample method. |
| Evals | NFR-EVAL-02 citation ID validity1.0, EVAL-04 leakage0 each PR; EVAL-01 hallucination<5%, EVAL-03 rejection≥99% and semantic support once per release candidate on the fixed stratified50-case sample, retaining case IDs/category composition/dataset hash; additional diagnostic runs are optional and never substitutes. Cover multimodal locators, ≥50-source maps and original-chunk coverage. |

Use the quickstart to distinguish runnable generic checks from future feature suites. Package timing/export quality and full Gate v3.0 remain unproven until implemented and measured; do not infer their success from spec integrity.

## Complexity Tracking (`C-03`, `CC-05/08`)

D16/specs/013 closes DEV-04 and supplies durable v2 data while retaining one API instance and in-process v2 jobs. This plan reuses that baseline and preserves report interrupted-to-Failed semantics; durable new-kind delivery and lease/source publication fencing remain explicit work. No new constitution violation or architecture deviation is introduced. More API instances require a recorded D16 change and proven recovery/ownership isolation first. Report-specialized C-03 plumbing needs additive extension; any breaking contract, new framework, datastore or region exception requires the prescribed amendment.
