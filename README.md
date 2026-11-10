<h1><img alt="Everlast LM: spec-driven, agent-built re-implementation of Gemini Notebook" src="docs/assets/social-preview.png" width="100%"></h1>

**A spec-driven, multi-agent re-implementation of Gemini Notebook (formerly NotebookLM) on Google Cloud.**<sup>[1]</sup>

<sub>**[1]** Everlast LM is an independent software engineering project. It is not affiliated with, endorsed by, or sponsored by Google, Everlast, or any other trademark owner. "Gemini Notebook" and "NotebookLM" are used only to describe the reference behaviour. All trademarks, copyrights and other intellectual property referenced in this repository belong to their respective owners and are used for identification and descriptive purposes only.</sub>

<p>
  <a href="https://github.com/lukas-zech-software/everlast-lm/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/lukas-zech-software/everlast-lm/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/lukas-zech-software/everlast-lm/actions/workflows/spec-integrity.yml"><img alt="Spec & Architecture Integrity" src="https://github.com/lukas-zech-software/everlast-lm/actions/workflows/spec-integrity.yml/badge.svg"></a>
  <a href="https://github.com/lukas-zech-software/everlast-lm/actions/workflows/opentofu.yml"><img alt="OpenTofu IaC" src="https://github.com/lukas-zech-software/everlast-lm/actions/workflows/opentofu.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/lukas-zech-software/everlast-lm?color=blue"></a>
  <a href="https://github.com/lukas-zech-software/everlast-lm/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/lukas-zech-software/everlast-lm"></a>
  <a href="https://github.com/users/lukas-zech-software/projects/2"><img alt="Roadmap" src="https://img.shields.io/badge/roadmap-GitHub%20Project-24292f?logo=github"></a>
</p>
<p>
  <img alt="Releases" src="https://img.shields.io/badge/releases-v1.0%E2%80%93v3.0%20implemented%20(13%20packages)-2ea44f">
  <a href="docs/gate-v1-live-evaluation.md"><img alt="Gate v1.0" src="https://img.shields.io/badge/Gate%20v1.0-passed%20live%20on%20Vertex%20AI%20(0%25%20hallucination)-2ea44f"></a>
  <a href="spec/System_Requirements_Specification_Gemeni_Notebook.md"><img alt="Requirements" src="https://img.shields.io/badge/requirements-55%20IDs%20%C2%B7%2053%20FR%20cards-informational"></a>
  <a href=".specify/memory/constitution.md"><img alt="Constitution" src="https://img.shields.io/badge/constitution-v2.1.0%20%C2%B7%20CC--01..CC--09-informational"></a>
  <a href="LESSONS_LEARNED.md"><img alt="Architecture Guardrails" src="https://img.shields.io/badge/architecture-D1..D21%20%C2%B7%20AST--enforced-blue"></a>
  <a href="https://github.com/github/spec-kit"><img alt="Spec Kit" src="https://img.shields.io/badge/GitHub%20Spec%20Kit-1.2.1-blue?logo=github"></a>
</p>
<p>
  <img alt="Agents" src="https://img.shields.io/badge/agents-Antigravity%20%C2%B7%20Claude%20Code%20%C2%B7%20Codex%20%C2%B7%20Gemini%20CLI%20%C2%B7%20Copilot-8a2be2">
  <img alt="TypeScript" src="https://img.shields.io/badge/stack-TypeScript%207%20%C2%B7%20Node%2026-3178C6?logo=typescript&logoColor=white">
  <img alt="Google Cloud" src="https://img.shields.io/badge/cloud-Cloud%20Run%20%C2%B7%20Vertex%20AI%20(europe--west4)-4285F4?logo=googlecloud&logoColor=white">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/retrieval-Cloud%20SQL%20Postgres%20%2B%20pgvector%20RRF-4169E1?logo=postgresql&logoColor=white">
  <img alt="OpenTofu" src="https://img.shields.io/badge/IaC-OpenTofu-FFDA18?logo=opentofu&logoColor=black">
</p>

> **The starting point:** *"Build a NotebookLM clone. Implementation, scope and structure are up to you."*
>
> **Why I built it this way:** Rather than building a quick demo, I used this open-ended challenge to deeply learn and stress-test **spec-driven, multi-agent software engineering at production scale**—finding out first-hand what it takes to steer autonomous coding agents from a blank repository to a multi-service cloud platform without writing application code by hand.
>
> First, the entire reference product was decomposed into a formal specification (55 requirement IDs, 150 EARS statements, 96 Gherkin scenarios), a project constitution, and a binding solution architecture. Then, autonomous agent sessions implemented **Releases v1.0 through v3.0** test-first across isolated Git worktrees. When scaling across parallel agents exposed real architectural drift despite 100 % passing functional and LLM-judged tests, I diagnosed the failure modes and engineered AST-level boundary guardrails ([`LESSONS_LEARNED.md`](LESSONS_LEARNED.md)). Nearly every file in this repository was authored by coding agents—my role was **systems architecture, governance design, verification, and course-correction**.

