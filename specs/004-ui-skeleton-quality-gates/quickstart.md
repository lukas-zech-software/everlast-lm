# Quickstart: UI Skeleton & Quality Gates

Trace: FR-UI-01, NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01, Gate v1.0. Application runners remain UNAVAILABLE; only documentation checks run now.

## Current commands

```sh
cd /private/tmp/everlast-v1-specs
SPECIFY_INIT_DIR="$PWD" SPECIFY_FEATURE_DIRECTORY="specs/004-ui-skeleton-quality-gates" SPECIFY_FEATURE_NO_PERSIST=1 bash .specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks
node scripts/check-spec-integrity.mjs
git diff --check
```

The integrity checker requires new documents indexed; a temporary Git index can validate before commit. Do not infer runtime readiness from paths-only checks.

## Runtime setup after implementation

1.1–1.3 provide real notebook, source, inspector and chat features; UI shell and test datasets can be prepared early, but full Gate v1.0 requires the integrated runnable application. Reuse 1.1 lockfile/scripts and assigned isolated PostgreSQL, bucket namespace and ports. Obtain approved identity/enterprise endpoint/processor configuration via keyless identities/Secret Manager; never commit secrets, enable APIs or apply OpenTofu implicitly.

Future foundation commands `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit -- --run`, `pnpm test:contract -- --run`, `pnpm test:integration -- --run`, `pnpm test:e2e -- --project=chromium`, `pnpm eval:deterministic`, `pnpm eval:judged` are proposed in 1.1; invoke only once actually defined. Missing runners remain UNAVAILABLE. Select the exact package test files in tasks to avoid concurrent fixture collisions.

## Acceptance and timing

Every original Gherkin scenario, EARS statement, input bound and edge/error case is enumerated in the tasks acceptance annex. Test assertions must fail for behavior reasons before implementing the mapped source files; missing imports/configuration are not Red. Record case IDs, commit, command, Red reason and Green output in `validation.md`. Real cloud/model verification cannot be replaced by successful stubs.

### FR-UI-01 — Adaptive 3-Column Workspace Layout

- Panel expand/collapse layout transition completes in $\le 200\text{ ms}$ at $60\text{ fps}$ with zero layout shift data loss.

### NFR-EVAL-01..04 & NFR-SEC-01 — Automated Evaluation & Security Gate Suite

- $\epsilon_{\text{hallucination}} < 0.05$, $\text{Precision}_{\text{ID}} = 1.0$, $\text{Rejection} \ge 0.99$, $\text{Leakage} = 0$ (`SRS §4.2` & `§5.4 Gate v1.0`).

Timing runs record fixture sizes, runtime/model/endpoint versions, sample counts, region, browser/network conditions and cold/warm behavior. Standard answer TTFT ends at first validated factual token, not progress. Keep non-gating targets separate from Gate v1.0. Full release requires real PDF/MD schema upload, all four eval metrics and deterministic citation navigation; no partial package success unlocks v2.

## Stop condition

Next after tasks is `/speckit-analyze`; no implementation before blocking findings and ownership conflicts are resolved. Tasks are not marked complete during generation. Exact handoff: package/spec path, branch/commit, qualified task IDs, owned files, tests, remaining integration dependencies and unavailable checks.
