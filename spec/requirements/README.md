# FR Cards

The SRS (`../System_Requirements_Specification_Gemeni_Notebook.md`) is the index of all
requirements. The FR cards in this folder add the detail that `/speckit-specify` needs, so
specs are transcribed from observed or memorized behaviour instead of invented. Template and examples:
[`_fr-card-template.md`](_fr-card-template.md).

## What to extract per FR

For each FR collect these details from your knowledge.  Write `Unknown` if you
do not know for sure; never guess.

| # | Extract | Why the spec needs it |
| - | :- | :- |
| 1 | **Trigger and entry point**: where in the UI, which button or gesture, and the preconditions | Given/When of the scenarios |
| 2 | **Actors**: which roles may do it (Owner/Editor, Viewer, Chat-only) | Permissions; RBAC tests |
| 3 | **Main flow**: numbered steps of what happens | User story and acceptance scenarios |
| 4 | **Inputs and limits**: fields, formats, sizes, counts, defaults, with **numbers** | Testable constraints |
| 5 | **Outputs and state**: what the user sees, what is persisted, status transitions | Then-clauses; key entities |
| 6 | **Errors and edge cases**: empty, too large, unsupported, deleted meanwhile, concurrent, offline; exact message text if it matters | Edge-case section |
| 7 | **Timing**: synchronous or asynchronous, rough duration, progress indicator | Success criteria |
| 8 | **Links to other FRs**: which FRs it depends on or triggers | Dependencies; release order |
| 9 | **Deviations**: what we deliberately do differently, and why | Avoids copying the product blindly |
| 10 | **Evidence**: screenshot or recording path, help URL, date observed | Traceability; the product changes |
| 11 | **Open questions**: what you could not determine | Max 3 clarification markers per spec |

Rows 1–6 are the minimum for a card to be usable.

## How to hand them over

- **One file per release package**, named `v<N>/package_<N>_<M>_<short_name>.md`
  (e.g. `v1/package_1_2_text_pdf_ingestion_inspector.md`): the package header
  first (see template), then one FR card per FR in that package.
- **Evidence** goes in `../evidence/<FR-ID>/` and is referenced by relative path.
- **The SRS stays the index**: keep the one-sentence FR there and add a link to its card.
- **Language**: German or English; generated specs are written in English.
- **Open questions**: at most 3 may remain per package; resolve the rest before specifying.
- **Specify**: run `/speckit-specify spec/requirements/v1/<package-file>.md` once per package.
  Each spec requirement cites its SRS ID, e.g. `FR-001 (FR-SI-03)`.
- **Flow-back spec (keep cards and upstream specs synchronized)**: FR cards are living
  sources of truth, not write-once inputs discarded after `/speckit-specify`. Any clarification,
  refinement, or reality gap discovered in a downstream Spec Kit stage must flow back into
  `specs/<feature>/spec.md` AND upstream into the governing tier:
  - **`/speckit-clarify`**: write resolved open questions and ambiguities back into the
    package's FR card (updating EARS, limits, Gherkin scenarios, or edge cases and removing the
    resolved item from `Open questions`) and into the SRS / GitHub issue if scope- or index-level,
    in addition to `specs/<feature>/spec.md`.
  - **`/speckit-plan` & `/speckit-analyze`**: flow refined contracts (`C-01..C-03`), numeric/text
    limits, error states, or technical choices back into `specs/<feature>/spec.md`, the package's
    FR card / `spec/requirements/README.md`, or `docs/solution-architecture.md` (`Dn`) before
    `/speckit-implement` starts.
  - **`/speckit-implement` & `/speckit-converge`**: when implementation or convergence reveals a
    reality gap, unstated edge case, or feasibility constraint, flow the resolution back to
    `specs/<feature>/spec.md` and upstream into the FR card, SRS, or
    `docs/solution-architecture.md` (`Dn`) (and affected GitHub issues), then rerun
    `/speckit-analyze` rather than only patching code or appending unbacked tasks.