---

## Contents

1. [At a glance](#at-a-glance)
2. [The engineering journey & lessons learned](#the-engineering-journey--lessons-learned)
3. [System architecture & monorepo layout](#system-architecture--monorepo-layout)
4. [Specification depth & Constitution v2.1.0](#specification-depth--constitution-v210)
5. [Multi-agent orchestration & Spec Kit workflow](#multi-agent-orchestration--spec-kit-workflow)
6. [Release status & roadmap (v1.0 – v6.0)](#release-status--roadmap-v10--v60)
7. [Quickstart & verification commands](#quickstart--verification-commands)

---

## At a glance

| Area | Current state on `main` |
| :- | :- |
| **Implemented scope** | **Releases v1.0, v2.0 & v3.0 complete** across 13 Spec Kit feature packages ([`specs/001`..`013`](specs/)): grounded chat with inline citations, PDF/Markdown/Office/Drive/Web/Audio/Video ingestion, Source Guides, Notes pinboard, Studio reports, interactive SVG Mindmaps, Data Tables, Agent Platform Python sandbox, and ≥ 1M-token context scaling |
| **Codebase scale** | **429 TypeScript files**, **228 test suites** (unit, contract, PostgreSQL integration, Playwright E2E, and AST architecture fixtures), **11 SQL migrations** (`0001`..`0011`), 4 deployable services (`apps/*`) + 5 shared packages (`packages/*`) |
| **Live AI evaluation** | **[Gate v1.0 passed live on Vertex AI (`europe-west4`)](docs/gate-v1-live-evaluation.md)**: **0 % hallucination** (`NFR-EVAL-01`), **100 % citation precision & support** (`NFR-EVAL-02`), **100 % out-of-source refusal** (`NFR-EVAL-03`), **0 deselected-source leakage** (`NFR-EVAL-04`), and **54 ms P95** citation scroll-to-passage; 222-case deterministic golden suite runs on every PR |
| **Requirements** | 55 traceable IDs (`FR-*`, `NFR-*`) + 3 core contracts (`C-01`..`C-03`) in the [SRS](spec/System_Requirements_Specification_Gemeni_Notebook.md); **53 FR cards** (~36,000 words, **150 EARS statements**, **96 Gherkin scenarios**) audited across all 19 packages ([audit log](docs/requirements-consistency-audit.md)) |
| **Architecture & IaC** | 21 recorded decisions (`D1`..`D21`) and 5 tracked deviations (`DEV-01`..`DEV-05`) in [`docs/solution-architecture.md`](docs/solution-architecture.md); full [OpenTofu IaC](infra/README.md) (`dev` / `staging` / `prod`) with keyless GitHub OIDC Workload Identity Federation |
| **Governance** | [Constitution v2.1.0](.specify/memory/constitution.md) with 6 principles, bidirectional spec flow-back, and **9 executable gates (`CC-01`..`CC-09`)**, including an AST + TypeScript module-resolution dependency checker ([`scripts/check-architecture.mjs`](scripts/check-architecture.mjs)) |

---

## The engineering journey & lessons learned

My primary motivation for this project was to move beyond ad-hoc "vibe coding" and learn how to engineer a **repeatable, self-verifying harness for autonomous coding agents**. That journey unfolded in three distinct phases—each revealing a deeper layer of what multi-agent engineering actually requires.

```mermaid
flowchart LR
    subgraph Phase1["1. Elimination of Ambiguity"]
        A["Reference Product<br/>Analysis"] --> B["SRS (55 IDs) &<br/>53 EARS/Gherkin Cards"]
        B --> C["19-Package Consistency<br/>Audit & Constitution v1.1"]
    end
    subgraph Phase2["2. Multi-Agent Delivery (v1–v3)"]
        C --> D["v1.0 MVP & Live<br/>Vertex AI Gate (PASS)"]
        D --> E["v2.0 Cloud Run PoC &<br/>Postgres Migration (013)"]
        E --> F["v3.0 Multimodal, Sandbox,<br/>Mindmaps & 1M+ Tokens"]
    end
    subgraph Phase3["3. Architectural Guardrails (CC-09)"]
        F --> G["Static Audit: 293 Drift<br/>Violations Discovered"]
        G --> H["Constitution v2.1 (CC-09)<br/>& Decision D21"]
        H --> I["AST Boundary Checker &<br/>Fingerprinted Debt Ratchet"]
    end
```

### Phase 1: Why classic upfront specification is the cheapest way to steer AI agents

Coding agents are fast and tireless, but they fill every gap in a prompt with their own silent assumption. In a multi-package system, small guesses compound into incompatible interfaces. Ironically, the newest AI technology brings back the oldest software engineering discipline: **remove the ambiguity before writing code**.

1. **Formal EARS + Gherkin decomposition:** Every feature was broken down into ubiquitous, event-driven, state-driven, and unwanted-behavior EARS rules paired with Gherkin scenarios and exact numeric limits (e.g., Unicode code-point counting, `200,000,000`-byte inclusive upload caps, zero chat-history leakage when a source is deselected).
2. **Pre-specification consistency audit:** Before running `/speckit-specify` on a single package, all 19 packages and 53 FR cards were audited against the SRS, constitution, and architecture ([`docs/requirements-consistency-audit.md`](docs/requirements-consistency-audit.md)). Every batch surfaced real contradictions—such as untestable "A or B" phrasing or subtle clashes between role phasing (`v1–v5` Owner-only vs. `v6` RBAC) and feature cards—that would otherwise have hardened into conflicting tests.

### Phase 2: From specs to live cloud evaluations (Releases v1.0 → v3.0)

With the specification locked and test-first (`CC-02`, Red → Green → Refactor) enforced, coding agents implemented 13 feature packages across isolated worktrees:

- **Calibrating LLM-as-a-Judge in [Gate v1.0](docs/gate-v1-live-evaluation.md):** Unit tests prove plumbing, not model behavior. Running our 50-case stratified sample live against Gemini 2.5 Flash on Vertex AI (`europe-west4`) failed twice before passing on Run 3—not because the product hallucinated, but because (1) a test PDF builder encoded `€` as `?` and (2) the judge evaluated claim sentences in isolation without resolving pronouns like *"Its budget is…"*. Fixing the fixture and requiring self-contained subject naming in answers achieved **0 % hallucination** and **100 % citation precision** without relaxing a single gate threshold.
- **Pragmatic PoC staging vs. durable state (`DEV-04` → `specs/013`):** To get a live v2.0 proof of concept onto Cloud Run quickly for stakeholder review ([`docs/gate-v2-live-evaluation.md`](docs/gate-v2-live-evaluation.md)), v2 state was initially permitted in process memory under recorded decision `D16` / `DEV-04`. Before starting v3.0, `specs/013-v2-persistence-postgres` migrated all v2 tables (`0005`–`0008`) into PostgreSQL and closed `DEV-04` cleanly.
- **Bidirectional spec flow-back (`Constitution v2.0.0`):** Implementation inevitably uncovers cloud provider realities (for example, `D18`–`D20` aligning the `FR-GC-08` code sandbox with Google Agent Platform's 2 vCPU / 1.5 GB RAM profile and 15.0 s application-enforced deadline). We institutionalized a **flow-back rule**: downstream discoveries must be written back into `spec.md`, the upstream FR card, and `docs/solution-architecture.md` (`Dn`) so specifications never rot behind the code.

### Phase 3: Why passing tests and `tsc -b` were not enough ([`LESSONS_LEARNED.md`](LESSONS_LEARNED.md))

The most valuable engineering lesson happened after Releases v1.0 through v3.0 were feature-complete. Every functional spec check, TypeScript build (`tsc -b`), integration test, and `NFR-EVAL-01..04` grounding benchmark was green. Yet a dedicated static architecture review ([`docs/architecture-refactoring-baseline.md`](docs/architecture-refactoring-baseline.md)) uncovered **293 architectural boundary violations** across three systemic patterns:

1. **Deployment apps imported as shared libraries (`R1` — 58 cross-app & 39 shared-to-app imports):** `apps/api` depended directly on `@everlast/worker` to reuse Studio dispatchers and Source Guide runtime helpers, while `packages/evals` reached directly into `apps/api/src/*` and `apps/worker/src/*`.
2. **Wildcard exports & deep-import bypasses (`R3` — 186 deep imports & 7 `"./*"` wildcards):** Workspace `package.json` files exposed `"./*": "./src/*.ts"`, allowing agents to bypass public `index.ts` entrypoints (including 50+ cross-package imports of `@everlast/db/testing`).
3. **Inconsistent workflow ownership (`R2`):** Some HTTP route handlers (`apps/api/src/routes/notebooks.ts`) coordinated multi-step database operations, quota calculations, and background job cancellation directly inside transport code.

#### Root-cause reflection: why autonomous agents created this drift

| Observed agent behavior | Why it happened |
| :- | :- |
| **1. Optimizing for the shortest path to green** | When tasked with triggering worker logic from the API, the lowest-friction path to a passing test is adding `"@everlast/worker": "workspace:*"` and `"./*": "./src/*.ts"`. Without a failing lint gate on dependency direction, any workspace file looks reusable. |
| **2. `tsc -b` checks types, not architecture** | A green typecheck only proves imported symbols align—it cannot distinguish a shared contract (`packages/contracts`) from a deployable Cloud Run entrypoint (`apps/worker`), nor does it block `import type` or barrel re-exports from coupling module graphs. |
| **3. Behavioral specs don't constrain file topology** | Gates `CC-01`..`CC-08` verified *what* the system did (grounding, citations, quotas), not *where* code lived or which package owned a workflow. What is not checked in `plan.md` and `pnpm lint` is invisible during `/speckit-implement`. |
| **4. Broken windows become agent templates** | Agents pattern-match against surrounding files. Once one package introduced `"./*"` or imported `@everlast/db/testing`, subsequent agents working on later packages (such as Package 3.4) copied the exact same pattern across new test files. |
| **5. Silent baseline drift across parallel worktrees** | While preparing the governance PR on an isolated baseline, `main` advanced by 21 commits—adding new files under legacy `"./*"` exports and 7 new deep imports, and even triggering a CodeQL alert on single-occurrence `.replace('*', ...)` in the checker itself. |

#### How we closed the gap without a risky big-bang rewrite ([PR #187](https://github.com/lukas-zech-software/everlast-lm/pull/187), `CC-09` & `D21`)

Instead of relying on prose reminders in `AGENTS.md` that agents forget under context pressure, we engineered five executable controls ([`docs/agent-architecture-guardrails.md`](docs/agent-architecture-guardrails.md)):

- **AST + TypeScript module-resolution checker ([`scripts/check-architecture.mjs`](scripts/check-architecture.mjs)):** Inspects `import`, `import type`, `export * from`, `require()`, dynamic `import()`, and `tsconfig.json` `paths` using a pinned TypeScript compiler AST—preventing alias or re-export laundering.
- **Exact fingerprinted debt ratchet ([`scripts/architecture-policy.json`](scripts/architecture-policy.json) under `D21`):** Rather than a blanket allowlist, each of the 293 legacy violations is pinned by `{ rule, from, to, fingerprint, count, baseline, owner, decision, removalTask, expires }`. Adding a second import in the same file, importing a new symbol, or adding a new file under a legacy `"./*"` export immediately breaks the fingerprint and fails `pnpm lint`.
- **Self-cleaning exceptions:** When a refactoring task completes or an exception is fixed, leaving the stale record in `architecture-policy.json` fails CI (`stale-exception` / `completed-or-missing-removal-task`).
- **PR `--base-ref` policy comparison:** In CI, `check-architecture.mjs --base-ref BASE_SHA` blocks any feature PR from adding new exceptions or extending expiry dates (`exception-expansion`).
- **Changed-feature artifact gate (`CC-09`, [`scripts/check-architecture-artifacts.mjs`](scripts/check-architecture-artifacts.mjs)):** Any PR touching `apps/*`, `packages/*`, or a feature's `specs/<NNN>-*/` must include a populated `## Architecture Boundary Evidence` table in `plan.md`, without forcing retroactive churn across untouched historical specs.

> Full write-up: **[`LESSONS_LEARNED.md`](LESSONS_LEARNED.md)** · **[`docs/architecture-refactoring-baseline.md`](docs/architecture-refactoring-baseline.md)** · **[`docs/agent-architecture-guardrails.md`](docs/agent-architecture-guardrails.md)**

---

## System architecture & monorepo layout

Everlast LM is a **serverless TypeScript monorepo** on Google Cloud (`europe-west4`) designed to scale to zero when idle, with a single Cloud SQL for PostgreSQL instance (`relational` + `pgvector` + full-text search with Reciprocal Rank Fusion) as the sole fixed-cost data store.

```mermaid
graph LR
    U([SPA · apps/web]) -->|OIDC + SSE| API["apps/api<br/>BFF · RBAC · ADK chat agent"]
    U -.->|WebSocket audio, v5| LIVE["everlast-live (planned v5)<br/>Gemini Live gateway"]
    API --> SCP["C-02 ScopedContextProvider<br/>packages/db"]
    LIVE -.-> SCP
    API -->|Cloud Tasks| WRK["apps/worker<br/>ingestion · Source Guide · Studio plugins"]
    WRK --> SCP
    WRK --> RND["apps/render<br/>Cloud Run Job · OOXML/media normalizer"]
    SCP -->|"hybrid search (pgvector + FTS RRF)<br/>+ hard snapshot & ACL filter"| SQL[("Cloud SQL Postgres<br/>chunks · source_pages · studio · notes")]
    API --> GEM["Vertex AI Gemini<br/>(europe-west4 enterprise endpoints)"]
    WRK --> GEM
    API -->|sandboxed Python| SBX["Agent Platform<br/>Code Execution Sandbox"]
```

### Repository structure

```text
everlast-lm/
├── README.md                          ← project overview, architecture & engineering journey
├── LESSONS_LEARNED.md                 ← developer journal: multi-agent drift & AST guardrail design
├── AGENTS.md / CLAUDE.md              ← shared operating manual for all coding agents (worktree-first, CC-09)
├── apps/
│   ├── api/                           ← HTTP/SSE BFF, ADK grounded chat agent, auth & notebook services
│   ├── web/                           ← 3-panel Notebook workspace SPA (Sources, Chat, Studio & Inspector)
│   ├── worker/                        ← async ingestion, Source Guide & C-03 Studio plugins (reports, mindmaps, tables)
│   └── render/                        ← isolated OOXML sanitizer (.docx/.pptx) & multimodal normalization service
├── packages/
│   ├── contracts/                     ← shared Zod schemas: C-01..C-03, API payloads & v1–v3 domain contracts
│   ├── db/                            ← PostgreSQL repositories, 11 SQL migrations, C-02 ScopedContextProvider & RRF search
│   ├── cloud/                         ← Vertex AI Gemini, Document AI OCR, Drive, Speech & Agent Platform sandbox adapters
│   ├── evals/                         ← 222-case golden dataset, deterministic PR checks & Vertex AI LLM-as-a-judge runner
│   └── testkit/                       ← shared test fixtures and deterministic doubles
├── specs/                             ← 13 completed Spec Kit feature directories (001-workspace-foundation .. 013-v2-persistence-postgres)
├── spec/
│   ├── System_Requirements_Specification_Gemeni_Notebook.md   ← SRS: 55 IDs, contracts C-01..C-03, release gates & DEV-01..05
│   └── requirements/                  ← 53 EARS + Gherkin FR cards across v1/ .. v6/ + cross-package rules
├── docs/
│   ├── solution-architecture.md       ← binding architecture decisions D1–D21, component design & risk register
│   ├── architecture-refactoring-baseline.md ← static review identifying R1–R3 boundary drift
│   ├── agent-architecture-guardrails.md     ← CC-09 dependency matrix, exception rules & verification procedure
│   ├── gate-v1-live-evaluation.md     ← live Vertex AI evaluation report for Gate v1.0
│   └── gate-v2-live-evaluation.md     ← live Vertex AI & Cloud Run PoC record for Gate v2.0
├── infra/                             ← OpenTofu IaC modules & environments (dev, staging, prod)
├── scripts/                           ← spec integrity, AST architecture checker, fingerprinted policy & eval runners
└── .specify/                          ← Constitution v2.1.0, template overrides & pipeline verification overlay
```

### Core architectural contracts & design choices

- **Three immutable cross-release contracts in `packages/contracts` (`CC-05`):**
  - `C-01 UnifiedDocumentChunk`: The single normalized representation emitted by all text, PDF, Office, web, and audio/video ingestion adapters (with page/bounding-box and media timestamp locators).
  - `C-02 ScopedContextProvider`: The **only** permitted read path to source content (`getScopedContext(notebook_id, active_source_ids)`), enforcing submission-time `(source_id, revision)` snapshots, server-side authorization re-checks, and zero leakage (`NFR-EVAL-04`).
  - `C-03 StudioGeneratorPlugin`: Open-closed plugin contract governing all Studio artifacts (`Queued → Running → Completed | Failed | Cancelled`) with pre-publication citation validation (`D13`).
- **Agentic loops vs. deterministic pipelines (`CC-05`):** Google ADK `LlmAgent` loops are restricted to components that dynamically choose tools (grounded chat, note assistant, deep research). Ingestion, Source Guides, and Studio generators run as deterministic pipelines with structured outputs—keeping latency, cost, and non-determinism low.

<details>
<summary><strong>All 21 Architecture Decisions (<code>D1</code>–<code>D21</code>) & 5 Spec Deviations (<code>DEV-01</code>–<code>DEV-05</code>)</strong></summary>

<br>

| ID | Topic | Binding decision |
| :- | :- | :- |
| `D1` | Retrieval engine | Cloud SQL PostgreSQL `pgvector` + full-text search (`tsvector`) with Reciprocal Rank Fusion (RRF). Owning chunk IDs and locators guarantees citation precision and zero leakage by construction (replaces Vertex RAG Engine and its always-on Spanner cost). |
| `D2` | Language & contracts | TypeScript end-to-end; shared Zod v4 schemas in `packages/contracts`. |
| `D3` | Data residency | EU (`europe-west4`) by default; explicit per-feature region exception map when a model is not yet available in `europe-west4`. |
| `D4` | Operating model | Serverless Cloud Run services/jobs scaling to zero + one Cloud SQL PostgreSQL instance as the sole fixed cost. |
| `D5` | `@Notebook` integration (`DEV-03`) | Package 6.3 (`FR-INT-01`) and Gate v6.0 #3 are deferred; chat agent remains stateless behind `C-02` and A2A-ready. |
| `D6` | Identity | Generic OIDC/SAML via Google Identity Platform. |
| `D7` | Live "Join-In" voice (`DEV-01`) | One designated host answers live interruptions in that host's voice via Gemini Live grounded through `C-02`, then podcast playback resumes. |
| `D8` | Slide Deck export (`DEV-02`) | `.pptx` and `.pdf` export only; Google Slides export is deferred (requires per-user OAuth). |
| `D9` | Infographics (`FR-ST-17`) | Deterministic structured-layout-to-SVG rendering with PNG export (no image generation model, keeping text and numbers verifiable). |
| `D10` | Audio share links (`FR-ST-04`) | Moved from v5.0 to v6.0 because share-link permissions depend on v6 RBAC roles (`FR-WM-05`). |
| `D11` | Google Docs/Slides import | Delegated v3 Google Drive read adapter exporting into the existing Office normalization pipeline. |
| `D12` | Large Studio contexts | Above model context capacity, map-reduce over **all original scoped chunks** (`ChunkMapReduce`); summaries alone are never treated as lossless evidence. |
| `D13` | Pre-publication citation validation | Buffer factual answers until all citation IDs validate against scoped `C-01` chunks; progress events stream during validation but do not count toward TTFT. |
| `D14` | Infrastructure as Code | OpenTofu (`tofu >= 1.6`) in `infra/` for MPL-2.0 open-source licensing and GCS state compatibility. |
| `D15` | Canonical viewer text | Stored in PostgreSQL `source_pages` within the same transaction as `chunks` and the `Ready` state transition, guaranteeing atomic cascade deletion. |
| `D16` | v2 persistence (`DEV-04` closed) | After initial in-memory PoC delivery (`DEV-04`), `specs/013` migrated all v2 state to PostgreSQL (`0005`–`0008`). Single-API-instance background sweeps recover interrupted Studio reports/Guides on startup. |
| `D17` | Warm-service latency (`DEV-05`) | The 2.5 s P95 target (`NFR-PERF-01`) applies to warm requests; cold-start wake-up delays are measured and reported separately. |
| `D18` | Code sandbox resources | Adopts Google Agent Platform's managed **2 vCPU / 1.5 GB RAM** default profile with zero network access. |
| `D19` | Managed sandbox acceptance | Adopts Agent Platform Code Execution directly and retires the separate R6 qualification spike. |
| `D20` | Sandbox runtime limits | Enforces a 15.0 s application deadline per attempt, fresh ephemeral sandboxes, copy-only inputs (≤ 100 MB), and automatic teardown. |
| `D21` | Incremental architecture enforcement | Enforces `CC-09` via `scripts/check-architecture.mjs` (pinned TypeScript compiler AST) and a fingerprinted, self-expiring migration inventory (`scripts/architecture-policy.json`, expires `2027-02-05`). |

</details>

---

## Specification depth & Constitution v2.1.0

Agents operate under a strict four-tier **Source of Truth** hierarchy so conflicts are never resolved by guesswork:

| Rank | Document | Authority |
| :-: | :- | :- |
| **1** | **[`.specify/memory/constitution.md`](.specify/memory/constitution.md)** (v2.1.0) | Supreme governance: Principles I–VI, bidirectional spec flow-back, and gates `CC-01`..`CC-09` |
| **2** | **[SRS](spec/System_Requirements_Specification_Gemeni_Notebook.md)** | Index of all 55 `FR-*`/`NFR-*` IDs, contracts `C-01`..`C-03`, release gates, and `DEV-01`..`DEV-05` |
| **3** | **[FR cards & rules](spec/requirements/README.md)** | 53 detailed EARS + Gherkin requirement cards (`v1/`..`v6/`) and binding cross-package invariants |
| **4** | **[Solution architecture](docs/solution-architecture.md)** | Binding technical decisions `D1`..`D21`, component topology, and risk controls |

### The 9 Constitution Check Gates (`CC-01`..`CC-09`)

Every feature `plan.md` (before research and after design), every `/speckit-analyze` run, and every pull request is verified against nine gates:

| Gate | Principle | Enforced invariant |
| :-: | :- | :- |
| `CC-01` | **I. Traceability & Flow-Back** | Every spec, plan, task, and test cites an SRS ID; downstream clarifications and implementation discoveries flow back into `spec.md`, FR cards, SRS, and `Dn`. |
| `CC-02` | **II. Test-First (Non-Negotiable)** | Spec-derived failing tests (`Red → Green → Refactor`) precede implementation tasks in `tasks.md` and assert exact EARS/Gherkin rules and numeric limits. |
| `CC-03` | **III. Scope & Snapshot** | All source reads pass through `C-02` with explicit `Ready` source IDs, submission-time `(source_id, revision)` snapshots, and authorization re-checks. |
| `CC-04` | **III. Citations & Zero Leakage** | Pre-publication citation validation (`D13`, `NFR-EVAL-02/03`), immediate refusal on invalid citations, and zero deselected/revoked source leakage (`NFR-EVAL-04`) across chat history, caches, and drilldowns. |
| `CC-05` | **IV. Contracts & Pipelines** | Single canonical `C-01..C-03` Zod schemas in `packages/contracts`; deterministic pipelines everywhere except where dynamic tool selection requires ADK `LlmAgent`. |
| `CC-06` | **V. Release & Package Order** | Honors `Gate v(k)` and within-release package prerequisites; blocks deferred scope (`D5`/`DEV-03`, `D8`/`DEV-02`, `D10` before `v6.0`). |
| `CC-07` | **VI. Security, RBAC & Residency** | Server-side auth (`Owner`-only in `v1–v5`, RBAC in `v6`), atomic quota slot reservation, enterprise no-training endpoints (`NFR-SEC-01`), and `europe-west4` residency. |
| `CC-08` | **Platform & Cost Discipline** | Adheres to the pnpm TypeScript / Cloud Run / single Cloud SQL Postgres stack without unapproved frameworks or fixed-idle-cost resources. |
| `CC-09` | **IV. Architectural Boundaries** | Declares module ownership, public exports, dependency directions, and composition roots in `plan.md`; enforced by `pnpm check:architecture` and `pnpm check:architecture-artifacts`. |

---

## Multi-agent orchestration & Spec Kit workflow

This repository was built without manual application coding by orchestrating multiple specialized agents through one shared operating manual ([`AGENTS.md`](AGENTS.md)):

| Agent / Environment | Integration | Primary role across the project |
| :- | :- | :- |
| **Claude Code** (Opus) | Terminal CLI | Constitution amendments, 19-package FR card consistency audit, architecture revisions, multi-agent coordination rules, and complex convergence debugging |
| **Codex** | ACP in JetBrains Air & CLI | End-to-end feature implementation across v1–v3 worktrees, AST architecture checker & fingerprinted policy (`PR #187`), and PostgreSQL persistence migrations |
| **Antigravity (`agy`)** | Google Agentic IDE & subagents | Google Cloud architecture design, Spec Kit pipeline orchestration, and sequential/parallel subagent execution |
| **Gemini CLI & Web Canvas** | ACP in JetBrains Air & Browser | Initial SRS domain decomposition, requirements analysis, and targeted package edits |
| **GitHub Copilot** | `.github/skills/speckit-*` & Actions | Repository-native Spec Kit skills and automated PR review |

### How parallel and sequential agents stay synchronized

- **Mandatory worktree-first isolation:** Every agent task begins by creating a dedicated Git worktree and feature branch, pinning its active Spec Kit feature in `.specify/feature.json` (eliminating cross-terminal `SPECIFY_FEATURE_DIRECTORY` collisions).
- **Dependency-aware subagent orchestration:** When decomposing a multi-package release (such as v3.0's four packages), agents inspect the prerequisite graph in [`spec/requirements/README.md`](spec/requirements/README.md#package-prerequisites):
  - *Interdependent packages* execute sequentially—one subagent per package, with each new worktree branching directly off the previous agent's completed branch.
  - *Independent packages* execute concurrently in separate worktrees with disjoint file ownership.
- **Custom Spec Kit pipeline & verification overlay:** Project-owned template overrides ([`.specify/templates/overrides/`](.specify/templates/overrides/)) and the [pipeline verification overlay](docs/spec-kit-workflow-overlays.md) enforce the full 7-stage lifecycle (`specify → clarify → plan → tasks → analyze → implement → converge`) with mandatory completion review and `CC-01`..`CC-09` checks that survive Spec Kit CLI upgrades.

---

## Release status & roadmap (v1.0 – v6.0)

Progress is tracked in the **[Everlast LM – Produkt-Roadmap](https://github.com/users/lukas-zech-software/projects/2)** GitHub Project (89 issues across 19 package epics, 57 requirement issues, 3 contract issues, and 6 release gates, synchronized via `pnpm sync:project`).

| Release | Milestone focus | Spec Kit packages | Status |
| :- | :- | :- | :- |
| **v1.0 MVP** | Workspace foundation, PDF/text ingestion, Source Inspector, Grounded Chat & Citation Engine, 3-panel UI & eval harness | `001` (`1.1`), `002` (`1.2`), `003` (`1.3`), `004` (`1.4`) | **Implemented & [Gate v1.0 Passed Live](docs/gate-v1-live-evaluation.md)** |
| **v2.0** | UI comfort & language prefs, automatic Source Guides, chat style controls, Notes pinboard & AI actions, `C-03` Studio text reports + Postgres persistence | `005` (`2.1`), `006` (`2.2`), `007` (`2.3`), `008` (`2.4`), `013` (Postgres migration) | **Implemented & [Deployed to Dev Cloud Run](docs/gate-v2-live-evaluation.md)** |
| **v3.0** | Multimodal ingestion (audio/video transcript sync, Office, Drive, safe Web), Agent Platform Python code sandbox, interactive SVG Mindmaps & Data Tables, ≥ 1M-token context scaling | `009` (`3.1`), `010` (`3.2`), `011` (`3.3`), `012` (`3.4`) | **Implemented on `main` (4/4 packages merged)** |
| **Pre-v4 Refactoring** | Burn down the 293 fingerprinted `D21` migration records: extract shared API/worker workflows (`R1`), tighten public package exports (`R3`), and unify notebook route services (`R2`) | Governed by [`CC-09` & `D21`](docs/architecture-refactoring-baseline.md) | **Guardrails active in CI (`PR #187`); extraction queued** |
| **v4.0** | Studio Active Learning Suite (Flashcards, Quizzes, Learning Overview) & Deterministic Visuals (`.pptx`/`.pdf` Slide Decks, SVG Infographics) | Packages `4.1` – `4.2` | **FR cards audited & ready for `/speckit-specify`** |
| **v5.0** | Dialogic Audio Overviews, single-host Gemini Live "Join-In" voice (`D7`/`DEV-01`), and narrated Video Overviews | Packages `5.1` – `5.2` | **FR cards audited & ready for `/speckit-specify`** |
| **v6.0** | Enterprise RBAC (`Owner`, `Editor`, `Viewer Full`, `Viewer Chat-Only`), audio share links (`D10`), usage analytics, and autonomous Deep Research agents | Packages `6.1` – `6.2` (`6.3` deferred per `D5`) | **FR cards audited & ready for `/speckit-specify`** |

---

## Quickstart & verification commands

### Prerequisites

- **Node.js** `^26.0.0` and **pnpm** `12.0.0` (enabled via Corepack)
- **Docker** (for local PostgreSQL 16 + `pgvector` integration and evaluation suites)

### Install & verify all static, unit, and architectural gates

```bash
pnpm install --frozen-lockfile

# Run spec integrity, TypeScript project references, AST architecture fixtures,
# fingerprinted dependency boundary checks (CC-09), and changed-feature artifact checks:
pnpm lint

# Run the AST architecture checker and its positive/negative regression suite directly:
pnpm test:architecture
pnpm check:architecture

# Run unit and contract suites (packages/contracts + 47 unit suites):
pnpm test:unit
pnpm test:contract
```

### Run database integration tests, deterministic evals & local dev stack

```bash
# Start local PostgreSQL 16 + pgvector container and apply migrations 0001..0011:
pnpm db:test:up

# Run PostgreSQL + pgvector integration suites and the 222-case deterministic eval gate
# (verifying NFR-EVAL-02 citation precision = 1.0 and NFR-EVAL-04 deselected-source leakage = 0):
pnpm test:integration
pnpm eval:deterministic

# Launch the full local development stack (API, Worker, Render & Web SPA):
pnpm dev
```

<details>
<summary><strong>Running live Vertex AI release-gate evaluations (<code> europe-west4 </code>)</strong></summary>

<br>

Live release-gate evaluations (`NFR-EVAL-01..04` 50-case stratified sample with Gemini 2.5 Flash and Flash-Lite judge on Vertex AI, plus `v3.0` multimodal, code-sandbox, and 1M-token scale benchmarks) require keyless Google Cloud Application Default Credentials in `europe-west4`:

```bash
gcloud auth application-default login

TEST_DATABASE_URL=postgres://everlast:everlast@127.0.0.1:54329/everlast \
VERTEX_PROJECT=<gcp-project-id> \
VERTEX_LOCATION=europe-west4 \
DOCUMENT_AI_PROCESSOR_NAME=projects/<gcp-project-id>/locations/eu/processors/<processor-id> \
pnpm eval:judged
```

See [`docs/gate-v1-live-evaluation.md`](docs/gate-v1-live-evaluation.md) and [`infra/README.md`](infra/README.md) for full cloud setup and OpenTofu deployment instructions.

</details>

---

## License and contributing

Licensed under the [Apache License 2.0](LICENSE). See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the workflow, [`SECURITY.md`](SECURITY.md) for reporting vulnerabilities, and the [Code of Conduct](CODE_OF_CONDUCT.md).
