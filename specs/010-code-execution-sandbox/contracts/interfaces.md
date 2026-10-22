# Contracts: Quantitative Code Execution Sandbox

Scope: FR-GC-08, FR-GC-01/02/06, C-01/C-02, NFR-SEC-02, NFR-EVAL-01..04. All DTOs are defined once in packages/contracts; these are design contracts, not executable implementations.

## Chat entry and progress (FR-GC-08, FR-GC-06, C-02)

Reuse POST /api/notebooks/{notebook_id}/chat/turns, current message, active_source_ids and UUID request_id input and existing session/Owner checks. No public arbitrary-Python endpoint. Missing/empty scope stays 400, invalid text 422, notebook ownership retains the current chat/DB status (404 for missing or malformed notebook IDs; 403 for a foreign notebook), and source failures retain the existing scoped-provider status; no source-list fallback. Preserve the per-user/notebook single-request admission requirement and draft preservation; durable sandbox admission remains to be implemented. Provider unavailable before execution returns a safe unavailable error; never pretend computation happened.

Extend buffered progress with phase running_code, message “Running code…”, execution_id and attempt ordinal. Emit only once execution begins, within ≤2.5 s of the sufficient-intent submission; no status for clarification-only turns. Progress has no numbers, stdout, code or chart contents and is excluded from answer TTFT. Do not fake an early execution status to hide code-generation latency.

Completed response adds optional code_execution_trace and computed_results/chart references after existing citation validation. Each computed value carries Computed, canonical value text/unit and validated source citations. The code drawer renders both attempts in order with final-attempt and published-output markers; stdout, stderr and source are escaped text, never executed as HTML. Numerical responses preserve the sandbox's exact returned representation. No guessed number on failure.

## Sandbox adapter (FR-GC-08, C-02)

Internal-only operations: create(profile, attempt_id), execute(handle, immutable_input_manifest, code, deadline), destroy(handle). Transport uses trusted service identity outside the untrusted code environment. No source credentials or network capability are injected. Runtime uses the managed sandbox limits (D20): ≤2 vCPU, ≤1.5 GB RAM, provider-limited file system, ≤100 MB input/output files per request or response and no network. Inputs are copies. The controller enforces 15.0 seconds per run by deleting the sandbox and discarding late results. Required Python libraries: math, statistics, numpy, pandas, matplotlib, scipy; no runtime pip installation. Record runtime version and byte interpretation as ordinary integration metadata. D19 accepts the managed dependency and makes R6 obsolete.

Each attempt gets a fresh sandbox. Capture stdout/stderr and candidate PNG/SVG files; validate filenames, MIME/decoder, SVG safety and citation provenance before publishing. Provider stateful sessions must not be reused across requests. Destroy after successful extraction or any terminal outcome, including API disconnect/abort; TTL is cleanup defense, not the timeout mechanism. If execute outcome is unknown, do not replay it. Provider retries may only reconcile/read/destroy the same attempt, never submit another execution.

| Terminal code | State / retry | Publication |
| --- | --- | --- |
| PythonException | Failed attempt; exactly one correction allowed only on ordinal 1 | No failed-attempt results |
| ExecutionTimeout | TimedOut; zero retry | Transparent error, no number |
| MemoryLimitExceeded | Failed; zero retry | Transparent error, no number |
| TemporaryStorageLimit / SecurityViolation | Failed; zero retry | Safe explanation, no artifacts |
| ProviderUnavailable / ExecutionOutcomeUnknown | Failed; zero retry | Safe error, reconcile destruction |
| ScopeChanged / AccessRevoked / GenerationCancelled | Failed; zero retry | No stale answer/trace/chart |
| CitationInvalid / InvalidOutput | Failed; zero retry | Refusal, no stripped-citation answer |

Correction input includes original scoped manifest, failed code/error and resolved intent; the model may correct code but cannot expand scope, alter resource limits or choose a second retry. Read and publication authorization is rechecked for each attempt. A Python exception retry never authorizes retrying citation failure.

## Chart download (FR-GC-08, NFR-SEC-02, NFR-EVAL-04)

GET /api/notebooks/{notebook_id}/chat/messages/{message_id}/charts/{artifact_id} returns validated image/png or image/svg+xml bytes, with optional attachment disposition for download. Authenticate current user, authorize notebook/document/message access, require successful final-attempt publication and non-invalidated source provenance on every request. A guessed cross-notebook ID reveals no bytes. Private object generations are served through the application authorization layer; no reusable Cloud Storage signed URL bypass. Set private/no-store and safe content disposition; sanitize SVG to forbid scripts, event handlers, foreignObject, external references and remote fonts, otherwise reject it. Revalidate streamed/range requests and terminate affected delivery on revocation. Merely deselected sources remain viewable in history, but cannot enter new computation context.