- **Cadence**: cards for the current release first; the next release's cards may be written
  while the current one is implemented (Constitution Principle V).

## Binding cross-package rules

These rules apply to every card, including its scenarios and input defaults. They clarify
the cited SRS requirements; they do not introduce new release packages.

- **Authority, evidence, and flow-back:** The constitution, SRS, cards, and recorded architecture
  decisions govern the target behavior in that order, with recorded deferrals applied explicitly.
  Downstream Spec Kit stages (`/speckit-clarify`, `/speckit-plan`, `/speckit-analyze`,
  `/speckit-implement`, `/speckit-converge`) must flow any resolved questions, contract/limit
  refinements, or implementation edge cases back into both `specs/<feature>/spec.md` and the
  applicable upstream tier (FR card, SRS, `docs/solution-architecture.md` `Dn`, and GitHub
  issues) so upstream specs never drift from feature specs or code. Reference links and
  `Reference behaviour` paragraphs are background, not proof of current product behavior. An
  observation without a dated capture is unverified. Symbolic IDs in Gherkin (such as `chk_10`)
  stand for schema-valid fixture IDs when tests are derived. Numeric limits and UI choices in
  these cards are Everlast LM acceptance choices unless evidence says otherwise. Unknown
  reference internals do not block a project choice already stated in a card.
- **Roles and release order (FR-WM-04/05, NFR-SEC-02):** v1–v5 are owner-only. Editor,
  Viewer Full, and Viewer Chat-Only permissions mentioned in earlier cards apply only from
  v6. Owners and Editors may mutate source/note/Studio content; only Owners manage shares or
  delete the notebook. Full Viewers may read/export artifacts and update their own chat,
  learning progress, and personal preferences. Chat-Only users may use their own chat,
  copy/feedback, and personal chat preferences, but have no raw-source, Notes, or Studio API
  access. A valid login never substitutes for notebook and document authorization.
- **Explicit scope (FR-SI-03, C-02, NFR-EVAL-04):** Every generation request carries an
  explicit selection of Ready sources. `All Ready sources` is an initial UI selection, never
  a server fallback for an omitted or empty selection. Selection is local to each user's
  browser session and notebook; it never changes another user's selection. Chat-Only scope
  is resolved server-side to all Ready sources authorized for that user, since no source
  selector is exposed. Empty scope disables source-based generation and is rejected by the
  API; explicitly launched discovery/research can start in an empty notebook (FR-SI-06/07).
- **Snapshots and access (C-02/C-03, FR-SI-05, NFR-SEC-02):** Capture source IDs and content
  revisions at submission. Later checkbox changes affect subsequent requests only. Workers
  recheck access before reading and publishing. Deleted, replaced, or newly unauthorized
  source revisions fail the in-flight generation without publishing stale output; they must
  not silently substitute new content. Summaries, caches, history, sandbox inputs, live
  replies, and generated prompts all obey the same scope and revision checks through C-02.
  Cache keys include notebook, source IDs/revisions, effective authorization, language, and
  relevant generation parameters. Ingestion writes C-01; it is not a bypass for agent reads. A Source Inspector read uses an explicitly authorized singleton read scope through C-02 without changing chat selection; this viewing action does not make the source eligible for a new generation.
- **Historical outputs (FR-GC-03/06, FR-ST-09/13/14, NFR-EVAL-04):** Existing artifacts and
  chat remain viewable when a source is merely deselected, subject to current authorization.
  They are never automatically reintroduced into a new prompt. Drilldown, Explain, topic
  chips, and follow-ups use the current selection, and must not inject text from artifacts
  whose supporting sources/revisions are outside that scope. Show a select-sources prompt
  instead; never silently restore a past selection. On deletion/revocation, hide affected historical generated content or show an unavailable placeholder; do not keep a readable cached copy. Deleted/revoked content must not be
  exposed through cached snippets, generated artifacts, exports, or signed media URLs.
