# Developer Journal: Lessons Learned in Spec-Driven Multi-Agent Development

**Context:** Everlast LM — Spec-driven, multi-agent re-implementation of Gemini Notebook on Google Cloud  
**Primary Reference Milestone:** [PR #187](https://github.com/lukas-zech-software/everlast-lm/pull/187) (`5f44947`), Constitution v2.1.0 (`CC-09`), Decision `D21`, [Architecture Refactoring Baseline](docs/architecture-refactoring-baseline.md), and [Agent Architecture Guardrails](docs/agent-architecture-guardrails.md).

This journal documents architectural errors, governance gaps, and engineering lessons discovered while scaling a multi-package codebase with autonomous coding agents under the Spec Kit workflow. Its purpose is to preserve the *why* behind our validations before distilling future skills or rules.

---

## Entry 2026-11-09 — Why Functional Spec Gates & TypeScript Were Not Enough (CC-09 & D21)

### 1. What Happened (The Observed Drift)

By the time Releases v1.0 through v3.0 were implemented across parallel and sequential feature worktrees, all functional specification checks, TypeScript project references (`tsc -b`), unit/contract/integration suites, and `NFR-EVAL-01..04` grounding benchmarks were passing. Yet the static architecture audit ([`docs/architecture-refactoring-baseline.md`](docs/architecture-refactoring-baseline.md)) uncovered **293 boundary violations** across three systemic failure modes:

1. **Deployment Applications Used as Shared Libraries (`R1` — 58 `no-cross-app` & 39 `no-shared-to-app` records):**
   - `apps/api` (`@everlast/api`) depended directly on `apps/worker` (`@everlast/worker`) in `package.json` and imported worker implementation modules (`package-v2-2-runtime.ts`, `ready-hooks.ts`, `studio/dispatcher.ts`, `studio/registry.ts`, and model adapters under `apps/worker/src/studio/*`).
   - Shared evaluation suites in `packages/evals` reached into `apps/api/src/*` and `apps/worker/src/*` to test services, verifiers, and runtime helpers instead of consuming a shared workflow package or public contract.
2. **Wildcard Exports and Deep-Import Bypasses (`R3` — 186 `public-entrypoint` & 7 `wildcard-export` records):**
   - Workspace `package.json` files exposed `"./*": "./src/*.ts"` wildcard exports.
   - Because every internal file was importable, agents bypassed package `index.ts` boundaries and imported private modules directly (including 50+ cross-package imports of `@everlast/db/testing`).
3. **Inconsistent Workflow & Transaction Ownership (`R2`):**
   - While some domains (`NotesService`, `StudioService`) encapsulated multi-step orchestration in application services, other routes (`apps/api/src/routes/notebooks.ts`) mixed HTTP parsing/serialization with multi-step repository coordination, workspace decoration, `Ready`-source counting, deletion cancellation, and background job notification directly inside transport handlers.

---

### 2. Root-Cause Reflection: Why Agents Made These Mistakes

#### Lesson 1: Agents optimize for the shortest path to a green test
When an autonomous agent is tasked with implementing a feature (e.g., triggering Studio jobs or Source Guides from the API in Package 2.2 or 2.4) and the logic already exists inside `apps/worker`, the lowest-friction way to make the test pass is to add `"@everlast/worker": "workspace:*"` to `apps/api/package.json` and expose `"./*": "./src/*.ts"`. Without a hard failing check on dependency direction, agents treat any workspace package as a fair target for reuse.

#### Lesson 2: TypeScript type-checking (`tsc -b`) validates *types*, not *architecture*
A green `pnpm typecheck` only proves that imported symbols exist and their types align. It does not distinguish between a shared contract (`packages/contracts`), a persistence adapter (`packages/db`), and a deployable Cloud Run service entrypoint (`apps/api`, `apps/worker`). Even `import type` or barrel re-exports silently couple module graphs if not checked at the AST and module-resolution level.

#### Lesson 3: Behavioral specs (`FR-*`, `C-01..C-03`) specify *what* the system must do, not *where* code may live
Our earlier Constitution gates (`CC-01`..`CC-08`) and `scripts/check-spec-integrity.mjs` verified requirement traceability, test-first ordering, `C-02` scope snapshots, `D13` citation verification, and release ordering. However, `CC-05` only checked that `C-01..C-03` Zod schemas lived in `packages/contracts` and that pipelines were deterministic—it did not require plans to declare **module ownership, public exports, allowed dependency directions, or composition roots**. What is not required in `plan.md` and enforced in `lint` is invisible to an agent during `/speckit-implement`.

#### Lesson 4: Existing bad patterns act as "implicit permission" for subsequent agents
Once one package added `"./*": "./src/*.ts"` or imported `@everlast/db/testing` across package boundaries, later agents working on subsequent packages (such as Package 3.4 `#162`) copied the exact same pattern in their new test files. Agents pattern-match against the surrounding repository; if legacy debt is left unmarked or covered by a blanket directory ignore, every new feature compounds the debt.

#### Lesson 5: Multi-agent parallel branches diverge silently against baseline inventories
When PR #187 was prepared on an isolated review baseline (`13e76bd`) while `main` advanced by 21 commits (including Package 3.4 `#162` and dependency upgrades), two integration realities surfaced immediately upon merging `main`:
- **Wildcard exposure drift:** Adding a single new source file (`packages/db/src/scoped-corpus.ts` or `packages/contracts/src/package-v3-4.ts`) to a package that still has a legacy `"./*"` export widens the exposed surface area and invalidates the wildcard exception fingerprint.
- **Concurrent pattern replication:** Package 3.4 added 7 new test imports of `@everlast/db/testing` and `@everlast/api/chat/verifier` because `CC-09` was not yet on `main` when Package 3.4 was authored.
- **Static analysis on the checker itself:** Even governance scripts are production-grade code in CI—CodeQL flagged `p.replace('*', middle)` in `scripts/check-architecture.mjs` because single-occurrence `.replace()` on a pattern string is an incomplete replacement hazard compared to `.replaceAll('*', middle)`.

---

### 3. Why the Specific Validations Were Designed the Way They Were

To close these gaps without halting feature delivery for a risky big-bang rewrite, the validations in [PR #187](https://github.com/lukas-zech-software/everlast-lm/pull/187) were engineered with specific anti-bypass properties:

| Validation / Control | Why It Was Necessary | What Agent Failure Mode It Prevents |
| :--- | :--- | :--- |
| **AST + TypeScript Module Resolution (`scripts/check-architecture.mjs`)** | Regex grep misses `import type`, `export * from`, `import x = require(...)`, dynamic `import()`, `tsconfig.json` `paths` aliases, and renamed `createRequire` loaders. | Prevents agents from laundering forbidden cross-app or deep imports through aliases, re-exports, or dynamic loaders. |
| **Exact Fingerprinted Debt Inventory (`scripts/architecture-policy.json` under `D21`)** | A global allowlist (e.g., "ignore `apps/api` importing `apps/worker`") would allow new imports between those apps. Each of the 293 records pins `{ rule, from, to, fingerprint, count, baseline, owner, decision, removalTask, expires }`. | Prevents "broken windows" expansion: adding a second identical import in the same file (`count` mismatch), importing an additional symbol (`fingerprint` mismatch), or adding a new file under a wildcard export (`wildcard-export` file-list fingerprint mismatch) immediately fails `pnpm lint`. |
| **Stale-Exception & Completed-Task Failure** | Exceptions must shrink over time, never silently linger. | If a violation is fixed (or its removal task `T035`/`T036` is checked `[x]` in `tasks.md`) without removing the exception record, the checker fails with `stale-exception` or `completed-or-missing-removal-task`. |
| **Base-Ref Policy Comparison (`--base-ref BASE_SHA`)** | An agent working on a feature PR might be tempted to add its own violation to `scripts/architecture-policy.json`. | In CI, `check-architecture.mjs --base-ref` compares the PR's policy against the base commit and fails with `exception-expansion` if any exception is added or its expiry/metadata is widened. |
| **Changed-Feature Artifact Gate (`scripts/check-architecture-artifacts.mjs`)** | Retroactively rewriting 39 historical `specs/*` directories would create massive churn and false certification, but new or resumed features must plan boundaries upfront. | Requires `CC-09` and a populated `## Architecture Boundary Evidence` table in `plan.md` whenever `apps/*`, `packages/*`, or a feature's `specs/<NNN>-*/` artifacts change, while leaving untouched historical specs intact. |
| **Managed-Template Durability (`.specify/templates/overrides/*` & workflow overlays)** | Spec Kit CLI upgrades overwrite `.specify/templates/*.md` and `.agents/skills/speckit-*`. | Placing `CC-09` requirements in project-owned template overrides and `.specify/workflows/overlays/pipeline/pipeline-verification.yml` ensures spec-driven prompts retain architectural gates across CLI updates. |
| **Reusing the Required GitHub Status Context (`Links, anchors and FR card coverage`)** | Adding a brand-new GitHub Actions job name requires updating repository rulesets; until merged, a missing context can either block unrelated PRs or go unenforced. | Wiring `pnpm test:architecture`, `check-architecture.mjs`, and `check-architecture-artifacts.mjs` into the already-required `Spec integrity` job (and `pnpm lint`) made enforcement active immediately on merge. |

---

### 4. Key Takeaways for Future Multi-Agent Work

1. **Never rely on prose rules alone when an AST check can enforce the invariant.** Agents read `AGENTS.md` and `.specify/memory/constitution.md`, but under context pressure or test-fixing loops, executable checks in `pnpm lint` are the only guarantee that boundaries hold.
2. **Separate *static import enforcement* from *semantic workflow ownership*.** `scripts/check-architecture.mjs` proves that `apps/api` does not import `apps/worker` and that consumers use public entrypoints (`R1`/`R3`), but it cannot prove that a route handler isn't coordinating multi-step transactions (`R2`) or breaking `D16` single-instance assumptions. Human/agent plan review (`CC-09`) and HTTP-free service tests remain mandatory for `R2`.
3. **Test helpers belong in dedicated test packages (`@everlast/testkit`) or declared public subpaths, never in undocumented deep imports.** Over 50 of our 186 `public-entrypoint` exceptions exist solely because `@everlast/db/testing` was intentionally omitted from `packages/db/src/index.ts` (to keep it out of production) while `packages/db/package.json` relied on `"./*"` wildcard exports.
4. **Always merge `main` and re-verify against `--base-ref origin/main` before finalizing governance or cross-cutting PRs.** In a multi-agent repo where feature branches land continuously, a baseline snapshot taken even 48 hours earlier will drift on lockfiles, wildcard file lists, or newly merged tests.
5. **Treat checker and automation scripts in `scripts/` as first-class production code.** Run TDD negative/positive fixtures (`pnpm test:architecture`) and static security analyzers (CodeQL) against repository tooling just as strictly as application code.
