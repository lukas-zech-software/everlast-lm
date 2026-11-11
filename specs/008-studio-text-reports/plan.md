# Implementation Plan: Studio Text Synthesis & Reports

**Branch**: `008-studio-text-reports` | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)
**Package Source**: `spec/requirements/v2/package_2_4_studio_text_synthesis_reports.md`
**SRS IDs in Scope**: FR-ST-10, FR-ST-11, C-02, C-03, NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-04, NFR-SEC-02, FR-NM-03 (conversion reuse), FR-SI-02 (Source Guide input) | **Release Gate**: Gate v2.0 #3 (contributes, does not independently satisfy Gate v2.0)
**Input**: Feature specification from [spec.md](spec.md) (clarified 2026-10-18) and [binding cross-package rules](../../spec/requirements/README.md).

## Summary

Package 2.4 introduces **C-03 `StudioGeneratorPlugin`** (one shared Zod/TS definition in `packages/contracts`, `D2`) with the `StudioPluginRegistry` and the unified `Queued → Running → Completed | Failed | Cancelled` lifecycle, and ships the first plugin: `report` with six subtypes (`briefing_doc`, `study_guide`, `faq`, `timeline`, `dynamic`, `custom`) for FR-ST-10/11. Reports are **deterministic pipelines** (Constitution IV, no ADK `LlmAgent` loop): bounded map-reduce batches over **all** scoped C-01 chunks obtained only through `C-02 getScopedContext` (`D12`), an injectable structured-output model client (the Vertex AI Flash report adapter `apps/worker/src/studio/reports/vertex-model.ts` and the Flash-Lite suggestion adapter on the Package 2.2 structured-generation client, both wired from `apps/api/src/server.ts`; `DeterministicReportModel` remains only for tests, evals and unconfigured local runs, `NFR-SEC-01`), pre-publication citation validation (`D13`), and submission-time `(source_id, revision)` snapshots with access re-checks before reading and before publishing. Delivery slices: contracts → in-memory repository (D16) → worker runner/registry → report generators → API routes (mounted in `apps/api/src/v2/runtime.ts`) → web Studio panel (`apps/web/src/studio/panel.ts`).

## Technical Context