## Accepted managed dependency (FR-GC-08, NFR-SEC-01/02, D19)

The project owner accepts Google's Agent Platform (Agent Engine) managed Code Execution sandbox as the selected service dependency. R6 is obsolete: no separate provider feasibility spike, qualification dossier or R6 implementation/deployment admission gate is required. D18's 2 vCPU / 1.5 GB default and the existing scoped-input, network, scratch, timeout, retry, cleanup, authorization, citation and residency requirements remain. Verify the application integration and required behavior through normal spec-derived tests and release gates; this decision records owner acceptance, not newly executed runtime evidence. Switching runtimes requires a new explicit architecture decision. Normal integration tests cover scoped transfer, retry/timeout handling, cleanup, access/citations and output publication. Provisioning, IAM and API approval rules remain applicable; there is no separate R6 admission task.

## Selected managed lifecycle (FR-GC-08, D18)

Provision one parent Agent Platform runtime resource without deployed agent code through approved OpenTofu IaC; the API's trusted service identity alone invokes the provider. No runtime credentials enter Python. For every attempt, create a fresh Python sandbox using the documented default machine profile; verify returned configuration against 2 vCPU / 1.5 GB and reject unexpected profiles. Upload the immutable C-02-derived manifest via file bytes, execute the generated code, retrieve candidate output bytes, and destroy the sandbox in a finally/cleanup path. A successful execute result is not publication permission.

The controller owns a server-side 15.0-second execution deadline and invokes managed cancellation/destruction independently of model code. Preserve the required timeout, scratch and immutable-input behavior in the integration and its normal tests; a client timeout alone must not be reported as confirmed remote termination. Operational metadata stores provider handles and cleanup state server-side so a controller crash can reconcile and delete an orphan without replaying execution. Cleanup retries are idempotent resource deletion, not computation retries. Parent resource persists; child execution sandboxes do not. D19 removes the separate R6 provider-qualification prerequisite.

## Current chat boundary migration (FR-GC-08, FR-GC-01/06, C-02)

`ChatService.runTurn` and `routes/chat.ts` retain status/final/error SSE framing and request replay. Add execution fields to both typed TurnEvent and SSE serializer; current `{phase}` serialization otherwise drops them. `GroundedModel.generate` currently accepts question/chunks/history/preferences and yields a strict draft; extend this boundary and ADK tool wiring with the deterministic controller. Clarification is a separate typed non-computed outcome, retained as a question/answer turn without source-derived factual claims; it must not be rejected merely because `verifyDraft` presently requires at least one claim for an answer. Existing factual claim verification remains fail-closed. A clarification answer uses new current scope, request ID and snapshot, never an old hidden selection.

Execution admission is durable per user/notebook; do not mistake the current AbortController set for a single-request lock. Replays of a finished request return the existing result; unresolved in-flight requests reconcile without duplicate Python execution. Scope-complete input acquisition stays behind the same request-bound C-02 snapshot, with evidence insufficiency explicit. Current projections `StoredMessage`, `VisibleMessage`, web `lib/types.ts` and `v2/runtime.ts`'s chat reader must carry or deliberately omit protected trace fields coherently. Legacy responses without traces remain valid; hidden source-dependent content also hides code/stdout/charts before any consumer receives it. D16/specs/013 closes DEV-04 with persisted v2 data; it does not implement sandbox execution admission, traces or cleanup.

## Readiness and app context (second refresh; FR-GC-08, FR-GC-06, C-02)

Preserve sources/history readiness before enabling chat submission, including a statistical clarification answer. Rejected or premature submissions do not emit Running code; timing starts at the actual sufficient-intent submission. API authorization, explicit scope and durable execution admission remain independently required. Any saved-response/feedback/follow-up integration retains visible-message filtering and the owning application's pool context; no process-default pool or test memory fallback is production authority. Clear chat invalidates sandbox outputs alongside the existing transactional feedback/follow-up deletion and generation epoch fence. V2 startup recovery does not cover remote execution handles; sandbox reconciliation must resolve/destroy unknown attempts without replaying Python.

## No-attempt failure and benchmark reporting (FR-GC-08, FR-GC-06)

Before execution allocation, validation/scope/clarification rejection has no trace. An allocated execution that fails before code is submitted is Failed with no actual attempts, null final_attempt_id and no published artifacts. Unknown execution after submission retains its actual attempt with unknown exit_code and reconciles without replay. Normal timing reports freeze cohort/sample configuration before collection, use nearest-rank P95 over all declared attempts, fail cohorts containing failed/timed-out attempts, and report missing samples as UNAVAILABLE. No R6 prerequisite is introduced.
