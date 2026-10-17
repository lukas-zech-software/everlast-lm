# Quickstart: Grounded Chat & Citation Engine

Trace: FR-GC-01, FR-GC-02, FR-GC-03, FR-GC-06, Gate v1.0. Application runners remain UNAVAILABLE; only documentation checks run now.

## Current commands

```sh
cd /private/tmp/everlast-v1-specs
SPECIFY_INIT_DIR="$PWD" SPECIFY_FEATURE_DIRECTORY="specs/003-grounded-chat-citation-engine" SPECIFY_FEATURE_NO_PERSIST=1 bash .specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks
node scripts/check-spec-integrity.mjs
git diff --check
```

The integrity checker requires new documents indexed; a temporary Git index can validate before commit. Do not infer runtime readiness from paths-only checks.

## Runtime setup after implementation

Integrated 1.1 identity/ownership/deletion fences and 1.2 C-02 retrieval/inspection, canonical C-01 chunks and session selection. 1.4 consumes chat/citation integration for the full release gate. Reuse 1.1 lockfile/scripts and assigned isolated PostgreSQL, bucket namespace and ports. Obtain approved identity/enterprise endpoint/processor configuration via keyless identities/Secret Manager; never commit secrets, enable APIs or apply OpenTofu implicitly.

Future foundation commands `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit -- --run`, `pnpm test:contract -- --run`, `pnpm test:integration -- --run`, `pnpm test:e2e -- --project=chromium`, `pnpm eval:deterministic`, `pnpm eval:judged` are proposed in 1.1; invoke only once actually defined. Missing runners remain UNAVAILABLE. Select the exact package test files in tasks to avoid concurrent fixture collisions.

## Acceptance and timing

Every original Gherkin scenario, EARS statement, input bound and edge/error case is enumerated in the tasks acceptance annex. Test assertions must fail for behavior reasons before implementing the mapped source files; missing imports/configuration are not Red. Record case IDs, commit, command, Red reason and Green output in `validation.md`. Real cloud/model verification cannot be replaced by successful stubs.

### FR-GC-01 — Strict Grounding Policy

- Hallucination rate $\epsilon_{\text{hallucination}} < 0.05$ ($5\%$) on `NFR-EVAL-01` benchmark (`Gate v1.0 #2`).
- Negative rejection rate $\ge 99\%$ on out-of-context world-knowledge questions (`NFR-EVAL-03`, `Gate v1.0 #2`).
- Time-to-First-Token ($\text{TTFT}$) $\le 2.5\text{ s}$ for standard queries (`NFR-PERF-01`) — non-gating target in v1.0; gating from Gate v3.0 (SRS package 3.4).

### FR-GC-02 — Precise Inline Citations

- Citation ID Precision ($\text{Precision}_{\text{ID}}$) = $1.0$ ($100\%$ of badges resolve to real chunks in $S_{\text{aktiv}}$ — `NFR-EVAL-02`, `Gate v1.0 #2`).
- Every cited claim must be semantically supported (`NFR-EVAL-02`); assess support in the LLM-judged suite, separately from deterministic ID validation. No 95% exception permits unsupported citations.

### FR-GC-03 — Interactive Citation Verification (Hover & Click)

- Hover tooltip renders in $\le 300\text{ ms}$.
- Click-to-scroll in Source Inspector resolves deterministically to the target `[data-chunk-id]` element in 100% of E2E tests (`Gate v1.0 #3`).

### FR-GC-06 — Persistent Conversation History

- Chat history of $50$ turns loads and renders in $\le 500\text{ ms}$ upon opening a notebook.

Timing runs record fixture sizes, runtime/model/endpoint versions, sample counts, region, browser/network conditions and cold/warm behavior. Standard answer TTFT ends at first validated factual token, not progress. Keep non-gating targets separate from Gate v1.0. Full release requires real PDF/MD schema upload, all four eval metrics and deterministic citation navigation; no partial package success unlocks v2.

## Stop condition

Next after tasks is `/speckit-analyze`; no implementation before blocking findings and ownership conflicts are resolved. Tasks are not marked complete during generation. Exact handoff: package/spec path, branch/commit, qualified task IDs, owned files, tests, remaining integration dependencies and unavailable checks.
