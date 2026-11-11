# Validation Log: Package 2.4 Studio Text Synthesis & Reports

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Tasks**: [tasks.md](tasks.md)

## Integration onto the converged v1 code base (2026-10-19, D16 / DEV-04)

> **Correction:** this package was built and tested against the pre-convergence v1 code: in-memory notebooks,
> quota and chat history, an API server that accepted unsigned tokens, and an eval script with hardcoded
> metrics. Earlier entries below that rely on those modules are superseded. By owner decision (D16, SRS §5.5
> DEV-04) the package keeps its own data in process memory until v3; it now runs on the converged v1 code.

- **Access:** every v2 route runs behind the v1 app: Identity Platform/local RS256 tokens, notebook ownership
  checked in PostgreSQL before any v2 handler (`apps/api/src/app.ts`), v2 never decides access itself.
- **Bridge:** `packages/db/src/poc-bridge.ts` mirrors authorized notebooks, Ready-source counts and the visible
  PostgreSQL chat history into the in-memory stores; a deleted notebook drops all v2 records.
- **Runtime:** `apps/api/src/v2/runtime.ts` composes the package; background work runs in the API process
  (single instance for the PoC).
- **Verification (worktree `v1-gate`, PostgreSQL 16 + pgvector):** `pnpm typecheck` clean; `pnpm lint` passed;
  Vitest 74 files / 578 tests passed; Playwright 33/33 (incl. `workspace-comfort.spec.ts` WC-E01..03); `pnpm eval:deterministic` Precision_ID 160/160, leakage 0. Gate v2.0 not run.
- **Package 2.4 specifics:** Studio access, snapshot verification and generation read sources through the
  v1 PostgreSQL C-02 path; reports run in the API process (`InlineStudioDispatcher`). *(Superseded 2026-10-20,
  see below: the Vertex Flash report adapter exists.)*
  The designed table moved to `packages/db/migrations/v3-draft/` (not applied).
- **Not built (superseded 2026-10-20):** the reports modal and artifact list UI — now built (T058).

## Phase 7 convergence (2026-10-20, branch `feat/v2-008-converge`, T038–T060)

Worktree `impl-008`, Node 24, PostgreSQL 16 + pgvector (`everlast-pg-test`, port 54329). Base `feat/v2-007-converge`
(`c96bf41`), with the Reports UI branch `feat/v2-008-ui` merged (T048, T049, T058).

| Gate / command | Result |
| :- | :- |
| `pnpm lint` | pass (incl. spec integrity and TypeScript compilation) |
| `pnpm typecheck` | pass, 0 errors |
| `pnpm test:unit` | 20 files / 276 tests passed |
| `pnpm test:integration` (`TEST_DATABASE_URL` set) | 66 files / 459 tests passed |
| `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm eval:deterministic` | exit 0; Precision_ID 160/160 = 1.0, leakage 0; **Gate v2.0 #3 Studio reports: PASS** — validity 100 % (4/4 templates), citation precision 1.000, leakage 0, P95 2.5 ms (≤ 25,000 ms), deterministic report model (test double) |
| `pnpm test:e2e` (Chromium) | 37 passed, 1 skipped (`GC-E04`, a pre-existing `test.fixme`); includes `studio-reports.spec.ts` ST-E01 and ST-E02 |
| `node scripts/check-spec-integrity.mjs` | pass (134 Markdown files, 55 SRS IDs, 24 feature artifacts) |

**Current state of Package 2.4**

- Reports use the Vertex AI Flash report model (`gemini-2.5-flash`, `europe-west4`, keyless ADC, fixed grounding and
  citation system instruction; T053) when Vertex is configured (`createV2ReportModel` in `apps/api/src/server.ts`),
  else the deterministic extractor. Owner default 2026-10-20: Flash only (no Pro routing).
- Dynamic suggestions use Flash-Lite through the Package 2.2 structured-generation client (T054); without it, or when
  guides can never be generated, the API answers `SuggestionsUnavailable` (owner default 2026-10-20).
