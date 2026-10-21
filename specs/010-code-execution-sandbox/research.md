# Research: Quantitative Code Execution Sandbox

Date: 2026-10-20. Scope: FR-GC-08, C-01/C-02, NFR-SEC-01/02, NFR-EVAL-01..04.

## Runtime feasibility (FR-GC-08, R6)

**Decision:** Use Agent Platform Code Execution's default Python sandbox (2 vCPU / 1.5 GB RAM), called over authenticated REST by the existing TypeScript API. The owner's superseding 3.2-P1 answer and D18 resolve the CPU/RAM mismatch. Do not select the larger optional profile. Keep one fresh sandbox per attempt, no conversation-level state reuse, and transport only validated scoped bytes.

**Rationale:** This is the originally selected architecture with an explicitly accepted resource-envelope amendment. It avoids introducing a Pyodide host-interoperability hardening layer and preserves the fixed TypeScript orchestration stack. The owner expects one or two simultaneous users; that affects test load, not isolation.

**Evidence:** Google's [quickstart](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/sandbox/code-execution-quickstart), retrieved using ketch.scrape on 2026-10-20, documents the default 2 vCPU / 1.5 GB configuration, parent runtime creation without agent deployment, Python support, execute/file exchange and sandbox deletion. The [overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/sandbox/code-execution-overview) documents no network and the required numerical libraries. Provider memory naming is retained; R6 records effective bytes and runtime/library versions instead of inventing a custom machine configuration.

**Remaining qualification:** These sources do not establish enforced 64 MB scratch, immutable input or actual destruction by 15.0 s. [R6 qualification](r6-feasibility.md) makes them hard admission tests with fail-closed behavior. A client deadline or TTL is not substituted for actual termination. No documented conflicting value for these controls was established; support remains to be demonstrated, not assumed proven.

**Alternatives considered:** Keeping the old caps and qualifying Pyodide was the initial Option A; the owner explicitly superseded it. Built-in Gemini code execution offers less file/control flexibility. Pyodide remains the architecture's fallback only if managed qualification fails and a conforming alternative is established; it is not the implementation path in this plan. Larger provider profiles and native uncontained Python are rejected.

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

**Decision:** Extend apps/api/src/chat/{service,model,draft,verifier,prompt}.ts, existing chat routes, packages/contracts/src/package-v1-3.ts and packages/db/src/chat-history.ts; place new execution types in package-v3-2.ts. Use current Node 24 / TypeScript 5 / pnpm workspace tooling and existing Vitest/Playwright runners.

**Rationale:** Current code has grounded model adapters and buffered transport but no sandbox controller, trace schema or chart route. Main now implements dev orchestration and database migrations. Reuse `ChatService.runTurn`, `RequestScopedContextProvider`, `verifyDraft`, `publishTurn` and generation-epoch cancellation. The active-controller Map tracks aborts; it does not prove exclusive admission or safe replay before publication. Add a durable scoped admission fence for execution; keep client drafts when overlaps are rejected. The actual endpoint is `POST /api/notebooks/{notebook_id}/chat/turns`, and SSE serialization must evolve with TurnEvent. No existing sandbox is implied.

**Alternatives considered:** A separate public execute-code endpoint broadens scope to arbitrary code; a separate agent framework or database violates the fixed stack.

## Main baseline reconciliation (2026-10-21; FR-GC-08, C-02, NFR-EVAL-01..04)

**Decision:** Preserve main's real hybrid-retrieval, PostgreSQL publication and v2 integration instead of planning replacement fixture scaffolding. Extend strict draft/result contracts for clarification and computation; update DB StoredMessage/VisibleMessage, web types and v2 saved-response projection together. Persist trace and cleanup state durably alongside the now-persisted v2 baseline (D16/specs/013; DEV-04 closed). Qualify all runtime controls before sandbox admission; historical provider research above is dated evidence and has not been newly revalidated against a deployed service.

**Rationale:** The retrieved default top 12 chunks are not evidence of a complete source table. Request sufficient original inputs only through C-02 bound to the original snapshot, with its exact citation universe, or refuse incomplete quantitative evidence. This avoids numerically correct calculations on misleadingly partial data. Existing epoch fences and publication transactions remain the authority for late results.

**Alternatives considered:** Reusing v2 test-only memory stores loses execution records after restart; treating the abort Map as a lock admits overlap; broadening a model citation universe beyond supplied C-02 inputs risks leakage; replacing the current chat path loses established authorization/verification behavior. Constitution 2.0.0 requires deterministic PR suites and one fixed stratified 50-case judged release run, rather than judged checks on each prompt/chat PR.

## Second main refresh decision (2026-10-21; FR-GC-08, FR-GC-06, C-02)

**Decision:** Reuse main `dc25c46`'s completed v2 PostgreSQL stores, applied migrations 0005–0008 and app-scoped pool selection. Retain the separate sandbox admission/reconciliation design, all chat projections and the current sources/history readiness gate.

**Rationale:** Source review of `packages/db/src/v2-persistence.ts`, `apps/api/src/{app.ts,v2/runtime.ts}`, `packages/db/src/chat-history.ts` and `apps/web/src/chat/panel.ts` shows production v2 continuations use their app pool, feedback/follow-ups are cleared transactionally, and Send is gated on initial readiness. The configured chat reader itself still captures its pool. Restart sweeps address interrupted Studio reports/Guides only; they do not terminate a remote Python process or prevent duplicate execution. D16 still limits deployment to one API instance.

**Alternatives considered:** Recreating v2 persistence would duplicate completed work; treating its startup sweep or the UI gate as sandbox admission would omit server-side concurrency and unknown-outcome protection. No provider contract changed in this repository delta, so dated R6 research is retained without a new provider claim.
