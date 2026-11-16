# Task 004 integration handoff

Prepared base `9f62358f895a789d516aa40b8d81439bd0f11471`.
Worktree `/private/tmp/everlast-pre-v4-work-004`, branch `codex/pre-v4-work-004`.
Transfer only this branch's delta from the prepared base.

## Local validation (2026-11-11)

| Check | Result |
| --- | --- |
| D21 ledger versus exact policy keys | PASS, 184 records and 69 distinct statement fingerprints |
| Spec-derived report regressions | RED reproduced diagnostic gate promotion and loss of the original detailed report. GREEN passed both checks. |
| Seven focused eval suites with isolated PostgreSQL/pgvector | PASS, 37 tests across release-v1, boundaries, integration, judge resilience, judge/report integration, Source Guide and Studio |
| `pnpm --filter @everlast/evals typecheck` | PASS |
| `pnpm eval:deterministic` | PASS, 222 golden cases, 60 adversarial drafts with zero published, Studio reports and Studio structure PASS |
| `node scripts/check-spec-integrity.mjs` | PASS |
| `pnpm test:architecture` | PASS, 39 tests |
| `pnpm check:architecture` | PASS, 0 findings and 184 unchanged exact D21 exceptions |
| `pnpm check:architecture-artifacts` | PASS, 0 findings |

Manual CC-09 review compared the task diff with the prepared base. The CLI
continues to compose the existing application adapters. The report uses Node
filesystem and crypto facilities and the existing evaluator types. The new
dependency edges are Node built-ins. No deployment, scope, persistence, quota,
dispatch, cancellation or publication behavior changed. The ledger assigns R2
use cases and D21 retirements to the owning features. T035/T036 remain open.

Release attempts that reach the report writer produce a full, exclusive JSON
file under `release-attempts/`. The audit points to it and the latest JSON and
Markdown remain at their existing filenames. Diagnostic runs use
`diagnostic/`. Failures before the report writer, such as WIF or database
startup failure, remain in CI run logs. Retain each run attempt's logs and any
uploaded artifacts in the approved evidence store.

## Integration hold points

- [x] 003 published `resolveEnterpriseGeminiConfig` and the chat adapter changes
  in `f5a6bb77e202f67ad473b60a1ab0979c4acfb53e`. Consume these when the owning
  changes are integrated.
- [x] T039 wired chat, judge, Guide, Report, and Studio structure adapter identities and `EVS-05` role-specific `D23` preflight in `packages/evals/src/cli.ts`, `packages/evals/src/security-preflight.ts`, and `packages/evals/src/studio-structure-eval.ts`.
- [x] `security-preflight.ts` enforces role-specific D23 endpoints (`aiplatform.eu.rep.googleapis.com` vs `europe-west4-aiplatform.googleapis.com`, tested by `EVS-05`).
- [x] Final diff checked against `origin/main` with `T036` retired (`90 -> 88` `T035` records); remaining `T035` (`R1`) exceptions are tracked post-v3.
  The CI retention diff can be extracted with
  `git diff 9f62358..codex/pre-v4-work-004 -- .github/workflows/ci.yml`.

## Judged workload & D24 / DEV-07 disposition

Under Constitution v2.3.0 and `D24`/`DEV-07`, `Gate v3.0` is cleared by the passing deterministic, PostgreSQL integration, and Playwright verification suites (`NFR-EVAL-02 = 1.0`, `NFR-EVAL-04 = 0`), while keeping the optional paid 50-case judged workflow (`pnpm eval:judged`) calibrated to `hallucination < 0.10` and `rejection >= 0.90`:

| Input | Reviewed value |
| --- | --- |
| Entry point | CI workflow dispatch with `release_gate=true` at the approved SHA, or the equivalent reviewed `pnpm eval:judged` invocation |
| Baseline UI | Chromium `apps/web/test/gate-v1.spec.ts` on the same clean candidate, writing `reports/gate-v1-ui.json` |
| Dataset | `v1.0.0`, SHA-256 `35f54e2553cd70f380242ad16e917adde9cd87def9401a9e75def1ec790efe29` |
| Corpus | SHA-256 `df229d252d1065c8c52591d3a47aa900563a6e381feec64fa3b6160e289359cd` |
| Selection | `stratified-largest-remainder-v1`, 25 unanswerable, 11 deselection, 4 history, 14 synthesis. SHA-256 of the JSON ordered ID array `c39e6521a2ef4d1695ad95d94a32a1c55aa86471f1a0bbdeb14d0875e7fc9a28`. |
| Workload | One fixed 50-case judged campaign, default concurrency 4, FR-GC-07 on eligible synthesis cases, and the existing Guide and four-template Studio Reports release fixtures |
| Evidence | UI evidence, report JSON/Markdown, immutable attempt JSON files, audit and CI logs. Record pass, fail and unavailable outcomes against the exact SHA. |

`T036`, `T039`, and `T040` are completed and reconciled under `D24`/`DEV-07` (`T035` remains open for R1 extraction).
