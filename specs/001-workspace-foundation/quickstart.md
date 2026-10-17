# Quickstart and Validation — Workspace Foundation

Scope: FR-WM-01/04/07, C-01/C-02, NFR-EVAL-04, Gate v1.0. This is a validation guide, not an implementation or test suite. Current repository is specs-only; no application server, database migrations or behavior test scripts exist yet.

## Current Documentation Checks

From the assigned worktree:

```sh
cd /private/tmp/everlast-v1-specs
SPECIFY_INIT_DIR="$PWD" \
SPECIFY_FEATURE_DIRECTORY=specs/001-workspace-foundation \
SPECIFY_FEATURE_NO_PERSIST=1 \
bash .specify/scripts/bash/check-prerequisites.sh --json --paths-only
node scripts/check-spec-integrity.mjs
git diff --check
```

Verify REPO_ROOT/FEATURE_DIR before any subsequent Spec Kit write. The integrity checker uses tracked/indexed files; include new planning documents in an isolated temporary index or stage only the intended files before checking them. Path resolution is not implementation readiness.

Next stage is `/speckit-tasks` with the same explicit environment, followed by `/speckit-analyze`. No task IDs are allocated by this plan; no implementation starts until both stages finish and blocking findings are resolved.

## Implementation Prerequisites (FR-WM-01/04/07)

- Node.js 24, pnpm and the lockfile introduced by the foundation tasks. Exact package patch versions are selected/pinned there, not assumed installed now.
- Isolated PostgreSQL with the same extensions/schema behavior as target Cloud SQL; dedicated database name per worktree. Do not run migrations against another session's database.
- Disposable private storage fixtures for integration; a real approved EU test bucket for versioning/soft-delete/upload-race proofs. An in-memory storage double is not proof of actual GCS semantics.
- Verified Identity Platform configuration for live sign-in; deterministic verified-principal/token fixtures for local unit/contract tests. Production mode must not accept fixture identities or bypass token verification.
- No credentials in fixtures, repository, or plain environment files. Use keyless identities and Secret Manager where secrets are needed. Do not enable a cloud API or apply Terraform merely to follow this document.

## Planned Command Interface — UNAVAILABLE Until Tasks Implement It

The foundation tasks must introduce and verify these script contracts in the root manifest. These commands are proposed, not runnable or passed today:

| Future command | Purpose / trace |
| :--- | :--- |
| `pnpm install --frozen-lockfile` | Reproduce pinned workspace dependencies once the lockfile exists (Gate v1.0). |
| `pnpm lint` | Check source quality; all required checks remain explicit (constitution workflow). |
| `pnpm typecheck` | Strict workspace types and shared imports (C-01/C-02). |
| `pnpm test:unit -- --run` | Title, quota/state transitions and deterministic service behavior (FR-WM-01/07). |
| `pnpm test:contract -- --run` | HTTP DTO/error and C-01/C-02 schema/guard behavior (FR-WM-04, C-01/C-02). |
| `pnpm test:integration -- --run` | Real database concurrency, deletion/finalization and storage adapter tests (FR-WM-01/04/07). |
| `pnpm test:e2e -- --project=chromium` | Notebook home/workspace/title/delete/counter interactions (FR-WM-01/07). |
| `pnpm eval:deterministic` | Available foundation isolation checks; citation-ID suite joins with 1.3/1.4 (NFR-EVAL-02/04). |
| `pnpm eval:judged` | Integrated model-judged suites once 1.3/1.4 exist; no placeholder success (NFR-EVAL-01/03). |
| `pnpm db:migrate` | Apply assigned migrations only to the isolated test database (C-01, FR-WM-04). |
| `pnpm dev` | Start isolated web/API/worker harness using explicitly assigned ports (FR-WM-01). |

After implementation, run migration/setup only for disposable test state, then contract/unit/integration checks, then browser journeys. A missing command reports UNAVAILABLE; a dependency/configuration failure is not a valid Red test. Red means the assertion fails because the specified behavior is absent or incorrect. Preserve the failing output before implementing the matching code, then Green and Refactor with reruns.

## Coverage Matrix for Test-First Task Generation

Every row requires a failing spec-derived test before its implementation task. Exact Gherkin text remains in [spec.md](spec.md); these groups also cover EARS statements, inputs, outputs and supplemental edge cases. The listed paths are planned ownership boundaries, not existing tests.

