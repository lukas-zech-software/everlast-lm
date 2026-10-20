# Research: Quantitative Code Execution Sandbox

Date: 2026-10-20. Scope: FR-GC-08, C-01/C-02, NFR-SEC-01/02, NFR-EVAL-01..04.

## Runtime feasibility (FR-GC-08, R6)

**Decision:** Owner selected Option A on 2026-10-20: preserve all strict caps and hold planning completion until R6 establishes a conforming runtime. Expected workload is one or two simultaneous users. This resolves the product choice but does not supply runtime evidence. The documented managed default is not admitted. The existing Pyodide fallback remains a candidate for qualification, not a demonstrated secure deployment. [R6 feasibility](r6-feasibility.md) records the bounded investigation and missing evidence.

**Evidence:** Google's [current quickstart](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/sandbox/code-execution-quickstart), retrieved with ketch.scrape on 2026-10-20, documents a default of 2 vCPU / 1.5 GB RAM and an optional 4 vCPU / 4 GB configuration. Both exceed the card's ≤1 vCPU / ≤512 MB caps. The [overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/sandbox/code-execution-overview) describes no network, file input/output and the required numerical libraries. It does not establish exact app resource limits, immutable input mounts or enforced 15-second destruction. A client timeout does not prove execution stopped. Older Vertex documentation paths redirected to a general overview; the canonical pages above were used instead.

**Rationale:** This is a known documented configuration mismatch, separate from future runtime measurements. Treating it merely as a performance test would conceal a design decision.

**Alternatives considered:** Built-in Gemini code execution provides less control over files and limits; native unrestricted Python in the API violates isolation. Architecture's existing fallback is Pyodide in Cloud Run with no egress. Pyodide alone is not sufficient proof: its [worker guide](https://pyodide.org/en/stable/usage/webworker.html) demonstrates execution in a separate JavaScript context, not a security boundary. Its [JavaScript API](https://pyodide.org/en/stable/usage/api/js-api.html) exposes host interoperability and optional filesystem/network integration. A fallback must independently deny host/network capabilities, bound all memory/temp storage, and enforce externally controlled termination; simply removing a Python import or using a worker is insufficient.

## Scoped data transfer (FR-GC-08, C-01/C-02)

**Decision:** Build an immutable input manifest from existing C-02 results; each table/value retains source/revision and C-01 chunk IDs. Transfer explicit data bytes rather than cloud URLs or credentials. Do not modify C-01 or add a direct database read API for the tool.

**Rationale:** Package 3.1 retains the existing locator union and snapshot fences. Existing chat context/publication guards should own authorization. Tool input extraction must not infer missing values.

**Alternatives considered:** Raw source bucket access would bypass C-02 and leak credentials. Re-querying latest revisions inside an attempt would violate submission-time snapshots.

## Execution and retry ownership (FR-GC-08)

**Decision:** ADK chooses whether computation is necessary and produces Python; a deterministic execution controller owns caps, lifecycle, publication and the single exception retry. Each attempt gets a fresh sandbox and identical immutable input snapshot. No ambiguous statistical calculation starts before a focused answer. A clarification reply is a new submission using current explicit scope and a fresh snapshot; it does not resurrect prior selections.

**Rationale:** Prevent model-controlled retry loops, reused state contamination and unauthorized follow-up data. Only a reported Python exception on attempt 1 can trigger attempt 2. Provider transport uncertainty does not authorize another execution.

**Alternatives considered:** Managed sessions shared across turns/attempts can leak memory/files. Retrying every failure could double-run an unknown outcome or evade timeout caps.

## Persistence and chart delivery (FR-GC-08, FR-GC-06, NFR-SEC-02)

**Decision:** Add nullable, versioned JSON trace to existing chat_messages with 1–2 ordered attempts and final/published identifiers. Existing ordinary messages remain readable. Persist private artifact identities and expose application-authorized chart URLs; never retain a reusable public object URL as authority. Extend existing clear/deletion/revocation guards to every attempt and chart.

**Rationale:** Current ChatMessageSchema is strict and history SELECT/INSERT mappings omit traces; all must change together. Merely adding a DB column loses trace data on reload. Existing in-memory stores are test doubles, not production persistence evidence.

**Alternatives considered:** A new session datastore duplicates Cloud SQL. A bearer signed URL alone cannot meet immediate revocation. Inline untrusted SVG can execute browser content; sanitize an allowlisted SVG or reject, and decode/check PNG before publication.

## Repository integration (FR-GC-08, CC-01/CC-02)

**Decision:** Extend apps/api/src/chat/{agent,publication,transport}.ts, existing chat routes, packages/contracts/src/package-v1-3.ts and packages/db/src/chat-history.ts; place new execution types in package-v3-2.ts. Use current Node 24 / TypeScript 5 / pnpm workspace tooling and existing Vitest/Playwright runners.

**Rationale:** Current code has grounded model adapters and buffered transport but no sandbox controller, trace schema or chart route. Existing dev and db:migrate scripts print readiness text; they do not demonstrate a runnable deployed feature. Preserve existing per-user/thread admission and generation epoch cancellation rather than creating a second admission system.

**Alternatives considered:** A separate public execute-code endpoint broadens scope to arbitrary code; a separate agent framework or database violates the fixed stack.