**Language/Version**: TypeScript 5.x (strict, ESM) on Node.js 24 (`pnpm` workspaces)
**Primary Dependencies**: Zod (`packages/contracts`); `@google/genai` (already a worker dependency) behind the `ReportModelClient` interface. **Model routing**: reports use Vertex AI **Flash** (`gemini-2.5-flash`, the `createGroundedModelFromEnv` default) through `VertexReportModel`, which reuses the Package 2.2 `VertexStructuredGenerationClient` setup (`[006-source-guide-chat-control] T075`); dynamic suggestions use **Flash-Lite** through the same Package 2.2 client. Both `europe-west4`, keyless ADC, no `GEMINI_API_KEY`/`GOOGLE_API_KEY`. *Owner default 2026-10-20:* reports use Flash only; the architecture's "Pro for long reports" waits until "long report" is defined. *Latency settings (live Gate v2.0 fixes 2026-10-20, FR-ST-10 / Gate v2.0 #3):* every report call (extract and compose) sends `thinkingConfig: { thinkingBudget: 0 }` (thinking off on `gemini-2.5-flash`; the default dynamic thinking gave P95 28.4 s live) and `maxOutputTokens: 8192` (`REPORT_GENERATION_CONFIG`), via an optional per-call `generationConfig` on the shared `generateStructured`; Source Guide, overview and follow-up calls are unchanged. The map step runs up to 4 extract batches in parallel over batches of ≤ 8 chunks / 4,000 tokens (research R2). *Live Gate v2.0 #3 fixes 2026-10-22 (T066–T069):* the reduce step composes each required section group in a parallel call (Study Guide questions and answer key stay together); compose items reference findings by index, and the adapter copies the finding's chunk, quote and date, so evidence stays verbatim; extract drops findings whose quote or date is not literal in their chunk; transient upstream failures (429/5xx) get up to two transport retries, which is not a citation retry (FR-014).
**Storage**: D16 / SRS DEV-04 proof of concept: Studio artifacts live in `InMemoryStudioArtifactRepository` inside the single API process ("persisted" = kept by the running API instance); jobs run there through `InlineStudioDispatcher`. The designed table waits in `packages/db/migrations/v3-draft/` (not applied). Source content is read only through the PostgreSQL C-02 path; Studio jobs read **all** snapshot chunks with the keyset-paged `listAllSnapshotChunks` (D12), while chat, Source Guide and Note Assistant keep their bounds.
**Authentication & Residency**: Identity Platform OIDC (`D6`); EU `europe-west4` (`D3`) — **no region exception**. Model endpoints are enterprise Gemini only (`NFR-SEC-01`); the fake model never leaves the process.
**Testing**: Vitest (contract, db, worker, api, web unit/integration, deterministic evals `NFR-EVAL-02/04`). Playwright E2E: `apps/web/test/studio-reports.spec.ts` against `apps/web/test/e2e-server.ts` (deterministic report model, real PostgreSQL). LLM-judged suites (`NFR-EVAL-01/03`) require a live model: `UNAVAILABLE` here, required before Gate v2.0.
**Execution Model**: Deterministic pipelines only (reports, dynamic suggestions). No ADK `LlmAgent` loop; model calls are fixed steps (map → reduce) with structured outputs.
**Performance Goals**: Standard templates P95 ≤ 25.0 s (FR-ST-10, Gate v2.0 #3); dynamic suggestions ≤ 3.0 s, cached per source-set identity (FR-ST-11). Suggestion calls are hard-bounded by a 3,000 ms timeout.
**Constraints**: Owner-only (v2.0); explicit non-empty `active_source_ids` (never an all-sources fallback); no cancel action in v2 (`Cancelled` stays a C-03 state); every required section non-empty (Timeline no-dated-events exception only); the effective output language is resolved server-side when omitted (`FR-UI-02`); custom prompt 1–5,000 Unicode code points after trimming, no truncation; retry = new attempt with a fresh explicit scope; Markdown only (no PDF/DOCX export).
**Within-Release Prerequisites** (`spec/requirements/README.md`): 2.1 language preference precedes language-sensitive generators (consumed as an optional `output_language` string that is part of cache keys); 2.4 defines C-03; Source Guide (FR-SI-02) is consumed through the `SourceGuideProvider` interface and is asynchronous; FR-NM-03 note/source conversion is consumed through a `ConvertToSource` port; C-01/C-02 are reused from `packages/contracts` (`document-chunk.ts`, `scoped-context.ts`).

## Constitution Check (`CC-01`..`CC-08`)

| Gate ID | Principle | Pre-Research Status | Post-Design Status | Verification Evidence / Notes |
| :--- | :--- | :--- | :--- | :--- |
| `CC-01` | **I. Traceability** | PASS | PASS | Every design element below and every task cites FR-ST-10/11, C-02/03, NFR-*. Plan refinements (C-03 shape, retry semantics, suggestion states, failure codes) are flowed back into [spec.md](spec.md) (§Plan Refinements) and the FR card (edge cases) before implementation. |
| `CC-02` | **II. Test-First** | PASS | PASS | [tasks.md](tasks.md) places Red tests before implementation in every phase, covering all Gherkin scenarios, the 1/5,000/5,001 prompt boundaries, 3–4 suggestions, 3.0 s and 25.0 s targets. |
| `CC-03` | **III. Scope & Snapshot** | PASS | PASS | Reads only via `ScopedContextProvider.getScopedContext` (C-02) with explicit IDs; snapshot captured at submission; `StudioAccessVerifier` runs before read and before publish; chunk revisions compared with the snapshot (no silent substitution). |
| `CC-04` | **III. Citations & Leakage** | PASS | PASS | `validateReportCitations` (D13, NFR-EVAL-02): every cited `chunk_id` ∈ scoped chunks with matching source/revision, verbatim quotes and dates must occur in cited chunk text; failure → `Failed` with refusal, no stripped draft, no retry; leakage = 0 via scope-only reads (NFR-EVAL-04); artifact reads of deleted/revoked snapshots return an unavailable placeholder. |
| `CC-05` | **IV. Contracts & Pipelines** | PASS | PASS | C-03 defined once in `packages/contracts/src/package-v2-4.ts`; deterministic pipelines; plugin added without modifying existing plugins (open-closed registry). |
| `CC-06` | **V. Release & Package Order** | PASS | PASS | v2.0 package; excludes FR-ST-12, mindmaps, tables, flashcards, quizzes, slides, audio/video, PDF/DOCX export, template uploads; no deferred item (`D5`, `D8`, `D10`) touched. Gate v1.0 is a prerequisite for *running* v2 implementation in a release; this tree already contains the v1 baseline. |
| `CC-07` | **VI. Security, RBAC & Residency** | PASS | PASS | Owner-only server-side checks in API and runner (NFR-SEC-02); enterprise no-training Gemini only (NFR-SEC-01); `europe-west4`; no quota slot logic here beyond the FR-NM-03 conversion port that reserves slots atomically. |
| `CC-08` | **Platform & Cost** | PASS | PASS | pnpm TS monorepo; D16: jobs run in the single API process (`InlineStudioDispatcher`), artifacts in memory until v3; no new framework, datastore or idle-cost resource. |

## Project Structure

### Documentation (this feature)

```text
specs/008-studio-text-reports/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/interfaces.md  # Phase 1 (C-03 + HTTP/port contracts)
├── checklists/          # requirements.md, studio-reports-gates.md
├── tasks.md             # /speckit-tasks
└── analysis.md          # /speckit-analyze
```

### Source Code (exact file boundaries owned by this feature)

```text
packages/contracts/src/package-v2-4.ts     # C-03 + report DTOs (single new file)
packages/contracts/src/index.ts            # ONE added export line (serialized shared file)
packages/contracts/test/package-v2-4.test.ts
packages/db/migrations/v3-draft/           # designed table, not applied (D16)
packages/db/src/studio-artifacts.ts        # repository interface + in-memory implementation (D16)
packages/db/src/scoped-context.ts          # listAllSnapshotChunks (keyset-paged, D12)
packages/db/src/index.ts                   # ONE added export line
packages/db/test/studio-artifacts.test.ts, studio-artifacts-schema.test.ts
apps/worker/src/studio/runner.ts           # job runner (lifecycle, snapshot, validation)
apps/worker/src/studio/reports/{templates,batching,model,deterministic-model,vertex-model,pipeline,render,validation,plugin,suggestions}.ts
apps/worker/src/package-v2-2-gemini.ts     # Package 2.2 Vertex client, extended with report suggestions
apps/worker/test/studio-*.test.ts, studio-fixtures.ts
apps/api/src/routes/studio.ts, apps/api/src/studio/service.ts, apps/api/src/v2/runtime.ts (Studio section), apps/api/src/server.ts (report model wiring)
apps/api/test/studio-*.test.ts
apps/web/src/studio/{api,reports-modal,artifact-list,markdown,panel}.ts
packages/evals/src/studio-gate.ts          # Gate v2.0 #3 deterministic case set
apps/web/test/studio-*.test.ts
```

**Structure & File Ownership Decision**: This feature owns only the paths above. Shared files touched with a single added line each: `packages/contracts/src/index.ts`, `packages/db/src/index.ts`. `apps/api/src/v2/runtime.ts` composes the package (D16); `apps/api/src/server.ts` passes the Vertex report model under the same Vertex-configured condition as the grounded chat model. Managed `.specify/templates/*.md` and speckit skills are untouched.

## Complexity Tracking

No constitution exception and no new `Dn`/`DEV-xx`. Recorded design choices (see [research.md](research.md)): R1 plugin shape, R2 map-reduce batching, R3 citation/quote/date validation, R4 retry semantics, R5 suggestion states and cache key, R6 injectable model client.


## On-demand Guide admission refinement (2026-11-07; FR-SI-02, FR-ST-11, NFR-SEC-02)

The recorded owner decision of2026-11-05 supersedes the older T061 deferral.
Newly admitted on-demand language variants share a per-notebook maximum of two
concurrent runs and twenty starts in a rolling one-hour window, both configurable
as positive integers. Ordinary Ready-transition ingestion bypasses this ledger.
Repeated requests for the same source/revision/language reuse existing Guide or
active admission without charging again, including at the limit. Failed admitted
starts remain in the hourly population; terminal completion releases concurrency.
Admission serializes under the existing owner→notebook→source lock order and
revalidates Owner/Ready revision before allocating. Startup recovery in D16's
single API instance releases orphaned admissions while retaining their start times.
A quota-limited Guide request receives429/GuideAdmissionLimited; report suggestions
explain temporary unavailability without disabling standard/custom reports.
No provider/model latency threshold changes or new datastore are introduced.


Primary-language Guide reads reuse the ordinary Ready dispatcher, including its
in-flight identity deduplication, and do not allocate extra-language admission.
A failed database slot-release write leaves capacity occupied (fail-closed) until
D16 startup recovery; it does not admit extra work or reset the hourly count.
Closed admission metadata older than the rolling hour may be pruned during
admission; active and in-window failed starts are retained.


Primary identity is frozen in `guide_primary_languages` per source/revision before
any on-demand admission. Bootstrap existing revisions from an existing Guide
(preferring Ready-origin metadata). Subsequent notebook/user language changes
never redefine primary identity: a new language variant is charged, including
when it now matches the mutable preference. This also prevents a seen Ready
dispatcher from leaving the changed-language request permanently Pending.


## Architecture Boundary Evidence — CC-09 (2026-11-09; FR-SI-02, FR-ST-10/11, C-02/C-03)

Resumed base 3d02a51 includes Constitution 2.1.0, canonical D21 guardrails and current
Node 26 / TypeScript 7 / pnpm 12 / Vitest 5.1 dependencies. Earlier in-memory/persistence
planning paragraphs are historical: D16/specs/013 persist v2 data in PostgreSQL with
one API instance. This slice changes the Guide-admission test fixture and 008
artifacts/evidence only. Migration 0012 and production behavior are inherited unchanged.

Pre-research assessment: FAIL until the missing 008 boundary inventory and forbidden
new fixture edge are resolved. Post-design manual review: replace only the concrete
worker suggestion fixture with a local structural double typed by ReportSuggestion
from @everlast/contracts. No new cross-app type import, helper export, public
export tree, exception, workflow extraction or execution-placement change is proposed.
Characterization covers the old test before the fixture changes.

| SRS / contract | Actual module path and owner | Responsibility | Public exports / ports | Allowed consumers / dependencies | Composition root | Regression evidence |
| --- | --- | --- | --- | --- | --- | --- |
| FR-SI-02, FR-ST-11, NFR-SEC-02 | apps/api/test/guide-admission.integration.test.ts;008 test owner | Held Guide and fixed valid three-suggestion doubles; no production workflow | Public @everlast/contracts ReportSuggestion; public @everlast/db/testing seedReadySource; local startNotesApi | API-local fixture uses contracts and DBtesting only; no worker implementation/type import or helper re-export | This test's beforeAll injects doubles through existing runtime options | Same two mounted API cases before/after:2 concurrent, quota429, dedup, ordinary exclusion, primary polling and preference changes, standard report 202 |
| FR-SI-02, FR-ST-11, NFR-SEC-02 | packages/db/src/guide-admission.ts and migrations/0012_guide_admission.sql;008 persistence owner | Owner/Ready revision validation, SQL locking, primary-language identity and atomic ledger mutation | admitOnDemandGuide, claimPrimaryGuideLanguage, finishOnDemandGuide, recoverOnDemandGuides via explicit @everlast/db root | API runtime consumes named root exports; adapter uses canonical contracts, pg and module-local transaction/notebook helpers | apps/api/src/v2/runtime.ts injects pool/config and invokes adapter; deployment migration runner applies 0012 | packages/db/test/guide-admission.integration.test.ts: concurrency, dedup, rolling hour/failed starts/restart, configurable limits, foreign/stale rejection without HTTP |
| FR-SI-02, FR-ST-11, C-02 | apps/api/src/routes/package-v2-2.ts and v2/runtime.ts;API transport/runtime owner | Route parses language/revision, awaits startGuide and maps status; runtime coordinates primary/admission/dispatch/final release | PackageV22ApiDependencies.startGuide; StructuredGenerationClient/Ready dispatcher are unchanged legacy worker ports | Route uses local service/dependency inputs and canonical contracts; runtime DBroot calls stay unchanged; cross-app worker imports remain exact D21 debt | apps/api/src/server.ts wires runtime/config/model; runtime remains current lifecycle/composition owner | apps/api/test/guide-admission.integration.test.ts and v2-restart.integration.test.ts: polling race, primary identity, quota/failure/recovery |
| FR-SI-02, FR-ST-11, NFR-SEC-02 | apps/api/src/config.ts and server.ts;API configuration/composition owner | Parse positive integer 2/20 defaults and wire GuideAdmissionLimits | loadGuideAdmissionConfig and V2RuntimeOptions.guideAdmission; no new public export | Config uses contracts/Node env; server composes existing adapters under unchanged D21imports | apps/api/src/server.ts | apps/api/test/guide-admission-config.test.ts and scoped typecheck: invalid bounds/default/configuration behavior |
| FR-ST-10/11, C-03, NFR-EVAL-02/04 | apps/api/src/studio/service.ts;008 service owner;apps/worker/src/studio/runner.ts and studio/reports/suggestions.ts;existing workflow owners | StudioService coordinates access/job admission; runner validates/scopes/publishes; suggestions reads Guide port and validates suggestion output | StudioAccess, StudioJobDispatcher, StudioArtifactRepository, StudioSuggestionsPort; worker ReportSuggestionModel.suggest stays adapter-side legacy interface | Current service consumes canonical contracts/repository/ports; worker pipeline/model consumers unchanged; no API fixture imports worker interface | apps/api/src/v2/runtime.ts wires repository/registry/runner/suggestion service | apps/api/test/studio-runtime.integration.test.ts, v2-restart.integration.test.ts, apps/worker/test/studio-vertex-report-model.test.ts: complete scoped reads, revoked publication, report conversion, adapter validation and retries |
| FR-SI-02, FR-ST-10/11 | apps/api/test/notes-pg-support.ts;existing API integration harness owner | Disposable DB/API/worker setup, local storage and injected runtime options | Existing local startNotesApi only; no new export or extra worker usage | Existing createWorkerHandler import is exact unchanged D21 debt; do not re-export worker models/types through helper | Existing harness constructs createV2Runtime/createWorkerHandler as before | The six-file 51-test characterization/finalrun uses this unchanged harness |

**Workflow ownership (manual):** API authentication/route dependencies authorize the
caller and resolve requested language/revision. The current runtime's startGuide
coordinates frozen primary identity, quota admission, dispatch and final slot
release; its Ready watcher handles ordinary ingestion and startup sweeps. This
runtime contains existing orchestration as well as composition; calling it a
composition root does not certify it as pure wiring or complete R1/R2 extraction.
The DB adapter owns owner→notebook→source locking, rollback, dedup, quota reservation
and primary/ledger SQL. Runtime dispatch/terminal completion owns slot release; a
failed release stays fail-closed until single-instance recovery. Guide generation
uses C-02 plus snapshot/access checks before reads/publication. StudioService owns
job/authorization coordination through injected access/repository/dispatch ports;
runner/plugin owns required-section/citation validation and publication fencing.
Existing runner cancellation responsibilities/C-03 states stay unchanged; this slice
adds no v2 report cancel action. No workflow responsibility moves into a route or
fixture, no infrastructure client is added, and no simple-CRUD forwarding layer
is introduced. Service/adapter behavior remains testable without HTTP where its
existing ports permit; the admission adapter has direct PostgreSQL tests.

**Exact unchanged migration debt:** [legacy-exceptions.json](evidence/cc09-20261109/legacy-exceptions.json)
records the inspected runtime/server/old runtime-test/helper/manifest edges. Each
retains baseline 13e76bd5229af7d52146456297e1aa92a220908d, accountable owner
@lukas-zech-software, D21, expiry 2027-02-05 and qualified 004 T035 (R1) or T036 (R3)
removal task. They describe current placement/dependency debt, not permission to
copy worker imports or certify all legacy workflow ownership. No entry is added,
changed, widened or renewed. Existing notes-pg-support worker use remains byte-for-byte
unchanged. The newly forbidden Guide fixture import has no exception and must go.

**Checks and applicability:** run graph with --base-ref origin/main, scoped 008
artifact validation, six focused Guide/runtime/restart/report-adapter files, type
and spec/diff checks. Record global 009 artifact failures separately. The inherited
001evidence/cc09-20261109checker fixtures 39/39, build and deterministic citation 160/160 / leakage 0
remain applicable because no checker/build/product/model/schema/config implementation
changes here; the affected API fixture is rerun on current dependencies. Manual
PASS labels ownership review only and cannot replace graph/artifact checks.

## Report deadline and D23 route — CC-09 (2026-11-11; FR-ST-10/11, C-02/C-03)

The Gate v2.0 #3 failure in the saved judged run names the Study Guide,
three provider 504s, 3/4 validity, and P95 64,536.1 ms. It lacks per-operation
timing. The local hypothesis is that three full 20-second attempts plus
1- and 3-second backoffs compound one model deadline. Inject a full-duration
504 and compare with a fast transient error before changing retry dispatch.
Keep the per-attempt transport timeout, retry count limit, and P95 acceptance
threshold. Disallow starting another attempt when the backoff cannot fit in
the original attempt window. Record phase, template, attempt and elapsed
time without source text, generated content or cache handles.

| SRS / contract | Module and owner | Responsibility | Public ports | Dependencies and composition | Regression |
| --- | --- | --- | --- | --- | --- |
| FR-ST-10/11, C-02/C-03, NFR-SEC-01 | apps/worker/src/studio/reports/vertex-model.ts; report adapter | Bounded retry dispatch, structured output and evidence validation, route-derived cache and token identity | Existing ReportModelClient, D23 StructuredGenerator from the public cloud root after integration | Worker report factory owns adapter construction. Use the existing worker-local SDK adapter on the prepared branch and the committed 003/006 public cloud exports on the integration branch. Preserve runner/plugin publication and Guide admission. | SDK doubles distinguish fast transient retry from full-duration 504, retain terminal failed artifact, verify EU Flash/LOW generation and native count/cache identity. |

No new cross-application edges, public exports or policy exceptions are needed.
Retain the existing D21 records described above. Manual CC-09 review includes the
actual final diff and confirms that the runner still checks authorization and
captured revisions before publication. Exercise the graph, architecture fixtures,
changed-feature checker, focused report/Guide suites and spec integrity. Review
the 012 runtime cache/tokenizer and 004 evidence label changes in their owning
packages before live acceptance. D23 changes routing, while the 1,048,576-token
context limit, 8,192-token report output reserve and operational byte bounds are
kept. Provider capacity and actual P95 still require the approved live workload.

**Integration boundary review (T083, D23):** the separate validation worktree
starts at `7dc263f`, which contains the published 003 route and 006
`StructuredGenerator`. The report adapter consumes the public
`@everlast/cloud` factory and resolver. Native token count/cache use that
resolver's exact project, EU endpoint and Flash model. The worker factory
composes them through the existing report model/context ports. Legacy
`VERTEX_LOCATION`, `REPORT_MODEL` and `REPORT_MODEL_VERSION` do not drive
this route or its cache identity. Model version and tokenizer identity are
the D23 model ID and `vertex-countTokens:gemini-3.8-flash`, respectively.
Keep runtime placement, 20-second inference and 30-second context transport
timeouts, 8,192 output reserve, 1,048,576 context limit and existing cache TTL.
Provider qualification, 004 evaluator labels and 012 benchmark bindings stay
separate tasks. The [FR card flow-back patch](evidence/fanout-20261111/fr-card-flow-back.patch)
is ready for the serialized integration slot.