- **Grounding before publication (FR-GC-01/02, C-03, NFR-EVAL-01..04):** Validate citation
  IDs against the scoped C-01 chunks before displaying factual content. On validation failure,
  replace the answer with a refusal, not a stripped-citation draft or a retry answer. Studio
  jobs fail with a refusal explanation and expose no invalid artifact. Status events may
  stream while the answer is buffered for validation; they do not count as answer TTFT.
  Summaries and media transcripts retain claim-level source references. Generated media is
  labelled `AI-generated`; computed results are labelled `Computed` and cite input data.
  Illustrative media is labelled as illustration, never presented as documentary evidence.
- **Jobs and insufficient evidence (C-03, FR-ST-01..18):** Every Studio generator uses the
  same registry and `Queued → Running → Completed | Failed | Cancelled` lifecycle; specific
  rendering stages are progress substates of Running. Retry creates a new attempt with fresh
  authorization and explicit scope. Never publish missing required blocks as Completed.
  Requested counts/lengths are targets constrained by available evidence: produce fewer items
  with an explanation, or a refusal if none are supported, rather than invent padding.
- **Text limits (FR-WM-01, FR-GC-01/07, FR-NM-01):** Unless a field explicitly says bytes, words or grapheme clusters, count Unicode code points after trimming outer whitespace; reject over-limit input rather than truncate it.
- **Quotas and units (FR-WM-07, FR-SI-01, FR-NM-03, FR-SI-06/07):** `200 MB` means
  200,000,000 bytes, inclusive; 500,000 extracted words is a separate inclusive limit for
  every source type. Reserve source slots atomically before ingestion, including batch,
  notes, research and re-sync paths. Uploading/Processing/Ready sources consume a slot;
  Failed uploads release it and retain only a dismissible error row. Re-sync uses the same
  slot and leaves the old revision intact if validation fails. Each source obeys both limits.
- **Quantitative sandbox envelope (FR-GC-08, D18/D19/D20):** Use the owner-approved Google Agent Platform (Agent Engine) managed default of 2 vCPU / 1.5 GB RAM. Zero network and retry rules remain. Since 2026-10-22 (D20) the other limits are what the managed sandbox provides: a provider-limited file system, at most 100 MB of input/output files per request or response, scoped inputs passed as copies (stored sources cannot be modified), and a 15.0 s per-attempt deadline enforced by the application. The owner accepts the managed service: R6 is obsolete and imposes no separate pre-implementation or deployment qualification gate. Normal application integration tests and release gates still apply; no empirical pass is inferred from this decision.
- **Validation cadence (NFR-EVAL-01..04, all release gates):** Deterministic citation-ID and
  leakage checks run on every PR. LLM-judged faithfulness/rejection and semantic citation
  support checks run once per release gate on a fixed stratified 50-case sample of the
  golden dataset; that single passing run is sufficient gate evidence (Constitution v2.0.0). All other
  constitution checks still apply. Passing one package's tests is not passing the full gate.
  Package timing criteria are measured on declared fixtures/environments; standard chat TTFT
  starts at submission and ends at the first validated answer token, excluding progress UI.
  For NFR-PERF-01, the 2.5-second P95 acceptance population contains only requests submitted
  after the service is awake (D17/DEV-05). Requests waiting for wake-up and their wake-up delays
  are measured/reported separately without a release-blocking latency threshold. Declare the
  warm-state classification before testing; do not restart the clock after submission.

## Package prerequisites

Gate v(k) must pass before implementation of v(k+1). Within each release, use these
dependencies when deriving Spec Kit tasks; mutual FR links describe integration, not an
impossible requirement that each side be fully implemented first.

