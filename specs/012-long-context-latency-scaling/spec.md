# Feature Specification: Long-Context and Latency Scaling

**Feature Branch**: `codex/v3-tasks-3-4-20261022`
**Created**: 2026-10-19
**Status**: Draft
**Package Source**: `spec/requirements/v3/package_3_4_long_context_latency_scaling.md`
**SRS IDs in Scope**: `NFR-PERF-01`; supporting `C-01`, `C-02`, `C-03`, `FR-GC-01/02/06/08`, `FR-SI-01/02/03/05`, `FR-WM-04/07`, `NFR-SEC-01/02`, `NFR-EVAL-01..04`
**Release & Gate**: `v3.0` (`Gate v3.0`, context-capacity component of criterion #3)
**Input**: User description: "Specify release v3.0 package 3.4 — Long-Context & Latency Scaling."

## Source Traceability & Package Scope *(mandatory)*

| SRS ID | Requirement Title | FR Card Anchor | Architecture Decisions / Deviations |
| :--- | :--- | :--- | :--- |
| NFR-PERF-01 | Million-token context window and retrieval latency | [Package 3.4](../../spec/requirements/v3/package_3_4_long_context_latency_scaling.md#nfr-perf-01--106-token-context-window--hybrid-rag-latency-scaling) | D1 retrieval-first chat; D12 complete original-chunk Studio coverage; D13 validated-answer TTFT; D17/DEV-05 warm-service acceptance |
| C-01, C-02, C-03; NFR-EVAL-01..04 | Shared evidence, scope, publication and evaluation constraints | [Binding rules](../../spec/requirements/README.md#binding-cross-package-rules) | D12, D13; no new contracts |

- **Within-Release Prerequisites (`spec/requirements/README.md`)**: Package 3.4 benchmarks the integrated v3 result after 3.1 ingestion adapters, 3.2 code execution and 3.3 Studio mindmaps/tables. Existing C-01/C-02/C-03, grounded chat, and FR-SI-02 Source Guides are dependencies. This package does not re-specify their features.
- **Role Phasing (`FR-WM-04/05`, `NFR-SEC-02`)**: Owner-only in v3; system agents act within the Owner's authorized notebook and document scope. Sharing roles start in v6.
- **Data Residency (`D3`, `NFR-SEC-01`)**: `europe-west4` default; no exception introduced. Enterprise no-training obligations remain binding, without an unverified zero-retention claim.
- **Upstream Flow-Back Status (`CC-01`)**: The 2026-10-19 owner clarification limits the 2.5-second P95 acceptance population to requests submitted after the service is awake. Wake-up delays are measured and reported separately without a release-blocking threshold. This accepted narrowing is synchronized with the package card, SRS (DEV-05), binding timing rules and architecture D17.

## Clarifications

### Session 2026-10-19

- Q: Should the 2.5-second chat response target include requests that must wait for the service to wake up after inactivity? → A: B — Apply the 2.5-second P95 acceptance target only after the service is awake; measure and report wake-up delays separately without a release-blocking threshold.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find a precise fact in a large collection (Priority: P1)

**SRS IDs**: `NFR-PERF-01`, `FR-GC-01/02`, `NFR-EVAL-01..04`, `C-01`, `C-02`
**Actors**: Notebook Owner; grounded reasoning and citation system

An Owner selects a large collection and asks a specific question, receiving a fast answer with an accurate, inspectable citation while unselected material stays excluded.

**Why this priority**: Large source volume must not make grounded research slow, unsafe, or unable to find detailed evidence.

**Independent Test**: Run the card's 20-query fixture on a declared benchmark environment; measure submission to first validated answer token and inspect answers, citations and prompt contexts. Symbolic chunk names below must map to schema-valid fixture IDs.

**Acceptance Scenarios**:

1. **Given** 41 Ready sources where Sources 1–40 alone total at least 1,050,000 tokens, Source 33 chunk `chk_needle_77` says "Reactor coolant pressure must be 142.8 bar", and Source 41 says "Reactor coolant pressure must be 155.0 bar", **When** the Owner selects Sources 1–40, deselects Source 41, and asks "What must the reactor coolant pressure be?" in 20 runs submitted after the service is awake, **Then** P95 TTFT is at most 2.5 seconds, every answer states "142.8 bar" with inline citation `[1]` to `chk_needle_77`, and no answer or prompt context contains "155.0 bar". Decoy tokens do not count toward active volume. (`NFR-PERF-01`, `NFR-EVAL-02/04`, `Gate v3.0 #3`)
2. **Given** a large explicitly selected corpus, **When** a question has no supporting evidence in that scope, **Then** the system refuses on missing-source grounds and retains the established rejection and faithfulness thresholds. (`NFR-EVAL-01/03`, `FR-GC-01`)
3. **Given** a factual answer with an invalid citation, **When** publication validation runs, **Then** the system immediately returns a refusal without exposing the draft, removing citations to publish it, or silently retrying; progress indicators never count as answer TTFT. (`FR-GC-02`, `NFR-EVAL-02`, D13)

### User Story 2 - Synthesize themes without losing detailed evidence (Priority: P1)

**SRS IDs**: `NFR-PERF-01`, `FR-SI-02`, `FR-GC-01/02`, `C-02`, `NFR-EVAL-04`
**Actors**: Notebook Owner; grounded reasoning system

The Owner asks for themes across a large collection and receives a grounded synthesis that considers its selected sources while retaining access to original detailed evidence.

**Why this priority**: Broad questions and precise questions must both remain useful beyond a million active tokens.

**Independent Test**: Use more than one million tokens across 40 selected sources, then inspect the evidence supplied for a broad question and a detailed follow-up.

**Acceptance Scenarios**:

1. **Given** more than one million active tokens across 40 sources, **When** the Owner asks "Summarize the main themes across all 40 sources", **Then** all 40 Source Guide summaries and the top retrieved detail chunks participate in the context, retaining original chunk references. (`NFR-PERF-01`, `FR-SI-02`, `C-02`)
2. **Given** the same corpus, **When** the Owner asks a detailed follow-up, **Then** original chunks supply the evidence; summaries never stand in for a lossless copy of the corpus. (`NFR-PERF-01`, `FR-GC-01/02`)

### User Story 3 - Generate Studio artifacts from complete scoped evidence (Priority: P1)

**SRS IDs**: `NFR-PERF-01`, `C-01`, `C-02`, `C-03`, `NFR-EVAL-01..04`
**Actors**: Notebook Owner; Studio agents

The Owner generates an existing Studio artifact from large selected collections without losing evidence merely because the collection exceeds a single context window.

**Why this priority**: Complete source processing is necessary to preserve detailed facts in integrated v3 Studio outputs.

**Independent Test**: Compare an at-capacity collection and an above-capacity collection; verify original chunk coverage, retained references, scope and publication outcomes independently of chat timing.

**Acceptance Scenarios**:

1. **Given** selected normalized source text fitting within 1,000,000 tokens, **When** a Studio job starts, **Then** its full source text is available for processing with retained original chunk references. (`NFR-PERF-01`, `C-01`, `C-02`, D12)
2. **Given** selected content exceeding 1,000,000 tokens, **When** a Studio job runs, **Then** every original scoped chunk is processed in bounded batches, Source Guides assist planning only, and combined results retain original chunk references. (`NFR-PERF-01`, `C-03`, D12)
3. **Given** an in-flight Studio or chat request, **When** any captured source revision is deleted, replaced or newly unauthorized, **Then** it fails without publishing stale content or substituting a newer revision. (`C-02`, `C-03`, `FR-SI-05`, `NFR-SEC-02`)

### Edge Cases *(mandatory)*

- **Empty or omitted selection (`FR-SI-03`, `C-02`)**: Disable source-based generation and reject the request; never silently select all Ready sources.
- **Selection changes (`C-02`, `FR-SI-05`)**: Checkbox changes affect later submissions, not the current request's captured source revisions. Deletion, replacement or lost access fails the current request before publication.
- **History and caches (`FR-GC-06`, `NFR-EVAL-04`)**: Deselected content may remain viewable with authorization, but cannot re-enter a new prompt through prior questions, answers, summaries or caches. Deleted/revoked content is hidden or replaced by unavailable placeholders, including derived artifacts, snippets and exports.
- **Unauthorized or cross-notebook access (`FR-WM-04`, `NFR-SEC-02`)**: Reject access regardless of valid login; indexing, retrieval and cached context cannot bypass authorization.
- **Capacity boundaries (`NFR-PERF-01`, `FR-WM-07`, `FR-SI-01`)**: One million tokens is a required effective capacity and Studio processing boundary, not a notebook aggregate cap. Preserve configured quotas up to 300 sources, each subject to 500,000 extracted words and 200,000,000 bytes inclusive. Reject over-limit inputs without truncating. Existing atomic slot reservation applies; failed uploads release slots, and failed re-sync retains the old Ready revision and slot.
- **Timing exceptions (`NFR-PERF-01`, `FR-GC-08`)**: Requests waiting for service wake-up are measured and reported separately without a release-blocking threshold (D17/DEV-05). Code-execution turns and asynchronous Studio jobs are outside the standard-chat 2.5-second TTFT population; excluding them does not exempt them from scope, grounding or their own package constraints.
- **Insufficient evidence (`C-03`, `NFR-EVAL-03`)**: Produce fewer supported artifact items with an explanation or fail with refusal if none are supported; never invent padding or publish incomplete required blocks as Completed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (`NFR-PERF-01`, `FR-WM-07`)**: *(Ubiquitous)* Support at least 1,000,000 active source tokens without out-of-memory errors, context truncation failures or degradation of NFR-EVAL-01..04, within the existing notebook quota ceiling of up to 300 sources of at most 500,000 words each.
- **FR-002 (`NFR-PERF-01`, `FR-SI-02`, `C-02`)**: *(Ubiquitous)* Chat MUST remain retrieval-first regardless of selected corpus size, combining hierarchical source summaries with hybrid semantic and full-text retrieval and merged ranking, strictly within explicit active source IDs (D1). Persisted retrieval indexes MUST remain filtered to the notebook and selected sources; their implementation belongs in the plan.
- **FR-003 (`NFR-PERF-01`, `FR-SI-02`, `FR-GC-02`)**: *(Event-driven)* A broad question over the card's 40-source, above-million-token corpus MUST include all 40 Source Guides plus top retrieved detail chunks with original references. Detailed queries MUST retrieve original chunks; summaries MUST NOT replace complete evidence.
- **FR-004 (`NFR-PERF-01`, `C-01`, `C-02`, `C-03`)**: *(Event-driven)* Studio MUST use full normalized source text with context caching when it fits within 1,000,000 tokens, and otherwise process every original scoped chunk in bounded batches with retained chunk-level evidence. Source Guides assist planning, never replace details (D12). The card's `CachedFullContext` and `ChunkMapReduce` modes are internal processing modes, not separate job lifecycle states.
- **FR-005 (`NFR-PERF-01`, `FR-GC-02/08`)**: *(Ubiquitous)* Standard chat without code execution MUST achieve P95 TTFT ≤2,500 ms on the declared warm-service benchmark (requests submitted after the service is awake), measured from submission to the first validated answer token, excluding status/progress UI (D13). Requests waiting for service wake-up MUST be measured and reported separately without a release-blocking latency threshold (D17/DEV-05); the warm measurement MUST NOT restart the clock after submission.
- **FR-006 (`C-02`, `C-03`, `FR-SI-03/05`, `NFR-SEC-02`)**: *(State-driven)* All source reads MUST use C-02 and explicit Ready source IDs with submission-time source/revision snapshots. Authorization MUST be rechecked before reads and publication. Empty scope MUST be rejected; changed selection only affects later requests; deleted, replaced or unauthorized revisions MUST fail the request without stale publication or replacement.
- **FR-007 (`NFR-EVAL-04`, `C-02`, `FR-GC-06`)**: *(Ubiquitous)* Summaries, retrieval results, cached context, prompts and eligible history MUST obey the same scope. Cache identity MUST include notebook, exact source/revision set, effective authorization, language and generation parameters. Deselected or unauthorized evidence MUST NOT leak through derived content.
- **FR-008 (`FR-GC-02`, `NFR-EVAL-01..04`, `C-03`)**: *(Unwanted)* Invalid citation validation MUST result in immediate refusal, or a failed Studio job with refusal explanation, before factual publication. Valid citations MUST identify scoped original chunks and semantically support claims. No citation-stripped draft or silent retry is allowed.
- **FR-009 (`C-03`, `NFR-PERF-01`)**: *(State-driven)* Studio retains `Queued → Running → Completed | Failed | Cancelled`; processing modes are substates of Running. Retry MUST create a fresh attempt with authorization and explicit scope; missing required blocks MUST NOT be marked Completed.
- **FR-010 (`NFR-EVAL-01..04`, `NFR-PERF-01`)**: *(Ubiquitous)* Scaling MUST preserve hallucination rate <5%, citation-ID precision 1.0 with semantic support, out-of-source rejection ≥99%, and leakage 0. Deterministic citation/leakage checks run on every PR; judged faithfulness, rejection and semantic support run once per release gate on a fixed deterministic stratified 50-case sample from the versioned golden dataset, recording case IDs, category composition and dataset hash (Constitution 2.0.0).

### Key Entities

- **Scoped corpus snapshot (`C-01`, `C-02`, `NFR-PERF-01`)**: Authorized notebook, explicitly selected Ready source IDs and revisions, original chunks and token counts; excludes deselected decoys from active volume.
- **Source Guide and detailed evidence (`FR-SI-02`, `FR-GC-02`)**: Summary for orientation plus original cited chunks; the former never replaces the latter's detailed evidence.
- **Benchmark observation (`NFR-PERF-01`, `NFR-EVAL-01..04`)**: Declared fixture/environment, active token count, query classification, warm-service or wake-up classification, submission and first validated answer times, answer/citation checks and leakage/quality outcomes.
- **Studio attempt (`C-03`)**: One immutable submission scope, lifecycle state and evidence references spanning all processed chunks; retries establish fresh attempts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (`NFR-PERF-01`, `Gate v3.0 #3`)**: At least 1,000,000 active tokens are usable without memory/context-truncation failures; the needle fixture's selected Sources 1–40 alone contain at least 1,050,000 tokens.
- **SC-002 (`NFR-PERF-01`, `NFR-EVAL-02/04`)**: Across the specified 20 standard-chat runs submitted after the service is awake, P95 submission-to-first-validated-answer latency is ≤2.5 seconds, all 20 answers give 142.8 bar citing `chk_needle_77`, and no answer or prompt includes the 155.0 bar decoy. Separately recorded wake-up delays carry no release-blocking latency threshold (D17/DEV-05).
- **SC-003 (`NFR-EVAL-01..04`)**: At the scaled corpus size, hallucination remains <5%, citation-ID precision equals 1.0 with semantic claim support, unsupported-question refusal is ≥99%, and deselected-source leakage equals 0.
- **SC-004 (`NFR-PERF-01`, `FR-SI-02`, `C-03`)**: The broad-question fixture includes all 40 selected Source Guides and original detail references; above-capacity Studio processing covers every original scoped chunk without summary-only substitution.
- **SC-005 (`C-02`, `C-03`, `FR-SI-05`, `NFR-SEC-02`)**: Derived acceptance tests reject empty/unauthorized scopes and publish no stale result for deletion, revision replacement or access revocation, regardless of corpus size.

## Assumptions & Out of Scope

- **In-Scope Release Constraints (`NFR-PERF-01`, `Gate v3.0`)**: This specifies package 3.4 only. Existing ingestion, sandbox and Studio capabilities are benchmark dependencies, not new features. Specification may precede runtime gates; implementation follows the documented Gate v2.0 owner override; the earlier live failures and absent post-fix live re-run remain disclosed in `docs/gate-v2-live-evaluation.md` and are not measured green evidence. This package alone cannot satisfy full Gate v3.0.
- **Benchmark interpretation (`NFR-PERF-01`)**: Acceptance covers requests submitted after the service is awake; requests waiting for wake-up are measured/reported separately without a release-blocking threshold (D17/DEV-05). Both classifications retain submission-to-first-validated-answer measurement. Fixtures, warm-state classification, wake-up observations and environments must be declared during planning; the card defines 20 runs and P95 but does not prescribe a percentile estimator or concurrency target. No wake-up threshold or runtime result is asserted here.
- **Binding architecture (`C-01..C-03`, D1, D12, D13)**: Retrieval-first chat and complete-evidence Studio modes above restate existing decisions, not new implementation choices. No language, framework, datastore or deployment design is introduced.
- **Evidence (`CC-01`)**: Reference-product behavior in the card is explicitly unverified provenance, not evidence of tested performance. These are Everlast LM acceptance requirements.
- **Out of Scope / Deferred (`FR-INT-01`, D5/DEV-03)**: Cross-notebook search, federated indexing and multi-notebook synthesis. Sharing roles are v6 scope. Implementation, deployment and runtime gate execution remain outside this task-generation and analysis stage.

## Planning Refinements (2026-10-21; `NFR-PERF-01`, `C-02/C-03`)

The benchmark uses 20 warm submissions with nearest-rank P95 (19th sorted latency), preserves submission-to-first-validated-answer receipt, classifies readiness before submission and reports every attempt. Wake-up delays have no blocking threshold under D17/DEV-05. A separate two-Owner/two-notebook concurrency diagnostic does not redefine acceptance. Existing scoped retrieval and strict history eligibility remain the starting point; complete original-evidence processing and qualified context capacity must be demonstrated on the integrated system. Persisted source, Guide and report state is now the baseline (D15/D16/specs/013; DEV-04 closed). Durable storage does not alone establish unattended dispatch, safe publication or performance after restart; integrated qualification must distinguish retained records, explicit interrupted-report retry and missing-Guide regeneration from remaining v3 recovery work. Runtime qualification remains UNAVAILABLE. These refinements flow into the package card and architecture; technical design and current-code evidence are in plan/research.

## Task-analysis refinements (2026-10-22; `NFR-PERF-01`, `C-02/C-03`, `NFR-SEC-02`, `NFR-EVAL-04`)

Context-cache metadata is process-local to the executing adapter instance; it stores no alternate source corpus and requires no database migration. Every provider cache creation sets an explicit finite expiry (record the configured TTL and provider-confirmed expires_at; reject missing, nonpositive or non-finite values). Revalidate exact scope, current authorization and revisions through C-02 before every use and publication. Invalidation immediately removes local eligibility and attempts idempotent provider deletion; cleanup failure never restores eligibility. On restart, do not discover or reattach orphan handles: treat them as misses and rebuild only from reauthorized original chunks. Provider expiry bounds orphan lifetime; it never grants access or replaces immediate application-side invalidation.

JSON observations encode a missing/failed factual answer with client_first_validated_answer_ms=null, latency_ms=null and an explicit terminal failure/refusal/cancelled status. Derive positive infinity only inside aggregation, never serialize Infinity or NaN. A failed aggregate serializes p95_ms=null with result=FAIL and the retained failure observations; any valid warm failure fails acceptance regardless of rank. Unavailable readiness/sample prerequisites serialize result=UNAVAILABLE separately; neither null nor unavailable means zero latency.
