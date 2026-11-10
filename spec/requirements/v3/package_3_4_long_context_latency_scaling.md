# Package 3.4 — Long-Context & Latency Scaling

- **Release:** v3.0
- **Goal:** Scale the `ScopedContextProvider` (`Contract C-02`) and Grounded Reasoning Engine to support an effective context window of $\ge 1 \times 10^6$ tokens across up to $300$ sources while maintaining, for requests submitted after the service is awake (D17/DEV-05), a Time-to-First-Token ($\text{TTFT}$) $\le 2.5\text{ s}$.
- **FRs:** NFR-PERF-01
- **Gate criteria (SRS §5.4):** Gate v3.0 #3 — the effective context scales to $10^6$ tokens (`NFR-PERF-01`) with warm-service $\text{TTFT} \le 2.5\text{ s}$ while `NFR-EVAL-01..04` continue to pass.
- **Out of scope:** Multi-notebook federated indexing (no scheduled release; D5 defers FR-INT-01).

**Cross-package rules:** [Binding scope, roles, lifecycle, quotas and validation](../README.md#binding-cross-package-rules).

---

### NFR-PERF-01 — $10^6$-Token Context Window & Hybrid-RAG Latency Scaling

| Field | Value |
| :- | :- |
| Release / Package | v3.0 / 3.4 |
| Priority (within package) | P1 |
| Actors | System / Grounded Reasoning & Citation Agent, Studio Agents |
| Depends on | C-01, C-02, FR-GC-01, FR-SI-02, NFR-EVAL-01..04 |
| Reference provenance (unverified) | 2026-10-15, Enterprise SRS §4.3 |

**Requirement (EARS)**
- *Ubiquitous:* The `ScopedContextProvider` (`Contract C-02`) and Grounded Reasoning pipeline shall support notebooks containing an aggregate active source volume of at least $1 \times 10^6$ tokens without out-of-memory errors, context truncation failures, or degradation of `NFR-EVAL-01..04` metrics.
- *Ubiquitous:* For chat, regardless of the size of $S_{\text{aktiv}}$, the system shall combine hierarchical source summaries (`FR-SI-02`) with hybrid vector + full-text retrieval and merged ranking, strictly scoped to `active_source_ids` (chat is retrieval-first; architecture decision D1).
- *Event:* When a Studio job runs over $S_{\text{aktiv}}$, the system shall pass the full normalized source text using context caching if it fits within $1 \times 10^6$ tokens, and otherwise process every scoped chunk in bounded batches, using Source Guides for planning but retaining original chunk references throughout map-reduce (D12). Summaries alone must not replace detailed source evidence.
- *Ubiquitous:* For standard chat queries (turns without code execution, `FR-GC-08`) against an active notebook, submitted after the service is awake, the system shall achieve a Time-to-First-Token ($\text{TTFT}$) of $\le 2.5\text{ s}$ (P95).
- *Ubiquitous:* Requests waiting for service wake-up shall be measured and reported separately without a release-blocking latency threshold (D17/DEV-05). For both warm-service and wake-up observations, response timing starts at submission and ends at the first validated answer token; progress events do not count and the clock is not restarted after submission.

**User story:** As an enterprise researcher working with massive document collections (up to millions of tokens across dozens of books, transcripts, and reports), I want fast, sub-2.5-second initial responses and complete recall without hitting context-length crashes.

**Reference behaviour**
1. User loads $50$ large documents totaling $\ge 1,000,000$ tokens into a single notebook and selects all of them.
2. User asks a needle-in-a-haystack question or a broad synthesis question in Chat.
3. For a request submitted after the service is awake, streaming begins within $\le 2.5\text{ s}$ and accurately cites the relevant chunks across the $10^6$-token corpus.

Evidence: `https://support.google.com/notebooklm/answer/16213268`, `SRS §4.3 NFR-PERF-01`

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Aggregate active corpus | `UnifiedDocumentChunk` set | $\ge 1,000,000\text{ tokens}$ must be supported; corpus ceiling is the `FR-WM-07` quota ($\le 300$ sources $\times\ 500,000$ words each), served via retrieval | — |
| Time-to-First-Token ($\text{TTFT}$) | Milliseconds | $\le 2,500\text{ ms}$ (P95 on standard chat queries submitted after the service is awake, i.e. without code execution; D17/DEV-05) | — |

**Outputs & state**
- Visible: First validated answer token within $\le 2.5\text{ s}$ (P95) on the declared warm-service standard-query benchmark; loading indicators do not count.
- Persisted: Pre-computed vector embeddings and a full-text index, filtered strictly by `(notebook_id, source_id)` inside `ScopedContextProvider` (`Contract C-02`).
- States: Chat: `HybridRetrieval` (always). Studio jobs: `CachedFullContext` $\leftrightarrow$ `ChunkMapReduce` (Source Guides assist routing).

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Needle-in-a-haystack query at 1,000,000 tokens meets TTFT and citation accuracy (Gate v3.0 #3)
  Given a notebook populated with 41 Ready sources where Sources 1 to 40 alone total at least 1,050,000 tokens
  And the service is awake before each measured submission
  And chunk "chk_needle_77" in Source 33 contains the unique specification "Reactor coolant pressure must be 142.8 bar"
  And Source 41 contains the decoy "Reactor coolant pressure must be 155.0 bar"
  When the user selects Sources 1 to 40, deselects Source 41, and asks "What must the reactor coolant pressure be?" in 20 runs
  Then the P95 time to the first response token across the 20 runs is <= 2.5 seconds
  And every response states "142.8 bar" with an inline citation [1] pointing to "chk_needle_77"
  And no response or prompt context contains "155.0 bar" (NFR-EVAL-04 Leakage = 0)
```

**Edge & error cases**
- Requests submitted while the service must wake up are classified separately: measure and report their wake-up delays and submission-to-first-validated-answer times without a release-blocking latency threshold. Declare warm-state classification and benchmark conditions before testing; never subtract delay from an already-submitted warm request (D17/DEV-05).
- Broad global question (`"Summarize the main themes across all 40 sources"`) at $> 10^6$ tokens $\rightarrow$ Query router automatically includes all $40$ `Source Guide` summaries (`FR-SI-02`) plus top retrieved detail chunks with original chunk references; detailed questions still retrieve original chunks, never treating summaries as a lossless corpus replacement.

**Measurable criteria**
- Effective context capacity $\ge 1 \times 10^6\text{ tokens}$ (`Gate v3.0 #3`).
- $\text{TTFT} \le 2.5\text{ s}$ (P95) on the warm-service $10^6$-token benchmark (`NFR-PERF-01`).

**Deviations from reference:** D17/DEV-05 (owner decision, 2026-10-19) limits the 2.5-second P95 acceptance target to requests submitted after the service is awake; wake-up delays are separately measured/reported without a release-blocking threshold. Chat uses `Contract C-02` hybrid retrieval + `Source Guide` summaries instead of full long-context prompts; LLM context caching is reserved for asynchronous Studio jobs, so that Gemini on enterprise endpoints achieves $\le 2.5\text{ s}$ TTFT reliably.

**Out of scope:** Cross-notebook vector search.

**Open questions:** `None`

## Implementation-planning refinements (2026-10-21)

`NFR-PERF-01`, `C-02/C-03`, `NFR-EVAL-01..04`: Reuse current PostgreSQL `chunks` vector/FTS/RRF retrieval and canonical `source_pages` (D15), strict history eligibility, request-bound C-02 and buffered verified `final` SSE publication. Existing production retrieval is not a new missing adapter. Calibrate scoped recall/tuning without duplicate schema; preserve exact notebook/source/revision filters. Guide/report storage already persists under D16/specs/013 (DEV-04 closed); 3.1 owns remaining re-sync/Guide dispatch and publication fences, 3.3 new-kind admission/outbox, leases and publication fences. Their remaining plans are not implemented evidence. Current all-original keyset paging collects an array, and 4,000-token/8-chunk report batches with concurrency 4 still need complete model-envelope bounds, oversized-chunk segmentation and bounded recursive compose with original coverage. Private context-cache identity includes effective authorization/revision/model/content and reauthorization. Qualify full-source million-token capacity including model overhead, never truncate.

Use nearest-rank P95 for 20 warm runs (19th sorted latency), client-monotonic submission→first non-replayed validated factual final receipt, prospective serving-instance readiness classification and complete attempted-run reports. Current /healthz liveness and SQL-only /readyz cannot alone prove that classification; unknown readiness invalidates acceptance. Wake measurements retain D17/DEV-05 without threshold; concurrency 2 across two Owner-isolated notebooks remains diagnostic. Constitution 2.0.0 sets deterministic citation/leakage each PR and judged suites once per release candidate using fixed deterministic stratified 50 case IDs/category composition/dataset hash. Preserve the Gate v2 owner override as authority distinct from evidence (the 2026-10-22 live re-run passes #3 while #1 and FR-GC-07 Shorter still fail); do not claim measured green. Runtime remains UNAVAILABLE; see `specs/012-long-context-latency-scaling/plan.md` and benchmark contract.

## Task-analysis refinements (2026-10-22; `NFR-PERF-01`, `C-02/C-03`, `NFR-EVAL-04`)

Context-cache metadata is process-local to the executing adapter instance; it stores no alternate source corpus and requires no database migration. Every provider cache creation sets an explicit finite expiry (record the configured TTL and provider-confirmed expires_at; reject missing, nonpositive or non-finite values). Revalidate exact scope, current authorization and revisions through C-02 before every use and publication. Invalidation immediately removes local eligibility and attempts idempotent provider deletion; cleanup failure never restores eligibility. On restart, do not discover or reattach orphan handles: treat them as misses and rebuild only from reauthorized original chunks. Provider expiry bounds orphan lifetime; it never grants access or replaces immediate application-side invalidation.

JSON observations encode a missing/failed factual answer with client_first_validated_answer_ms=null, latency_ms=null and an explicit terminal failure/refusal/cancelled status. Derive positive infinity only inside aggregation, never serialize Infinity or NaN. A failed aggregate serializes p95_ms=null with result=FAIL and the retained failure observations; any valid warm failure fails acceptance regardless of rank. Unavailable readiness/sample prerequisites serialize result=UNAVAILABLE separately; neither null nor unavailable means zero latency.

## Package 3.4 recovery refinements (2026-11-10)

NFR-PERF-01, C-01/C-02/C-03, FR-GC-08, NFR-EVAL-02/04: scope qualification binds the frozen exact sorted source/revision snapshot and original-ledger manifest hash, not only source IDs or recipe labels. Absent frozen ledger/revision evidence is UNAVAILABLE. Ordinary HTTP/SSE collection retains all failures and genuine paired Owner-isolated requests; imports remain diagnostics and cannot qualify release. Original Studio evidence streams in bounded pages/concurrency windows with complete parent-linked coverage; proportional segment token estimates are unqualified, serialized-byte/model-envelope bounds prevent unbounded requests, and enterprise capacity still requires actual qualified tokenizer/model/cache observations. Recursive report composition fails explicitly if evidence cannot be reduced within bounds; the historical report504 is not resolved by extending timeouts.

FR-GC-08 private producer capture observes create invocation before RPC/queue/boot/poll, execute settlement before cleanup/publication, and the actual running-code status emission on one server clock. Atomic owner-private0600 files bind request/owner/notebook/revisions, canonical trace, candidate/serving boot, configured runtime, retained qualification and calibrated clocks. Configuration/profile/hash matches alone do not attest deployed/provider behavior. Startup deliberately leaves model/retrieval/cache probes unqualified; absent actual trusted operational probes/deployment attestation keeps 010 T064 qualification and T052, 012 T060 and 011 T061 open. No paid startup probes or fabricated readiness are introduced. Node26 image checks and local model/tokenizer/cache doubles are implementation diagnostics. Historical viewer P95=16.734000000000037ms FAIL and corrected16.733999999999924ms FAIL remain unchanged.

## Operational private qualification plan (2026-11-10; NFR-PERF-01, FR-GC-08, C-02, NFR-SEC-01/02, CC-09)

The production recorder accepts owner-signed, short-lived private probe authorization only. The operator mounts a trusted Ed25519 public key, authorization and signature outside public assets; no HTTP endpoint/request field enables probes. The recorder writes a private boot challenge. Signed authorization binds that exact boot, immutable candidate/image attestation, serving revision, configured runtime identity plus actual canonical managed lifecycle observation, qualification/calibration/fixture hashes, two exact Owner/notebook/revision actors, expiry, finite timeout and explicit four probe operations. Unsigned/config-only/missing/stale/mismatched input cannot invoke any probe or qualify readiness. Actual model/retrieval/cache/runtime calls then run through trusted server ports, never through client labels. Signature authorizes exact bounded probe operations; it does not attest provider behavior; actual acceptance still requires qualified release campaigns. No probe is executed in this local run.

Default startup remains unqualified. A private unref'ed bounded polling coordinator refreshes only a newly signed authorization; consumed IDs cannot replay paid calls. Expiry or any failure/timeout invalidates eligibility, never reuses an old pass. Each probe operation must be explicitly approved before real invocation: actual C-02 scope read/reverification; serving model generation and citation validation; enterprise cache create/confirmed expiry/delete; read-only verification of prior same-boot canonical managed execution/profile evidence through the established controller and persistent cleanup ledger; never create/delete a second sandbox outside that lifecycle. Failed/unknown operation never qualifies. Each run is bounded by the signed deadline; ports receive abort, and late success cannot qualify. Approval grants a maximum one execution of each operation for that signed ID. Normal workload source/authorization/publication fencing is unchanged.

Resumption safety refinement: signed input authorizes exact bounded operations, not independent actual provider attestation. Runtime qualification must consume authoritative successful same-boot execution, scope, runtime/profile validation and cleanup evidence from the existing managed controller/adapter and persistent ledger. Missing/stale/failed/unknown canonical evidence withholds qualification; no alternate managed create/delete path is permitted. Public-key trust and private polling/refresh composition must be implemented and tested before the disabled scaffold can become operational.