| Release | Within-release ordering / shared prerequisite |
| :- | :- |
| v1 | Define C-01/C-02 once; 1.1 supplies identity, notebooks and quotas; 1.2 supplies ingestion/inspector; 1.3 supplies chat/citations; 1.4 supplies UI integration and full gate tests. Test harness/UI shells may be built before their consumers. |
| v2 | 2.1 language preferences precede language-sensitive generators; 2.2 response actions and 2.3 saved notes share one save-note contract (`POST /api/notebooks/{notebook_id}/chat/messages/{message_id}/note`). 2.4 defines C-03. Source Guide is asynchronous; overview generation can read chunks without waiting for it. |
| v3 | 3.1 extends C-01 adapters without changing the locator union; 3.2 and 3.3 consume existing contracts; 3.4 benchmarks the integrated v3 result. |
| v4 | 4.1 flashcards/quizzes and 4.2 infographics precede the composite FR-ST-12 Learning Overview. Each generator remains an independent C-03 plugin. |
| v5 | 5.1 TTS and v4 slide rendering precede 5.2 narrated video. Join-In also depends on the player in FR-ST-04. |
| v6 | 6.1 identity/document authorization and quota policies precede 6.2 research. Package 6.3 and Gate v6.0 #3 remain deferred by D5; no feature spec is generated for 6.3. |

## Package 3.4 recovery refinements (2026-11-10)

NFR-PERF-01, C-01/C-02/C-03, FR-GC-08, NFR-EVAL-02/04: scope qualification binds the frozen exact sorted source/revision snapshot and original-ledger manifest hash, not only source IDs or recipe labels. Absent frozen ledger/revision evidence is UNAVAILABLE. Ordinary HTTP/SSE collection retains all failures and genuine paired Owner-isolated requests; imports remain diagnostics and cannot qualify release. Original Studio evidence streams in bounded pages/concurrency windows with complete parent-linked coverage; proportional segment token estimates are unqualified, serialized-byte/model-envelope bounds prevent unbounded requests, and enterprise capacity still requires actual qualified tokenizer/model/cache observations. Recursive report composition fails explicitly if evidence cannot be reduced within bounds; the historical report504 is not resolved by extending timeouts.

FR-GC-08 private producer capture observes create invocation before RPC/queue/boot/poll, execute settlement before cleanup/publication, and the actual running-code status emission on one server clock. Atomic owner-private0600 files bind request/owner/notebook/revisions, canonical trace, candidate/serving boot, configured runtime, retained qualification and calibrated clocks. Configuration/profile/hash matches alone do not attest deployed/provider behavior. Startup deliberately leaves model/retrieval/cache probes unqualified; absent actual trusted operational probes/deployment attestation keeps 010 T064 qualification and T052, 012 T060 and 011 T061 open. No paid startup probes or fabricated readiness are introduced. Node26 image checks and local model/tokenizer/cache doubles are implementation diagnostics. Historical viewer P95=16.734000000000037ms FAIL and corrected16.733999999999924ms FAIL remain unchanged.

## Operational private qualification plan (2026-11-10; NFR-PERF-01, FR-GC-08, C-02, NFR-SEC-01/02, CC-09)

The production recorder accepts owner-signed, short-lived private probe authorization only. The operator mounts a trusted Ed25519 public key, authorization and signature outside public assets; no HTTP endpoint/request field enables probes. The recorder writes a private boot challenge. Signed authorization binds that exact boot, immutable candidate/image attestation, serving revision, configured runtime identity plus actual canonical managed lifecycle observation, qualification/calibration/fixture hashes, two exact Owner/notebook/revision actors, expiry, finite timeout and explicit four probe operations. Unsigned/config-only/missing/stale/mismatched input cannot invoke any probe or qualify readiness. Actual model/retrieval/cache/runtime calls then run through trusted server ports, never through client labels. Signature authorizes exact bounded probe operations; it does not attest provider behavior; actual acceptance still requires qualified release campaigns. No probe is executed in this local run.

