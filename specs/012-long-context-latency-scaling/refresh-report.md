# Latest-main refresh: Package 3.4

Date: 2026-10-21. Scope: NFR-PERF-01; supporting C-01/C-02/C-03, FR-GC-01/02/06/08, FR-SI-01/02/03/05, FR-WM-04/07, NFR-SEC-01/02, NFR-EVAL-01..04.

## Provenance and workflow (CC-01/06)

- Latest fetched main: `0a94f3fca01395922fa788ea8cbb4286e8500f4a`, integrated at `6d3624a`; main is an ancestor. Base is preceding completed package 3.3 refresh `7b197aa74ebaf10b524a2b7dde7b16f4dd50a368`, retaining all earlier refreshes.
- First action created `/private/tmp/everlast-v3-refresh-3-4-20261021`, branch `codex/v3-refresh-3-4-20261021`. Second action exported supplied `SPECIFY_FEATURE_DIRECTORY=specs/012-long-context-latency-scaling`, persisted that exact feature_directory in `.specify/feature.json`, then unset/asserted absent. Setup resolves the pin; its BRANCH field is the feature slug, not the actual Git branch name.
- Restored only own custom checklist from `be8872cf9976afe2f92c36c19441abebf2d9b354`; no old pin imported. First 32 questions preserved except mechanical D15/DEV-04 → D17/DEV-05 collision reconciliation. Appended CHK033–036, all 36 unchecked; no reviewer evaluation claimed.
- Spec-first ambiguity review found all product scope, roles, lifecycle, error, numeric acceptance, integration, terminology and completion categories clear. No new critical product question; implementation issues resolved in research. Re-executed prerequisite resolution, plan setup and Phase 0/1 design. No tasks generation or analyze invocation (tasks absent), implementation, cloud API/IAM activation, deployment or PR.

## Changed assumptions and upstream flow-back (NFR-PERF-01, C-02/C-03)

Main already implements PostgreSQL chunks vector(768)/generated simple FTS/cosine HNSW/GIN, canonical source_pages, snapshot-filtered RRF hybrid retrieval, real enterprise Vertex ADK model and strict history eligibility. The old missing-production-retrieval and permissive-history claims were removed. Reuse actual files, defaults (40 candidates, 12 results, RRF 60, iterative scan/ef_search 100) and current query construction; calibrate scoped ANN recall/tuning against exact ranking without recreating schema or assuming fallback already exists.

Current chat follows ChatService → request-bound C-02 → buffered model draft → verifyDraft → fenced publishTurn → final SSE. The route is POST /api/notebooks/:id/chat/turns. TTFT observes fresh validated factual content in the buffered final event, never status/raw model token/refusal/replay. Preserve current service/model/draft/verifier projections and package 3.2 additions. Current /healthz liveness and /readyz SQL SELECT 1 alone do not prove the actual serving instance and its declared dependencies awake: plan private boot/readiness/request correlation prospectively; unknown readiness makes acceptance unavailable. No clock reset or subtraction.

Current keyset all-original SQL pages return a collected array, so query paging is not bounded total application memory. Report batching now uses 4,000 tokens / 8 chunks and extraction concurrency 4; oversized individual chunks and the final all-findings compose still need model-envelope bounds, segmentation, recursive reduction and complete original evidence coverage. At the inclusive million-source-token boundary qualify full-envelope overhead, never truncate. Reuse shared context helpers across existing reports and new maps/tables. Package 3.1 owns D16 durable revision/language-keyed Guides; package 3.3 owns durable Studio repositories/outbox/recovery. No duplicate persistence ownership introduced; refreshed prerequisite designs are not implemented evidence.

Spec, plan, research, data model, interfaces and quickstart refreshed together; own card and narrow architecture paragraph carry flow-back. D15 canonical text, D16/DEV-04 v2 PoC, D17/DEV-05 warm-only latency and D18 managed 2 vCPU / 1.5 GB remain intact. All retained R6 sandbox controls still require qualification. Gate v2 is owner override with known earlier failures and absent post-fix live rerun, not measured green. Constitution 2.0.0 requires deterministic PR suites and judged once per release candidate on fixed deterministic stratified 50-case sample with IDs/category composition/dataset hash; distinguish it from the 20-warm-run performance fixture.

## Review and verification (CC-01..08, NFR-EVAL-01..04)

- Pre/post-design CC-01..08: design PASS with evidence in plan, without a runtime pass inference. Accepted 20-warm nearest-rank P95 (19th sorted) ≤ 2,500 ms, exact 142.8 bar needle citation and zero 155.0 bar decoy retained; all attempts/failures reported, max 40 attempts to collect 20 warm. Wake reporting has no threshold; concurrency 2 is a separate two-Owner diagnostic. Full D12 original chunk/segment coverage remains mandatory.
- Built-in requirements checklist re-evaluated 16/16 → 16/16; no marker changes or regressions. Custom 36 items unique/sequential and unchecked; original 32 mechanically reconciled only. Exact pin/environment absence/no tasks verified.
- Paths-only clarification prerequisites, plan setup and checklist template resolution PASS. Extensions YAML parsed with Ruby Psych; before/after clarify/plan/checklist hooks are optional Git commit hooks, skipped. No mandatory hook omitted; explicit reviewed commit follows validation.
- `node scripts/check-spec-integrity.mjs`: PASS after staging all files (172 Markdown; 55 SRS IDs; 32 feature artifacts). `git diff --check`: PASS.
- `node scripts/lint.mjs`: spec integrity stage PASS; TypeScript stage UNAVAILABLE (`Cannot find module typescript/bin/tsc`) in fresh dependency-free worktree. Shell Node 26.3.0 differs from target Node 24; configure project runtime before implementation qualification. No source code changed or dependency install/unrelated tests run.
- Deployed scale runner, million-token latency/quality, prospective readiness, total-memory/model-envelope/cache qualification, R6 and full integrated Gate v3 remain UNAVAILABLE. Markdown validation does not prove runtime metrics. Existing dev/migration scripts are real operations and were not invoked.