| Test group / planned file | Acceptance coverage and boundary fixtures | SRS / owner |
| :--- | :--- | :--- |
| W01 — `apps/web/test/workspace.spec.ts` | “Create new notebook opens upload modal”; default title; UUID identity; home card; direct reopen stable identity; route `/notebook/{id}`; Add sources opens. | FR-WM-01; 1.1 |
| W02 — `packages/contracts/test/workspace.test.ts`, web journey | “Rename notebook persists valid title and rejects whitespace”; Enter, blur and card menu; 0/1/100/101 code points after trim; emoji/supplementary code points; no silent truncation; title and timestamp persisted; network failure restores saved title/error. | FR-WM-01; 1.1 |
| W03 — `packages/db/test/workspace.integration.test.ts`, web journey | “Delete notebook cascades to all child entities”; exact fixture 2 sources/15 chunks/1 thread when integrated; all-generation raw-file cleanup; cancellation preserves data; tab B action returns 404 + message + overview; no late recreation. Before downstream migrations exist use boundary fixtures and mark integrated cascade unavailable, not passed. | FR-WM-01/04; 1.1 plus 1.2/1.3 integration |
| W04 — `packages/evals/test/workspace-isolation.test.ts` | “Cross-notebook query isolation” with OMEGA-991; Notebook B returns no A chunks. Final grounded refusal requires 1.3. | FR-WM-04, NFR-EVAL-04; 1.1 guard, 1.3 answer |
| W05 — `packages/contracts/test/scoped-context.test.ts`, DB integration | “Tampered source ID from another notebook is rejected”; same-owner cross-notebook and other-owner attempts; unauthenticated access; 403/InvalidScopeError, zero chunks; all read/write routes owner checked. | FR-WM-04, C-02; 1.1 |
| W06 — `packages/contracts/test/source-admission.test.ts`, DB integration | “Reject file exceeding 200 MB pre-upload”: 215 MB PDF, declared-size <=200 ms rejection. Actual bytes 199,999,999 / 200,000,000 / 200,000,001 with valid word count; cleanup and slot release; dishonest declared size. Actual storage/ingestion checks integrate 1.2. | FR-WM-07, FR-SI-01; 1.1 admission + 1.2 receipt |
| W07 — source-admission and worker integration | “Reject document exceeding 500,000 words during parsing”: 40 MB/520,000-word TXT, exact failure reason; 499,999 / 500,000 / 500,001 words under byte limit; Fail removes partial content. Real parser tests owned by 1.2. | FR-WM-07, FR-SI-01 |
| W08 — source-admission and web journey | “Block adding 51st source when quota is 50”; counts in modal/sidebar, disabled Add source/dropzone, direct server admission rejected. Config 50 and 300 accepted; 49 and 301 invalid. At 300 the same controls apply. | FR-WM-07; 1.1 |
| W09 — DB integration with two independent connections | “Concurrent uploads reserve the final slot atomically”; 49/50 plus two concurrent admissions yields exactly one success; winner failure releases slot; replayed failure/dismissal cannot double-release. 45/50 batch of 10 admits first five in order. | FR-WM-07; 1.1 |
| W10 — DB integration | Notebook quota 99→100 succeeds, 100→101 rejects; two creates at 99 yield exactly one admission. Create retry with same key returns same result; late retry after deletion cannot recreate content. | FR-WM-01/07; 1.1 |
| W11 — DB integration | Identical content independently imported in A/B has independent source/chunk sets; deleting A leaves B unchanged. Uploading/Processing/Ready occupy slots; Failed does not; deletion and Ready-finalization race in both orders. | FR-WM-04/07; 1.1 plus 1.2 content |
| W12 — C-02 contract and DB integration | Explicit nonempty Ready IDs; empty/omitted/non-Ready reject; post-submit checkbox change affects only next request; deleted/replaced/revoked snapshots fail before read/publication; inspector singleton does not mutate selection. All locator variants validate; C-01 stays five fields. | C-01/C-02, FR-SI-03/04, NFR-EVAL-04 |
| W13 — consumer contract fixtures then integrated eval | Prior uncited provenance, missing provenance, history question+answer exclusion, cache authorization/language/revision keys; deleted snippets unavailable; immediate invalid-citation refusal and no factual draft publication. Foundation provides fences; actual prompt/refusal behavior stays blocked on 1.3. | FR-GC-01/02/03/06, NFR-EVAL-02/04 |
| W14 — `apps/worker/test/notebook-cleanup.test.ts` + real storage integration | Duplicate/out-of-order callbacks, process crash between delete commit/enqueue, retry/drain recovery, all object generations, late signed-upload completion and active resumable session, failing/retained objects never Purged, no raw content in status/logs. | FR-WM-01/04; 1.1 |
| W15 — API auth + staging configuration checks | Verified token vs client-supplied owner spoof; wrong project/expired/revoked tokens; private objects; keyless service identity; residency/no-training contract checks where model calls are later introduced. No fixture auth in deployed configuration. | FR-WM-04, NFR-SEC-01; 1.1 + 1.4 |

The original package has 9 Gherkin scenarios; W01–W09 cover each explicitly. W10–W15 and additional cases within W01–W09 cover all retained supplemental and cross-package scenarios. No later package's code is pulled into this package to manufacture a passing test.

## Timing Protocol (FR-WM-01/07)

Record build commit, runtime/configuration, test database size, region, network/browser conditions, source fixture counts and worker/storage settings with every result. Use a declared staging baseline with repeated samples; report sample count and the latency distribution. Record cold starts separately rather than silently discarding them.

- Creation: browser action to created notebook workspace with Add sources visible; P95 <=1.0 s.
- Deletion: confirmation/accepted request to relational/chunk absence <=2.0 s on declared fixtures. Independently verify raw/noncurrent generations and outstanding uploads have quiesced before completion; report duration of that separate purge, without inventing an SRS threshold.
- Oversize authorization: receipt of admission request to explicit rejection for >200,000,000 declared bytes <=200 ms. Uploading full content is not required to test this admission bound; separate tests verify actual bytes.
- Isolation: exact zero foreign/deselected/unauthorized chunks, not a statistical tolerance. Model-based final-answer checks are still required during integrated Gate v1.0.

## Handoff and Stop Condition

Plan/design documents complete and traceable; no application code or `tasks.md` created. Next: `/speckit-tasks` for `specs/001-workspace-foundation`, then `/speckit-analyze`. Before implementation, share concrete task IDs, allowed files, worktree/branch/base and acceptance checks with every participating session. Do not mark tests or Gate v1.0 passed based on this guide.
