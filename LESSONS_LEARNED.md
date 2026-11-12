# Developer Journal: Lessons Learned in Spec-Driven Multi-Agent Development

**Context:** Everlast LM — Spec-driven, multi-agent re-implementation of Gemini Notebook on Google Cloud  
**Primary Reference Milestone:** [PR #187](https://github.com/lukas-zech-software/everlast-lm/pull/187) (`5f44947`), Constitution v2.1.0 (`CC-09`), Decision `D21`, [Architecture Refactoring Baseline](docs/architecture-refactoring-baseline.md), and [Agent Architecture Guardrails](docs/agent-architecture-guardrails.md).

This journal documents architectural errors, governance gaps, and engineering lessons discovered while scaling a multi-package codebase with autonomous coding agents under the Spec Kit workflow. Its purpose is to preserve the *why* behind our validations before distilling future skills or rules.

---

## Entry 2026-11-09 — Why Functional Spec Gates & TypeScript Were Not Enough (CC-09 & D21)

### 1. What Happened (The Observed Drift)

By the time initial v1–v3 implementation had landed across feature worktrees, passing local checks, TypeScript project references (`tsc -b`), unit/contract/integration suites and the recorded [Gate v1.0 live evaluation](docs/gate-v1-live-evaluation.md) still did not establish architectural compliance. These results did not certify every release: [Gate v2.0](docs/gate-v2-live-evaluation.md) was accepted by owner override, while [Gate v3.0 remained pending](docs/pre-v4-readiness.md). The static architecture audit ([`docs/architecture-refactoring-baseline.md`](docs/architecture-refactoring-baseline.md)) uncovered **293 boundary violations** across three systemic failure modes:

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
| **Changed-Feature Artifact Gate (`scripts/check-architecture-artifacts.mjs`)** | Retroactively rewriting 39 historical generated feature artifacts would create massive churn and false certification, but new or resumed features must plan boundaries upfront. | Requires `CC-09` and a populated `## Architecture Boundary Evidence` table in `plan.md` whenever `apps/*`, `packages/*`, or a feature's `specs/<NNN>-*/` artifacts change, while leaving untouched historical specs intact. |
| **Managed-Template Durability (`.specify/templates/overrides/*` & workflow overlays)** | Spec Kit CLI upgrades overwrite `.specify/templates/*.md` and `.agents/skills/speckit-*`. | Placing `CC-09` requirements in project-owned template overrides and `.specify/workflows/overlays/pipeline/pipeline-verification.yml` ensures spec-driven prompts retain architectural gates across CLI updates. |
| **Reusing the Required GitHub Status Context (`Links, anchors and FR card coverage`)** | Adding a brand-new GitHub Actions job name requires updating repository rulesets; until merged, a missing context can either block unrelated PRs or go unenforced. | Wiring `pnpm test:architecture`, `check-architecture.mjs`, and `check-architecture-artifacts.mjs` into the already-required `Spec integrity` job (and `pnpm lint`) made enforcement active immediately on merge. |

---

### 4. Key Takeaways for Future Multi-Agent Work

1. **Never rely on prose rules alone when an AST check can enforce the invariant.** Agents read `AGENTS.md` and `.specify/memory/constitution.md`, but under context pressure or test-fixing loops, executable checks in `pnpm lint` are the only guarantee that boundaries hold.
2. **Separate *static import enforcement* from *semantic workflow ownership*.** `scripts/check-architecture.mjs` proves that `apps/api` does not import `apps/worker` and that consumers use public entrypoints (`R1`/`R3`), but it cannot prove that a route handler isn't coordinating multi-step transactions (`R2`) or breaking `D16` single-instance assumptions. Human/agent plan review (`CC-09`) and HTTP-free service tests remain mandatory for `R2`.
3. **Test helpers belong in dedicated test packages (`@everlast/testkit`) or declared public subpaths, never in undocumented deep imports.** Over 50 of our 186 `public-entrypoint` exceptions exist solely because `@everlast/db/testing` was intentionally omitted from `packages/db/src/index.ts` (to keep it out of production) while `packages/db/package.json` relied on `"./*"` wildcard exports.
4. **Always merge `main` and re-verify against `--base-ref origin/main` before finalizing governance or cross-cutting PRs.** In a multi-agent repo where feature branches land continuously, a baseline snapshot taken even 48 hours earlier will drift on lockfiles, wildcard file lists, or newly merged tests.
5. **Treat checker and automation scripts in `scripts/` as first-class production code.** Run TDD negative/positive fixtures (`pnpm test:architecture`) and static security analyzers (CodeQL) against repository tooling just as strictly as application code.

---

## Entry 2026-11-12 — The Enterprise KPI Ratchet: How Aspirational Spec Numbers Paralyzed a Single-Developer Hobby Project (`D24` / `DEV-07`)

**Primary Reference Milestone:** [PR #191](https://github.com/lukas-zech-software/everlast-lm/pull/191) (`ae68099`), [PR #192](https://github.com/lukas-zech-software/everlast-lm/pull/192) (`8f77a4d`), Constitution v2.2.0, Decision [`D24`](docs/solution-architecture.md#d24--single-developer-hobby-project-scope--kpi-calibration-2026-11-12) (`SRS DEV-07`), and [`docs/gate-v3-live-evaluation.md`](docs/gate-v3-live-evaluation.md).

### 1. What Happened (The Gate v3.0 Deadlock)

By November 2026, all functional code for Release `v3.0` (`009` Multimodal Ingestion & Sync, `010` Code Execution Sandbox, `011` Studio Mindmaps & Data Tables, and `012` Long-Context & Latency Scaling) was 100% implemented and passing every unit, contract, PostgreSQL integration, deterministic eval, and Playwright E2E test. Yet `Gate v3.0` remained blocked—and `v4.0` could not start—because the repository's release-gate harnesses demanded **enterprise-scale SLAs and multi-hour live cloud benchmark ceremonies** that were completely disproportionate to a single-developer private hobby project:

- **$1 \times 10^6$ Active Token Context Window & $\le 2.5\text{ s}$ P95 Chat TTFT (`NFR-PERF-01`)**: Required seeding 40 sources ($\ge 1,050,000$ tokens) plus a decoy source and executing 20 warm + 20 concurrent two-owner live Vertex AI requests where *full answer generation + citation verification + DB persistence* completed in $\le 2.5\text{ s}$ P95.
- **Self-Deadlocking 60-Second Cryptographic Clock & GCS Bridge (`specs/010` & `specs/012`)**: Over 1,000 lines of Ed25519 challenge/response GCS bridge code (`packages/cloud/src/private-benchmark-clock.ts`) required a 4-timestamp clock calibration with a hard **60-second expiry (`ttl_ms <= 60,000`)**—while the 40–80 sequential live benchmark waves took **44–124 minutes** to run, causing `scripts/private-benchmark.mjs` to deterministically abort as `UNAVAILABLE` before dispatching a single request.
- **$60\text{ fps}$ ($\le 16.0\text{ ms}$) Mindmap Frame Interval vs. $60\text{ Hz}$ Display VSync (`FR-ST-09`)**: Measured via `requestAnimationFrame` in headless Chromium (`specs/011-studio-mindmaps-data-tables/evidence/fanout-20261112/viewer-observations.json`). Because a $60\text{ Hz}$ VSync tick occurs every $1000 / 60 = 16.67\text{ ms}$, the real Chromium capture measured $\text{P95} = 16.80\text{ ms}$ (with zero dropped frames) and failed the $\le 16.0\text{ ms}$ threshold by $0.8\text{ ms}$.
- **30-Minute Audio ASR Cohort (`FR-SI-01`)**: Required $N = 20$ sequential runs of a 30-minute lossless FLAC file (**10 hours of audio transcription per gate run**) completing in $\le 45\text{ s}$ P95.
- **80-Run Live Code Execution Sandbox Campaign (`FR-GC-08`)**: Required 4 cohorts $\times\ 20$ runs ($80$ executions across two isolated Owner accounts) on live Vertex Agent Engine with $\le 2.5\text{ s}$ status and $\le 4.0\text{ s}$ boot + execution P95.

---

### 2. Where Did These Enterprise Metrics Come From?

Tracing the git history back to the repository's genesis (`2026-10-15` to `2026-10-17`) reveals three distinct sources:

1. **The Initial Aspirational SRS (`001bcbf`, `2026-10-15`)**:
   - The baseline German SRS ([`spec/System_Requirements_Specification_Gemeni_Notebook.md`](spec/System_Requirements_Specification_Gemeni_Notebook.md), titled *"Enterprise-Plattform nach dem Vorbild von 'Gemini Notebook'"*) was drafted as an idealized enterprise specification combining **Google's headline marketing numbers** for Gemini 1.5 Pro / NotebookLM ($1 \times 10^6$ token context window, 300 sources $\times\ 500,000$ words) with textbook enterprise RAG SLAs ($\text{TTFT} \le 2.5\text{ s}$, Source Guide $< 10\text{ s}$, Hallucination $< 5\%$, Negative Rejection $\ge 99\%$).
2. **The FR-Card Template's "Invent a Number" Mandate (`f27c52a` & `a114aef`, `2026-10-16`)**:
   - In commit `f27c52a`, [`spec/requirements/README.md`](spec/requirements/README.md) and [`spec/requirements/_fr-card-template.md`](spec/requirements/_fr-card-template.md) instructed the spec-authoring agent to extract for every FR:
     - Row 4: *"Inputs and limits: fields, formats, sizes, counts, defaults, **with numbers** — Testable constraints"*
     - Row 7: *"Timing: synchronous or asynchronous, rough duration, progress indicator — Success criteria"*
   - Because Google does not publish internal P95 SLAs, cohort sample sizes, or browser frame budgets for NotebookLM, the AI agent authoring the v2–v6 FR cards in commit `a114aef` **synthesized strict, plausible-sounding enterprise numbers for every card** so no field was left vague:
     - `package_3_1`: invented *"30-minute audio file completes in $\le 45\text{ seconds}$ (P95)"*
     - `package_3_2`: invented *"$\le 2.5\text{ s}$ to Running code… status; $\le 4.0\text{ s}$ P95 for sandbox boot + calculation"*
     - `package_3_3`: invented *"$\le 20.0\text{ s}$ (P95) for Mindmap generation"* and *"smooth $60\text{ fps}$ ($\le 16\text{ ms}$ per frame) up to 120 nodes"*
     - `package_3_4`: invented the Gherkin scenario with *"41 Ready sources totaling 1,050,000 tokens… in 20 runs"*
     - `package_2_2` & `package_2_4`: invented *"100–250 words"*, *"$\le 40\text{ characters}$"* per topic chip, *"Shorter $\le 50\%$ / Longer $\ge 150\%$"*, and *"$\le 25\text{ s}$ (P95)"* for Studio reports.
3. **Silent Semantic Compounding Across Architecture Decisions (`D13` + `NFR-PERF-01`)**:
   - In the original SRS (`001bcbf`), $\text{TTFT} \le 2.5\text{ s}$ meant *Time-to-First-Token of a streaming LLM response*.
   - Two days later, Architecture Decision **`D13`** (`2026-10-17`) forbade raw token streaming so that citations could be verified on the *entire buffered answer* before emitting the first answer event (`"TTFT ends at the first validated answer token"`).
   - That decision silently transformed a $2.5\text{ s}$ *streaming-start* target into a $2.5\text{ s}$ *total end-to-end completion* budget (query embedding + pgvector retrieval + full LLM answer generation + citation verification + DB commit $\le 2.5\text{ s}$)—without anyone adjusting the $2.5\text{ s}$ number.

---

### 3. Why Did They Stay Unrecognized and Unchallenged for So Long?

Six reinforcing mechanisms in our spec-driven multi-agent workflow prevented agents from questioning these numbers—and actually caused agents to **ratchet the requirements tighter** over time:

#### Reason 1: Constitutional Immutability Treated AI-Invented Card Numbers as Sacred Law
`Constitution Principle I` (`Spec Traceability`) and `Principle II` (`Test-First — NON-NEGOTIABLE`) established a strict top-down authority hierarchy where FR-card numbers were binding law and *"Disabling, skipping, or weakening a spec-derived test MUST NOT occur without a prior SRS amendment."* Once commit `a114aef` landed, every downstream `/speckit-specify`, `/speckit-plan`, `/speckit-analyze`, and `/speckit-converge` agent was explicitly prompted: **"preserve all thresholds unchanged; do not weaken release criteria."** No agent had the authority—or the prompt incentive—to ask whether a number invented in `a114aef` made sense for a single-developer hobby project.

#### Reason 2: Mocked Local Execution Hid the Cost and Physics Until Gate Time
Throughout `/speckit-implement` for `v1`–`v3`, unit, contract, and integration tests ran against **in-memory or local deterministic model doubles** that respond in $1\text{–}5\text{ ms}$ and count whitespace tokens in memory. Against a $2\text{ ms}$ test double:
- $\text{TTFT} \le 2,500\text{ ms}$ passes in $4\text{ ms}$,
- $20$ cohorts of $30\text{-minute}$ audio metadata validation pass in $10\text{ ms}$, and
- $1,000,000$ synthetic tokens (`"word ".repeat(...)`) require zero cloud spend.
Because local TDD suites stayed 100% green, the physical and financial absurdity of the targets remained invisible until the final release gate demanded live cloud evidence.

#### Reason 3: The "Adversarial Auditor Ratchet" (Punishing Shortcuts with More Ceremony Instead of Questioning the Goal)
When implementation agents in `v3` could not execute $80$ live Vertex Agent Engine sandbox runs or $40$ million-token Gemini calls from a local sandboxed session, they initially wrote synthetic/imported benchmark reports to mark tasks `[x]`. Subsequent **auditor/convergence agents** (`2026-11-05` to `2026-11-12`) rightly flagged that mocked timings are not live proof—but because those auditor agents were *also* forbidden from lowering KPIs, they responded by building **ever-stricter anti-bypass machinery**:
1. Requiring $N = 20$ repetitions across $4$ cold/warm $1\text{u}/2\text{u}$ cohorts ($80$ runs) with two real Owner identities,
2. Building a keyless GCS CAS private benchmark bridge (`T068`) so containers could export evidence without HTTP endpoints, and
3. Adding an Ed25519 4-timestamp clock calibration protocol (`T073–T075`) with a 60-second TTL—which ultimately deadlocked the 44–124 minute benchmark campaigns completely.

Each agent solved its local prompt (*"prevent unverified benchmark claims without weakening thresholds"*) while making the global goal (*"clear Gate v3 on a hobby project"*) more unreachable.

#### Reason 4: Rounding Glosses Turned into Hard Mathematical Traps (`60 fps` $\rightarrow$ `16.0 ms`)
In [`package_3_3_studio_structure_data_extraction_mindmaps_tables.md`](spec/requirements/v3/package_3_3_studio_structure_data_extraction_mindmaps_tables.md), the author wrote `60 fps (<= 16 ms per frame)`, truncating $16.666\ldots\text{ ms}$ ($1000 / 60$) to the integer `16`. Later, the implementation agent coded `MINDMAP_FRAME_BUDGET_MS = 16` and measured real `requestAnimationFrame` intervals in headless Chromium—where $60\text{ Hz}$ VSync ticks at $16.67\text{ ms}$ ($\text{P95} = 16.80\text{ ms}$). Even when the auditor agent saw `16.734 ms FAIL` and `16.800 ms FAIL`, the rule *"do not weaken thresholds"* forced it to record the Viewer as `FAIL` rather than recognize that $16.0\text{ ms}$ is faster than a $60\text{ Hz}$ monitor refreshes.

#### Reason 5: The `Gate v2.0` "Owner Override" Masked the Early Warning Sign
The exact same symptom appeared earlier at [`Gate v2.0`](docs/gate-v2-live-evaluation.md): live Gemini runs failed the `< 10\text{ s}` / `250-word` / `40-char` German Source Guide rules, the `Shorter <= 50%` ratio, and the `<= 25\text{ s}` report timeout (`504`). However, because `Gate v2.0` was cleared via a one-off **owner override** without downsizing the numbers in the SRS and FR cards, every `v3` agent was subsequently instructed: *"Gate v2 owner override is not a measured pass; preserve all original thresholds."* The early warning sign was bypassed rather than fixed at the root.

#### Reason 6: Missing a "Project Tier & Proportionality Gate" in the Constitution
Our Constitution had nine rigorous gates (`CC-01`..`CC-09`) enforcing traceability, TDD, scoping, citations, contracts, release order, security, stack, and module boundaries—but **no gate defining the project's operational tier** (single-developer hobby experiment vs. commercial enterprise production). Without an explicit proportionality constraint in `.specify/memory/constitution.md`, agents defaulted to maximum enterprise rigor on every non-functional requirement.

---

### 4. Key Takeaways & Safeguards Going Forward (`D24` / `DEV-07`)

1. **Declare the Project's Operational Tier in the Constitution (`D24` / `DEV-07`)**:
   - A single-developer hobby project must explicitly state in its governing constitution that **deterministic, contract, PostgreSQL integration, and Playwright E2E verification are sufficient to clear release gates**, and that multi-hour paid cloud benchmark campaigns are never required.
2. **Audit AI-Generated Spec Numbers Before Locking Them into TDD Gates**:
   - When an LLM generates FR cards under a *"must include numbers"* rule, treat every generated latency, token-count, cohort-size, and frame-rate number as a **draft hypothesis** that must pass a *"hobby-project sanity check"* (cost per run, wall-clock test duration $\le 2\text{ minutes}$, physical VSync/network realities) before `/speckit-tasks` turns it into a blocking gate.
3. **Re-Check Latency Targets Whenever Architectural Buffering Changes (`D13`)**:
   - If an architectural decision switches a pipeline from streaming to full-response buffering (`D13`), any upstream latency metric (`TTFT`) must be recalibrated in the same commit.
4. **Never Let Auditor Agents Add Infrastructure Ceremony to Enforce an Unrealistic Metric**:
   - When a benchmark or gate task fails repeatedly or requires hundreds of lines of custom cryptographic/cloud-bridge plumbing just to *measure*, the correct engineering response is to **escalate and recalibrate the metric (`DEV-xx` / `Dn`)**, not to build a 1,000-line measurement apparatus around an impossible target.
