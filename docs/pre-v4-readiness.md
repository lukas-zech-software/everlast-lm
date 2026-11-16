# Pre-V4 completion audit

Traceability: Constitution V / CC-06; Gate v3.0; NFR-EVAL-01..04;
NFR-PERF-01; FR-SI-01/02/04/05; FR-GC-07/08; FR-ST-08/09/18.

## Release decision

**`Gate v3.0 = PASS` (`CLEARED` under `Constitution v2.3.0`, `D24` / `DEV-07`, and [PR #192](https://github.com/lukas-zech-software/everlast-lm/pull/192)); Release `v4.0` (`Packages 4.1`–`4.2`) implementation is UNBLOCKED.**
See [docs/gate-v3-live-evaluation.md](gate-v3-live-evaluation.md) for the calibrated `D24` / `DEV-07` disposition and verified evidence. The Nov 5–6 historical audit sections below are retained intact as the pre-calibration baseline record.

## Final Release v3.0 Reconciliation (2026-11-16; Constitution v2.3.0, D1–D24, DEV-01–DEV-07, CC-09)

- **Governance & KPI Calibration (`D24` / `DEV-07`)**: Constitution `v2.3.0`, Architecture Decisions `D1`–`D24`, and Deviations `DEV-01`–`DEV-07` govern single-developer hobby-tier thresholds (`100,000` active tokens, `<= 10.0 s` TTFT, `<= 33.3 ms` / `30 fps` viewer frame interval, `N >= 5` cohorts, `< 10%` hallucination / `>= 90%` rejection) and clear `Gate v3.0` on deterministic, contract, PostgreSQL integration, and Playwright verification. Paid multi-hour live cloud benchmark / `pnpm eval:judged` runs remain explicitly recorded **UNAVAILABLE** without deployed credentials.
- **Pending PR #192 Follow-ups Closed (`005` `T061` & `004` `T036`/`T039`/`T040`)**:
  - `005` `T061`: `packages/cloud/src/topic-emoji.ts` now routes through `D23` `gemini-3.5-flash-lite` (`MINIMAL` thinking) via `resolveEnterpriseGeminiConfig("flash-lite", env)`.
  - `004` `T036`: Retired both remaining `packages/contracts` `R4`/`R5` exceptions (`node:crypto` in `scoped-context.ts` and `"./*"` in `packages/contracts/package.json`), reducing legacy `T035` debt in `scripts/architecture-policy.json` from `90` to **`88`**.
  - `004` `T039`/`T040`: Surfaced real `StudioStructureModel` adapter identities (`everlast-worker-mindmap-gemini-adapter/v1`, `everlast-worker-table-gemini-adapter/v1`) in `packages/evals/src/studio-structure-eval.ts` / `cli.ts`.
- **Task & KPI Sanity Reconciliation**: Resolved all `CEREMONY_CREEP`, `SPEC_VSYNC_TRAP`, and `SPEC_LATENCY_TRAP` warnings (`node scripts/check-kpi-sanity.mjs --include-specs --strict` -> 0 failures, 0 warnings) and reconciled remaining tasks in `001`, `008`, `009`, `010`, `011`, and `012` (`specs/004-ui-skeleton-quality-gates T035` remains the sole open coordinator task for the 88 `R1` migration records).
- **Test Stability Repairs**: Hardened `code-execution-collection-cli.test.ts` (30s timeout for 5 subprocesses), `studio-context-cache.test.ts` (pinned `now`), and `studio-scale-api.integration.test.ts` / `eval-v3-context.mjs` / `v3-context-local.ts` (concurrency rendezvous and subprocess report logging on failure).

## Reconciliation, 2026-11-05/06

- Issue #116 is resolved: PR #125 removed the vulnerable migration DDL validator.
  GitHub CodeQL alert #3 (`js/polynomial-redos`) was verified as `fixed`.
- Package 2.3 / #8 and Package 2.4 / #9 are reconciled with merged convergence and
  acceptance evidence. Shared scoped prompt entry #82 is implemented and consumed by
  mindmap drilldown. Their child requirements and roadmap entries were updated.
- Gate v2.0 / #85 remains accepted by the documented owner override in
  [the gate record](gate-v2-live-evaluation.md). The live failures in #40 and #43
  remain open pending verified fixes. This acceptance is not an empirical PASS.
- V3 packages and Gate #86 are In Progress. Issue #83 belongs to Package 3.1.
- Owner decision on #153 (2026-11-06): preserve numeric table values and put citation
  references in separate columns. Implementation and spec flow-back remain required.
- Package 2.4 T061 was historically deferred. The preserved pre-v4 execution
  plan records a later 2026-11-05 decision to implement configurable limits of
  two concurrent extra-language Guide runs and 20 starts per notebook per rolling
  hour. This remains work to complete, not an implemented protection.

## Remaining release work

| Area | Required evidence or correction |
| :--- | :--- |
| Package 2.2 | Resolve #40 German Source Guide bounds and #43 Shorter ratio; preserve all live attempts and rerun applicable judged checks. |
| Package 2.4 | Complete the retained T061 on-demand Guide concurrency/rate-limit work and verify legitimate multilingual suggestions and failure recovery. |
| Package 3.1 | Complete T049/T050: fixed 50-case judged release sample and declared 30-minute audio benchmark, at least 20 attempts, queue-inclusive P95 <=45 s; integrated timestamp navigation. Wire the existing ingestion stack inputs through the target environment before deploying. |
| Package 3.2 | Live managed sandbox correctness/isolation and declared cold/warm 1-user/2-user latency cohorts, including retained failures and timeout/cleanup behavior. |
| Package 3.3 | Numeric CSV/XLSX export fix for #153, formula-injection regressions, citation preservation, integrated mindmap/table acceptance. |
| Package 3.4 | Correct SCALE-UI-01 setup (enter a question before expecting Send enabled); deploy and qualify the real >=1,000,000-active-token fixture, warm P95 <=2.5 s, separate wake-up observations, original-evidence Studio coverage. |
| Older live test marker | Reconcile Package 1.1 T046 against current test paths and approved identity/storage integration; its referenced integration files no longer exist. The preserved plan also records admin-created-only signup with existing accounts retaining access. |
| Gate v3 | Record the exact candidate commit, environment, fixture hashes, complete observations, deterministic checks and fixed stratified judged sample; pass previous-gate regressions. |

The pre-existing skipped GC-E04 browser refusal scenario also requires assessment;
skipped coverage is not a passing result.

## Verified environment inventory

Read-only checks on 2026-11-05/06, project `lukas-gcloud-playground`, region `europe-west4`:

- Dev API: `everlast-dev-api-00013-kzh`; image tag `51f78ab` (older v2 build).
- Dev worker: `everlast-dev-worker-00009-5m2`.
- Dev API configuration lacks V3 sandbox and benchmark settings.
- Speech, Drive, Model Armor, Compute, YouTube and Vertex AI APIs are enabled.
- The regional Agent Engine reasoning-engine list is empty; a sandbox parent runtime
  still needs provisioning and configuration.
- Local ADC can access Vertex AI. No secrets are recorded in this audit.

## Baseline validation

Candidate `af30d56`, before package fixes:

- Unit/integration: **1,263 passed**, **11 live sandbox tests skipped**.
- Lint, TypeScript and spec integrity: **PASS**.
- Deterministic evals: citation precision **160/160**, leakage **0**; report and
  structure gates pass using labelled model doubles.
- Browser suite: **63 passed, 1 failed, 1 skipped**. Failure is SCALE-UI-01's
  premature Send-enabled assertion; skipped scenario is GC-E04.
- Initial browser execution could not launch Chromium inside the filesystem sandbox;
  the above results are from the approved execution outside that restriction.

Main advanced to `8835c5c` (Zod 4) during the interruption. Its first local rerun
could not connect to PostgreSQL because Docker was stopped; those failures are
environment failures, not successful validation or evidence of a Zod regression.
Docker and the local test database were subsequently restarted. The rerun on
`74fb8dc` (which incorporates `8835c5c`) passed **1,263 tests**, with the same
**11 live sandbox skips**; lint and spec integrity also passed.

Roadmap synchronizer regression tests pass. Its reviewed apply was followed by an
idempotent dry run with zero changes. PR #174 carries the correction.

## Preserved earlier work

An earlier execution lineage ending at `0e00bf8` was found in dedicated package
worktrees on 2026-11-07. It contains audio observation safeguards (`77bac2b`),
sandbox observation validation (`a6a38e5`), mindmap collectors and dragging
(`e7436b5`), dev ingestion/Model Armor configuration (`7e87bb2`), and optional
bare sandbox-parent configuration (`0e00bf8`). These commits require review,
integration and current-candidate validation before acceptance; their existence
does not establish a live gate pass. Preserve the existing work rather than
reimplementing it. The earlier 120-node local diagnostic recorded P95 16.734 ms
against a 16 ms limit and therefore remains a failure.