- Studio jobs read every chunk of their snapshot in keyset pages (T050, D12); sections use the card's stable keys
  (T051); Gate v2.0 #3 rules are enforced by `validateReportPayload` (T052); the cancel route and UI are removed
  (T056); the snapshot field is `source_revisions_snapshot` (T059); Convert to source saves a cited note and converts
  it through FR-NM-03 (T057). The Reports tile, modal, list and viewer are mounted in the Right Panel (T058).
- Security review 2026-10-20: `output_language` must be one of the FR-UI-02 supported tags (400 otherwise), and
  on-demand Source Guide runs start only for such a tag. Deferred: per-notebook cap/rate limit for on-demand guide
  runs (T061).
- v2 has no source-delete route; the deletion-before-publication tests (T047) remove the source row in PostgreSQL.

**Gate v2.0 #3:** passed for the deterministic run (T042 and T049 pass). **UNAVAILABLE:** the Vertex Flash release
variant (P95 ≤ 25.0 s with the live model) and the LLM-judged evals (`NFR-EVAL-01/03`) until a deployed run against
Vertex AI `europe-west4` exists; no live Vertex run was made.

## Live Gate v2.0 fixes, 2026-10-20 (branch `fix/v2-008-live-gate`, T062–T065)

**Before (first live `pnpm eval:judged`, Vertex `europe-west4:gemini-2.5-flash`):** Gate v2.0 #3 FAIL — validity
75 % (3/4), citation precision 1.000, leakage 0, P95 28,379.6 ms (> 25,000 ms). The Study Guide was refused with
`InsufficientEvidence` ("The selected sources do not contain enough supported content for every required section of
this report"). That was correct: the 4-chunk fixture could not support every required section, and the card says never pad.

**Changes (FR-ST-10, Gate v2.0 #3, D12):**

- Latency: every report call (extract and compose) now sends `thinkingConfig: { thinkingBudget: 0 }` and
  `maxOutputTokens: 8192` (`REPORT_GENERATION_CONFIG`, `@google/genai` 2.30 `ThinkingConfig`; 0 = thinking off on
  `gemini-2.5-flash`). It goes through a new optional `generationConfig` on the shared Package 2.2
  `generateStructured`. Source Guide, overview and follow-up requests stay byte-identical (tested). A truncated
  response fails JSON validation and becomes a `GenerationError`; it never produces a partial report.
- Pipeline: the map step runs up to `EXTRACT_CONCURRENCY` = 4 extract calls in parallel, with findings merged in
  batch order. No new batches start after a failure. The default batches shrink to ≤ 8 chunks / 4,000 tokens
  (research R2), so a 20-chunk notebook needs 3 parallel extract calls instead of 1 long one. Compose stays one call.
- Gate fixture: `studioGateFixture()` now has two selected sources with 10 chunks each (diplomatic history
  1648–1919 with dated events and actors; cryptography/ledger definitions with dates and people), plus a two-chunk
  unselected source that carries `LEAK_TERM`. Every validation rule is unchanged; this changes test data, not the bar.

**Verification (local, keyless):**

| Gate / command | Result |
| :- | :- |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass, 0 errors |
| `pnpm test:unit` | 20 files / 276 tests passed |
| `pnpm test:integration` (`TEST_DATABASE_URL` set) | 67 files / 467 tests passed |
| `env -u GEMINI_API_KEY -u GOOGLE_API_KEY -u GOOGLE_GENAI_API_KEY pnpm eval:deterministic` | exit 0; citation_precision 160/160 = 1.0, scoping leakage 0; **Gate v2.0 #3 (deterministic): PASS**, validity 100 % (4/4), precision 1.000, leakage 0, P95 7.5 ms |
| `pnpm test:e2e` (Chromium) | 37 passed, 1 skipped (`GC-E04`, pre-existing `test.fixme`) |
| `node scripts/check-spec-integrity.mjs` | pass |

**Live Gate v2.0 #3 re-run: UNAVAILABLE (T065).** One attempt with `runStudioReportsReleaseGate` (`VERTEX_PROJECT=lukas-gcloud-playground`,
`VERTEX_LOCATION=europe-west4`) failed during authentication with `invalid_grant`, because the ADC refresh token
has expired. No model call was made. After `gcloud auth application-default login` the check must be re-run, and
the validity, precision, leakage and P95 values recorded here. Until then the live P95 ≤ 25.0 s is not proven.

## Live Gate v2.0 #3 fixes, 2026-10-22 (branch `fix/studio-reports-live`, T065–T069)

**Before**, on the dev deployment (image `everlast:ce3626b`) and in the local live run with
`runStudioReportsReleaseGate` (`VERTEX_PROJECT=lukas-gcloud-playground`, `europe-west4:gemini-2.5-flash`): Gate v2.0 #3
FAIL, validity 25 % (1/4), P95 28,468 ms. Briefing Doc: `Quote in quotes is not in the cited chunk`. Study Guide:
compose took > 18 s and Vertex returned 504 `DEADLINE_EXCEEDED`. FAQ: one 429 `RESOURCE_EXHAUSTED` failed the report.
On dev, timeline was refused with `InsufficientEvidence` in one run.

**Changes:** T066 (finding references and the literal evidence filter), T067 (parallel compose per section group),
T068 (transport retry for 429/5xx), T069 (rejection logging without content).

| Check | Result |
| :-- | :-- |
| `pnpm exec vitest run apps/worker/test/studio-vertex-report-model.test.ts` | 17/17 pass (12 new tests observed failing first) |
| Full suite with `TEST_DATABASE_URL` (local PostgreSQL + pgvector) | 92 files, 796 tests pass |
| `pnpm typecheck`, `pnpm lint` | pass |
| `pnpm eval:deterministic` | Gate v2.0 #3 (deterministic) PASS, validity 100 %, precision 1.000, leakage 0 |
| **Live Gate v2.0 #3, run 1** (`runStudioReportsReleaseGate`, Vertex `europe-west4:gemini-2.5-flash`) | **PASS**: validity 100 % (4/4), citation precision 1.000, leakage 0, P95 18,401 ms (≤ 25,000 ms) |
| **Live Gate v2.0 #3, run 2** | **PASS**: validity 100 % (4/4), citation precision 1.000, leakage 0, P95 17,383 ms |

Per-template live times (run 1): Briefing Doc 15.7 s, Study Guide 18.4 s, FAQ 13.7 s, Timeline 7.8 s. Compose calls
now take 2–5 s each; the extract map step (up to ~10 s) is the larger share.

## Section keys per compose group, 2026-10-22 (branch `fix/studio-report-section-keys`, T070–T071)

- **Dev smoke (image `61542fc`)**: Gate #3 fixture on dev 4/4 Completed. A Timeline over a 195-word status memo without named people failed 4/4 with `GenerationError` (reproduced locally against Vertex: `The report has an unknown section.`).
- **After T070–T071** (Vertex `europe-west4:gemini-2.5-flash`, keyless ADC): the memo Timeline refuses 3/3 with `InsufficientEvidence` (no supported `cast_of_characters`, FR-015); memo Briefing Doc, FAQ and Study Guide complete and validate. Gate v2.0 #3 PASS: validity 100 % (4/4), citation precision 1.000, leakage 0, P95 17.6 s.



## Retained pre-V4 Guide admission —2026-11-07

Traceability: FR-SI-02, FR-ST-10/11, NFR-SEC-02, NFR-EVAL-01..04, T061/T072–T076.

- Red: mounted API started5held Guides instead of2. Primary polling Red charged1
  start instead of0. Changed-preference Red left fr-FR ungenerated after en-US
  because the old seen dispatcher skipped it; durable primary identity fixes this.
  One initial test invocation used a stale local port and failed setup; it was not
  counted as requirement Red. Actual db:test port54329 was then used.
- Green:6focusedfiles/51tests PASS (DB ledger, configuration, mounted API, existing
  Studio runtime/restart and Vertex report adapter). Typecheck/lint/spec checks PASS.
  DB/API tests use real disposable PostgreSQL; model/provider calls are test doubles.
- Deterministic eval: citation160/160, leakage0, labelled report/structure doubles
  PASS; judged suites remain UNAVAILABLE/GatePending. The deterministic run preceded
  the final primary-language identity refinement; that change affects Guide admission
  only, not chat/model/citation evaluation. Its affected mounted API regression was
  rerun Green afterward.
- T061 admission implementation is complete locally; newT076retains final candidate
  live acceptance and historical report504/75%failure. No report model/pipeline or
  timeout was changed without a demonstrated cause. Existing OCR processor is a
  configuration prerequisite, not new empirical acceptance.
- Migration0012adds ledger and primary-language identity. Deploy migrations before
  updatedAPI. Terminal slot-release DB errors fail closed until single-instance
  restart recovery. Retained in-window failures remain charged through restart.
- Checklist markers unchanged: requirements16/16, report-gates22/22checked.
- No paid calls, cloud apply, deployment, push/PR/merge, issue closure or external
  messages. See quickstart for012merge boundaries and live prerequisites.

Sanitized local logs: [evidence](evidence/pre-v4-20261107/focused-green.txt).


## Resumed boundary verification — 2026-11-09 (CC-09)

Reviewer: Package 008 implementation agent. Base `3d02a51`; final diff is the
API-local Guide suggestion fixture plus 008 spec/plan/tasks/analysis/evidence.
No production file, manifest, public export, checker or exception changes.

| Check | Result | Evidence / applicability |
| --- | --- | --- |
| Initial graph `node scripts/check-architecture.mjs --base-ref origin/main` | FAIL: 2 findings | [Before](evidence/cc09-20261109/graph-before.txt): one worker-model import violates no-cross-app and public-entrypoint. Initial dependency-install failure was setup-only, not governance Red; this captured run follows install. |
| Initial global artifacts | FAIL: 8 findings | [Before](evidence/cc09-20261109/artifacts-before.txt), 008 and 009. |
| Pre-edit behavior characterization | PASS: 6 files, 51 tests | [Characterization](evidence/cc09-20261109/characterization.txt), real disposable PostgreSQL and labelled model doubles on Vitest 5.1.0. |
| Final graph against origin/main | PASS: 0 findings, 186 unchanged exact exceptions | [Graph](evidence/cc09-20261109/graph-after.txt). No policy expansion, new import bypass or helper re-export. |
| Scoped 008 artifact check | PASS: 0 findings | [Scoped check](evidence/cc09-20261109/artifacts-scoped.txt), explicit spec/plan/tasks plus the changed test path. |
| Final global artifacts against origin/main | FAIL: 4 findings, 009 only | [Global check](evidence/cc09-20261109/artifacts-global-after.txt). Do not report full lint/CI green before 009 is reconciled. |
| Final focused Guide/config/DB/runtime/restart/report-adapter behavior | PASS: 6 files, 51 tests | [Focused run](evidence/cc09-20261109/focused-after.txt), same assertions before/after; no artificial product Red. |
| Typecheck | PASS | [Typecheck](evidence/cc09-20261109/typecheck.txt), unchanged production code and current dependencies. |
| Spec integrity / whitespace | PASS | [Spec check](evidence/cc09-20261109/spec-integrity.txt); final git diff --check. |
| Manual CC-09 ownership/diff review | PASS for this slice | Plan inventory records actual authorization, transaction, quota, dispatch, cancellation and publication owners, unchanged D16 placement and exact [legacy records](evidence/cc09-20261109/legacy-exceptions.json). Not certification that legacy runtime orchestration is pure composition. |
| Checker fixtures, build, deterministic evaluation | Reused, not rerun here | Inherited 001 [39 fixture checks](../001-workspace-foundation/evidence/cc09-20261109/architecture-fixtures.log), [build](../001-workspace-foundation/evidence/cc09-20261109/build.log) and [deterministic report](../001-workspace-foundation/evidence/cc09-20261109/deterministic.log): citation160/160, leakage0. No checker/build/product/model/schema/config implementation changes invalidate these results; the affected fixture is verified directly above. Doubles remain labelled. |

Exact focused command (using the local-only connection returned by db:test:up):

```sh
pnpm exec vitest run apps/api/test/guide-admission.integration.test.ts apps/api/test/guide-admission-config.test.ts packages/db/test/guide-admission.integration.test.ts apps/api/test/studio-runtime.integration.test.ts apps/api/test/v2-restart.integration.test.ts apps/worker/test/studio-vertex-report-model.test.ts
```

The local double returns three valid public-contract suggestions. A mistaken call
can therefore still produce SuggestionsReady and violate the existing unavailable
assertion; a throwing stub was intentionally avoided. It has no extract/compose
implementation, worker import or hidden helper export. Existing helper worker usage
remains byte-for-byte unchanged.

Both reviewer checklists are unchanged (16/16 and 22/22 checked). Optional Git
before/after analyze and implement hooks were dispatched and respected disabled
auto-commit settings; final reviewed checkpoint is manual. No cloud, paid calls,
new resources, deployments, GitHub writes or issue closures occurred. Report504
root cause remains unproven; final live T076 and Gate v3 acceptance remain pending.

## Task 008 local deadline checkpoint — 2026-11-11 (FR-ST-10/11, C-02/C-03, NFR-EVAL-02/04)

Prepared base `d58b8d1739dfca167c4a89fc82e290cc2b518f94`.
The unchanged [historical judged log](../006-source-guide-chat-control/evidence/pre-v4-20261107/judged-run.txt)
(SHA-256 `05c63e3b2a83335b28c7ef1b4d399c9fb9fdd896251363b3a8f92cb3f66f67ff`)
records 3/4 validity, three 504s, a failed Study Guide and P95 64,536.1 ms.
The associated [judged JSON](../006-source-guide-chat-control/evidence/pre-v4-20261107/judged-eval-report-v1.json)
(SHA-256 `ea24b8c3b9f968e056666bc144a7543074db70ff73a401d3605c7d7a3ab84121`)
also preserves the failed run and its independent OCR preflight gap.

The checked-in worker regression injects a provider 504 after 20 seconds of
virtual time during the Study Guide's topic-review compose. [Red](evidence/fanout-20261111/deadline-red.log)
observed retries starting at 21,000 and 44,000 ms, with terminal failure at
64,000 ms. [Green](evidence/fanout-20261111/deadline-green.log) observes one
attempt ending at 20,000 ms and the same terminal failure with null payload.
Immediate 429 and 504 responses still retry within the attempt window. Diagnostics
log the fixed phase, template, section group, attempt, elapsed milliseconds,
status and retry decision. They carry no prompt, source, response or cache handle.

The [four-template replay](evidence/fanout-20261111/frozen-gate-replay.json) ran
the unchanged Gate v2.0 #3 corpus and population through its Studio runner.
A local SDK double injected the same 504 only for the Study Guide topic review.
The other three templates used the deterministic report model. Validity stays
3/4 under the injected fault, citation precision stays 1.0, leakage stays zero
and no partial Study Guide is published. The virtual duration confirms the local
retry mechanism. The original log cannot identify the failed model phase or prove
that retry amplification was the only live cause. Report retry starts are bounded
per operation. A retry that starts within the window still has the existing
20-second SDK deadline, and the overall live P95 remains to be measured.

Manual CC-09 review covers the actual report adapter and worker-test diff.
The existing worker-local adapter owns SDK transport and shape checks. The report
adapter owns retry dispatch and grounding validation. The runner still owns
authorization, captured revision checks and terminal publication. No dependency
edge, shared startup path, migration record, Guide admission, or gate threshold
changed. Architecture fixtures passed 39/39. The graph and changed-feature
artifact checks returned zero findings with 184 exact legacy exceptions. Typecheck,
spec integrity and diff check passed. The focused report, runtime, restart and
Guide-admission suites passed 59 tests across ten files with a disposable
task-008 PostgreSQL 16 + pgvector instance. The deterministic eval exited 0 with
160/160 citation IDs, zero leakage and valid output from all four templates.
This was local worktree evidence using deterministic models.

T083 needs the 003/006 public route and adapter before production wiring. Under
D23, coordinate the Flash model, EU location, version, token/output bounds and
qualification binding with 012. Task 004 owns the live evaluator model label.
For upstream integration, record the retry dispatch limit and D23 report/native
cache route in the package 2.4 FR card. The existing FR-ST-10 acceptance
population, validity, precision, leakage and latency thresholds continue to apply.
T076 remains open for the approved final-candidate run.

## Local D23 integration checkpoint — 2026-11-11 (FR-ST-10/11, NFR-PERF-01, NFR-SEC-01)

Integration base `7dc263f91cf9e6cceac35065556e8bb3301b918c` includes the 003
role resolver and 006 structured transport. The 008 retry delta is
`753c017b2ff664ff896b97d4406a22254dfcade8` on this branch. The public
`StructuredGenerator` now carries extract and compose through the approved
`gemini-3.8-flash` enterprise endpoint in `eu` with LOW thinking and the existing
20-second request timeout. Native `countTokens` and cache lifecycle operations use
the same model, project and regional endpoint, with their existing 30-second
transport timeout. Native cache creation rejects a mismatched model request.
The 8,192-output-token reserve, 1,048,576-token context cap and existing cache
TTL, expiry validation and cleanup are exercised by SDK doubles. Legacy report
model/version and Vertex embedding-region settings cannot redirect this adapter.

[Red](evidence/fanout-20261111/d23-red.log) observed three expected failures on
legacy region, model and thinking. [Green](evidence/fanout-20261111/d23-green.log)
passed the 23 adapter and cache tests. With a dedicated disposable PostgreSQL
instance, the report, Guide-admission, restart, runtime and report-gate suites
passed all 59 tests in ten files. A second batch of Guide structured transport
and Studio context tests passed all 22 tests in five files. Deterministic eval
exited 0 with 4/4 valid reports, precision 1.0, leakage 0 and 7.5 ms local P95.
The same run reported 160/160 citation IDs and zero chat leakage.
`pnpm lint` passed spec integrity, all 39 architecture fixtures, graph and
changed-feature checks, and TypeScript. The exact 006-base comparison returned
zero graph or artifact findings and retained all 184 approved exception records.

Manual CC-09 review confirms that the report adapter now consumes existing public
cloud exports and owns retry and output/evidence validation. The cloud adapter
owns SDK transport, the context adapter owns cache calls, and the Studio runner
keeps access, revision and publication ownership. The diff has no API/worker
import additions, shared wiring changes, policy edits or SQL changes.
Guide admission and report publication fences passed their regressions.

Coordinator integration inputs:

- Task 004 should set the live report evaluator's `modelId` from `model.id` in
  `packages/evals/src/studio-gate.ts`. Its current derivation uses legacy
  `VERTEX_LOCATION` and `REPORT_MODEL` environment values.
- Task 012 should use `resolveEnterpriseGeminiConfig("flash", env)` for report
  benchmark tokenizer/cache qualification in
  `apps/api/src/observability/benchmark.ts`. Bind the candidate model/version
  `gemini-3.8-flash`, location `eu`, tokenizer identity
  `vertex-countTokens:gemini-3.8-flash`, context cap 1,048,576 and output reserve
  8,192 to the same serving boot and reviewed fixture profile.
- Apply the [FR card flow-back patch](evidence/fanout-20261111/fr-card-flow-back.patch)
  in the serialized slot. `git apply --check` passes on this base.

T083 has local integration evidence. Provider entitlement, native cache
compatibility and measured latency on the frozen cohort remain unverified.
T076 requires the approved final-candidate live four-template and common judged
runs, including the configured existing EU OCR processor. Historical 3/4 validity
remains a recorded failure. The original files and hashes are unchanged.