Default startup remains unqualified. A private unref'ed bounded polling coordinator refreshes only a newly signed authorization; consumed IDs cannot replay paid calls. Expiry or any failure/timeout invalidates eligibility, never reuses an old pass. Each probe operation must be explicitly approved before real invocation: actual C-02 scope read/reverification; serving model generation and citation validation; enterprise cache create/confirmed expiry/delete; read-only verification of prior same-boot canonical managed execution/profile evidence through the established controller and persistent cleanup ledger; never create/delete a second sandbox outside that lifecycle. Failed/unknown operation never qualifies. Each run is bounded by the signed deadline; ports receive abort, and late success cannot qualify. Approval grants a maximum one execution of each operation for that signed ID. Normal workload source/authorization/publication fencing is unchanged.

Resumption safety refinement: signed input authorizes exact bounded operations, not independent actual provider attestation. Runtime qualification must consume authoritative successful same-boot execution, scope, runtime/profile validation and cleanup evidence from the existing managed controller/adapter and persistent ledger. Missing/stale/failed/unknown canonical evidence withholds qualification; no alternate managed create/delete path is permitted. Public-key trust and private polling/refresh composition must be implemented and tested before the disabled scaffold can become operational.

## 2026-11-10c operational adapter refinement (NFR-PERF-01, FR-GC-08, C-02, CC-09)

Current stop policy supersedes historical notes: stop new work at five-hour<=10% OR weekly<=2%. The signature authorizes at most one bounded four-operation run per each of two Owner fixture actors. Private polling uses an independently mounted Ed25519 trust root, never a key from authorization. Source-tree bytes are measured by the running process and compared with the approved signed hash; candidate/revision/config hashes alone are not actual provider proof. Canonical managed profile observations are persisted only after actual provider create/profile validation in the existing controller/cleanup ledger, tied to boot/candidate/runtime hash. Runtime qualification is a read-only adapter requiring a recent succeeded published canonical trace, exact actor/revisions and all sandboxes Destroyed; it never creates a sandbox. Model/retrieval/cache ports execute actual bound operations after approval, reverify C-02 before/after, enforce byte caps and explicit finite cache TTL/deletion. Signature/configuration/client construction cannot replace those effects. Timeout returns boundedly but keeps the real in-flight guard until an abort-ignoring port settles; late success cannot qualify. Caller/provider outputs remain private and release_eligible:false until separate actual acceptance.

### Qualification setup envelopes and fixture compatibility (NFR-PERF-01, FR-GC-08, C-02)

The signed setup deadline is positive and<=240000ms, and signed authorization lifetime<=900000ms; these are owner-approved setup bounds, separate from unchanged2500ms/15000ms timed cohort limits. No actual provider duration is inferred. A timeout invalidates readiness and keeps effects locked until actual settlement/cleanup. Cache qualification accepts<=32000000 original bytes /40000000 serialized bytes and requires actual qualified countTokens+18000reserved tokens<=1048576; no truncation or source sampling. Each actor may explicitly authorize cache_sources separately within the SAME Owner/notebook when its primary quantitative/code fixture is below the provider's actual cache minimum. Cache_sources are signed exact revisions and read only via C-02; absence uses exactly the signed primary sources, never AllReady. Actual provider rejection/minimum/expiry failure remains UNAVAILABLE. Both actors' canonical runtime observations pass before any paid operation. Candidate/code/config binding and fixed query/limits permit at most2embedding requests,2model generations,2cache-token counts,2cache creations and2deletions per signed ID; no sandbox create or execution is invoked by qualification. Approved ordinary runtime warmup is a separate existing010controller workload, never labelled qualified retroactively.

Operational qualification code refinement (2026-11-10c; NFR-PERF-01, FR-GC-08, C-02): private signed authorization explicitly freezes provider_budget; at most2embedding requests,2model generations with512outputtokens/100000requestbytes,2cache counts/creates/deletes and0managed creates. SDK/application retries are bounded to1 for these private probes. Existing ordinary request defaults and timed cohorts remain unchanged. Sameboot canonical warmup/profile/cleanup observation is read-only and independent of qualified collection; signature/configuration alone cannot qualify. See012quickstart for private-channel preconditions, exact scopes, setup bounds and unexecuted live acceptance.

