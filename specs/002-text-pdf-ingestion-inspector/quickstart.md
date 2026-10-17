# Quickstart: Text/PDF Ingestion & Inspector

Trace: FR-SI-01, FR-SI-03, FR-SI-04, Gate v1.0. Application runners remain UNAVAILABLE; only documentation checks run now.

## Current commands

```sh
cd /private/tmp/everlast-v1-specs
SPECIFY_INIT_DIR="$PWD" SPECIFY_FEATURE_DIRECTORY="specs/002-text-pdf-ingestion-inspector" SPECIFY_FEATURE_NO_PERSIST=1 bash .specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks
node scripts/check-spec-integrity.mjs
git diff --check
```

The integrity checker requires new documents indexed; a temporary Git index can validate before commit. Do not infer runtime readiness from paths-only checks.

## Runtime setup after implementation

Package 1.1 shared schemas, verified identity, notebook ownership, quota ledger and deletion fences must be integrated first. Package 1.3 consumes this package; citation fixtures avoid a circular dependency. Reuse 1.1 lockfile/scripts and assigned isolated PostgreSQL, bucket namespace and ports. Obtain approved identity/enterprise endpoint/processor configuration via keyless identities/Secret Manager; never commit secrets, enable APIs or apply OpenTofu implicitly.

Future foundation commands `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit -- --run`, `pnpm test:contract -- --run`, `pnpm test:integration -- --run`, `pnpm test:e2e -- --project=chromium`, `pnpm eval:deterministic`, `pnpm eval:judged` are proposed in 1.1; invoke only once actually defined. Missing runners remain UNAVAILABLE. Select the exact package test files in tasks to avoid concurrent fixture collisions.

## Acceptance and timing

Every original Gherkin scenario, EARS statement, input bound and edge/error case is enumerated in the tasks acceptance annex. Test assertions must fail for behavior reasons before implementing the mapped source files; missing imports/configuration are not Red. Record case IDs, commit, command, Red reason and Green output in `validation.md`. Real cloud/model verification cannot be replaced by successful stubs.

### FR-SI-01 (Subset A) — Text, Markdown, PDF & Copied Text Ingestion

- Standard $20$-page digital PDF is parsed, chunked, and `Ready` in $\le 5.0\text{ s}$ (P95).
- 100% of persisted chunks validate against the `Contract C-01` JSON schema (`Gate v1.0 #1`).

### FR-SI-03 — Granular Source Selection / Scoping

- Context leakage from unselected sources ($s_i \notin S_{\text{aktiv}}$) = $0$ across the `NFR-EVAL-04` test suite (`Gate v1.0 #2`).
- UI counter updates within $\le 50\text{ ms}$ of checkbox click.

### FR-SI-04 — Integrated Source Inspector (Source Viewer)

- Opening a source and scrolling to a cited `chunk_id` completes in $\le 300\text{ ms}$ (`Gate v1.0 #3`).
- Scroll target is 100% deterministic in automated Playwright/DOM E2E tests.

Timing runs record fixture sizes, runtime/model/endpoint versions, sample counts, region, browser/network conditions and cold/warm behavior. Standard answer TTFT ends at first validated factual token, not progress. Keep non-gating targets separate from Gate v1.0. Full release requires real PDF/MD schema upload, all four eval metrics and deterministic citation navigation; no partial package success unlocks v2.

## Stop condition

Next after tasks is `/speckit-analyze`; no implementation before blocking findings and ownership conflicts are resolved. Tasks are not marked complete during generation. Exact handoff: package/spec path, branch/commit, qualified task IDs, owned files, tests, remaining integration dependencies and unavailable checks.