## Handoff (CC-06, NFR-PERF-01)

Next stage is package-specific speckit-tasks, then speckit-analyze and gated test-first implementation. This final cumulative refresh branch includes all four package refreshes and their custom checklists. Custom markers remain reviewer-owned; requirements-quality approval and actual runtime qualification are separate from planning completion.

## Second-main refresh (2026-10-21; NFR-PERF-01, C-02/C-03, CC-01..08)

This section supersedes the first refresh's current-state claims about process-local v2 storage; prior sections preserve history. Incremental main range: 0a94f3f→dc25c46. Created `/private/tmp/everlast-v3-refresh2-3-4-20261021` on `codex/v3-refresh2-3-4-20261021` first, from preceding completed package 3.3 commit `f2d438eb72f93ebfb71f52e13f8653ae6612021c`. Second action exported `SPECIFY_FEATURE_DIRECTORY=specs/012-long-context-latency-scaling`, persisted the exact value in `.specify/feature.json`, then unset/asserted absence. Latest main is an ancestor.

Spec-first review and incremental Phase 0/1 refresh reuse specs/013's applied 0005–0008/app-scoped PostgreSQL repositories. DEV-04 is closed; D16 retains one API and in-process work. Removed obsolete Guide/report migration prerequisites and clarified 3.1's remaining dispatch/publication fencing and 3.3's new-kind admission/outbox/lease/publication ownership. Benchmark contracts now declare actual pool/repository costs, startup sweep/recovery evidence and separate database/persisted-record/provider-cache states. Legacy interrupted reports fail for explicit retry; Pending guides regenerate and Ready guides survive. UI sources/history-ready Send control does not establish model readiness or reset timing.

Updated own spec, plan, research, data model, interfaces, quickstart and narrow card/architecture flow-back. No scope amendment or new product clarification required. D12 all-original evidence, D17 warm-only 20-run/19th P95 ≤2,500ms/no reset/max 40 attempts, separate concurrency 2 diagnosis and D18 pending R6 remain unchanged.

Plan setup and checklist template resolution pass. Extension YAML parsed: before/after plan/checklist hooks are optional Git commit hooks, skipped; explicit reviewed commit follows. Built-in quality checklist revalidated 16/16. Original 36 custom items preserved verbatim and unchecked; appended only CHK037–038 for new persistence/recovery measurement concerns. CC-01..08 design assessment remains PASS, without runtime qualification. Integrity PASS: 179 Markdown, 55 SRS IDs, 35 feature artifacts; diff whitespace PASS. No dependency reinstall or repeat unavailable compiler attempt, tasks/analyze, implementation, deployment or runtime/eval claim. Integrated latency, model-envelope/cache/readiness qualification and R6 remain UNAVAILABLE.

## Final baseline alignment (2026-10-22; NFR-PERF-01, D17, CC-01/06/08)

Created `/private/tmp/everlast-v3-refresh-final-3-4-20261021` on `codex/v3-refresh-final-3-4-20261021` from completed package 3.3 commit `b924848260e8315eca6a5147dfae8dcb5aecb099`; immediately transferred `SPECIFY_FEATURE_DIRECTORY=specs/012-long-context-latency-scaling` into the feature pin and unset it. Main `ce3626bae6c302a998cc8206d9705c38d067f76a` is already inherited. This narrow follow-up aligns current plan/research/quickstart with Node.js 26 and API startup migrations, preserving earlier report sections as history. The earlier Node 24 mismatch statement is historical and no longer describes the current runtime target.

Inspected the actual API startup and migration runner: migration completion precedes listening, but does not establish model readiness. Warm classification remains prospective with full boot/recovery/dependency evidence; all submitted attempts retain their original clocks and no migration/lock delay is subtracted. Existing D12/D17/D18 requirements, 20-warm/19th P95, scope, contracts, data model and all 38 unchecked custom items remain unchanged. No upstream behavior amendment is needed: these are existing main runtime settings applied to the unchanged benchmark rules. Optional before/after-plan commit hooks parsed and skipped in favor of an explicit reviewed commit. Integrity and diff checks pass; runtime/benchmark/R6 qualification remains UNAVAILABLE. No tasks, implementation, dependency installation, migration execution or deployment performed.

## Consolidation — 2026-10-22 (CC-01)

The same task-analysis text appeared word for word in the FR card, `spec.md` and `plan.md`. Each fact now has one home:

- FR card and `spec.md`: benchmark acceptance rules, context-cache scope/invalidation and bounded Studio reduction live in the edge-case/measurable/Assumptions text.
- `plan.md`: the three dated baseline sections became "Current baseline and benchmark conditions"; the plan links to the contract for cache metadata and observation encoding. Baseline commit history stays in this report.
- Cache metadata and JSON observation encoding now live only in `contracts/interfaces.md`; `data-model.md` and `plan.md` link to it.
- The architecture's package 3.4 section was reduced to a pointer to this package's plan.