## T068 secure remote channel design (2026-11-11; NFR-PERF-01, FR-GC-08, C-02, NFR-SEC-01/02, CC-09)

The bridge is default-off and uses the existing keyless EU ObjectStorage bucket, never a public URL/HTTPdebug endpoint or generic logs. Its namespace is private-benchmark/v1/<campaignUUID>/<candidate40>/<servingRevision>/<bootUUID>. Each boot exports one immutable strict-schema challenge. Operator approval is an immutable per-ID signed envelope; a CAS inbox pointer binds its exact generation/hash/size and the challenge generation/hash. Those bindings are also inside the owner-signed operational plan. A separately pinned deployment public key is never read from the bucket. Wrongboot/revision/candidate, stale/expired/replayed/concurrent/oversized/malformed input fails closed and records a sanitized outcome; it cannot run provider probes. Signatures authorize bounded operations only, not actual provider attestation.

Only canonical challenge, setup outcomes, transport outcomes, identifier/count-only012records and canonical010private measurements may be exported. Source content/code/stdout/provider handles/credentials and unknown fields are rejected, not stripped into a claimed-valid report. Immutable content-addressed snapshots plus a CAS export index preserve generation binding; all attempts and failures remain. Object reads are generation-pinned and bounded before/during transfer; writes use create/CAS preconditions, single attempts and bounded deadlines. Core workflow uses explicit file/object ports; cloud effects live in storage adapters. Shared schemas live once in contracts; focused shared cloud bridge interfaces are public explicit exports. The cloud wildcard export is actually removed and only its exact obsolete exception is removed (185→184), never widened.

Operator CLI supports private preflight/download, signed approval delivery and bounded follow for existing010/012file collectors. Local output uses owner-private0700directories and atomic0600regular files, rejecting links/public permissions/oversize/identity drift. No source or provider output is printed. Downloading and delivered approval preserve exact hashes/generations; no private key is sent to CloudRun. APIserver wires the actual bridge to the existing private coordinator and canonical evidence files; disabled mode performs0object operations. CloudRun bootstrap creates process-owned/tmp files from separately trusted deployment configuration. Writable files are not assumed to be remotely shared.

CloudRun background work needs CPU allocation. A default-off benchmark-window configuration requires APImin=max1 andcpu_idle=false, preserving D16 singleinstance; the owner must approve exact start/end/rollback to normalmin0/cpu_idle=true. Bridge duration<=1hour, ticks<=3600, object-port operations<=20000 (each write<=2GCSRPCs, allSDKattempts1), writes<=1024, uploadedbytes<=128000000; each object deadline<=5seconds. Operator follow has its own bounded operation/byte/duration limits. Setup/model/cache/runtime budgets and2.5s/15s gate limits remain unchanged. Unknown actual provider/model lifecycle/cache limits remain UNAVAILABLE; this work does not migrate retired models, deploy, create IAM/resources or execute cloud/paid calls. Existing bucket privacy/residency and exact IAM must be verified before an owner-approved live campaign. Retention/cleanup is a planned private-prefix generation cleanup after evidence capture, never notebook purge or source deletion.

Package012Nov11: private remote bridge code/local wiring exists with independent key, generation/CAS/hash bounds, native10MBcache cap and absolute owner window. Retained calibration fields are CLIENT epochs and hash-bound; API/operator map +offset/uncertainty consistently with010. Missing actual clock acquisition is explicit012T073–T074CODE, not a zero-offset assumption or a cloud-only wait. No live qualification/common50judged gate is closed by local bridge tests.

012clock continuation: canonical receipt/exchange interval arithmetic is a local partial implementation only; actual trusted receipt acquisition, replay/expiry lifecycle and calibration installation remain T073/T074. Never treat constructed timestamp inputs as measured provider evidence or infer readiness before real dependency observations.

Package 3.4 clock bootstrap uses independently pinned owner and serving receipt keys over the existing private object bridge. Installing a measured calibration on the same boot is a prerequisite to ordinary scoped operational probes.
