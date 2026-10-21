# Contracts: Quantitative Code Execution Sandbox

Scope: FR-GC-08, FR-GC-01/02/06, C-01/C-02, NFR-SEC-02, NFR-EVAL-01..04. All DTOs are defined once in packages/contracts; these are design contracts, not executable implementations.

## Chat entry and progress (FR-GC-08, FR-GC-06, C-02)

Reuse POST /api/notebooks/{notebook_id}/chat/turns, current message, active_source_ids and UUID request_id input and existing session/Owner checks. No public arbitrary-Python endpoint. Missing/empty scope stays 400, invalid text 422, inaccessible notebook/source retain the current authorization/non-disclosure status (notebook ownership lookup returns 404); no source-list fallback. Preserve the per-user/notebook single-request admission requirement and draft preservation; durable sandbox admission remains to be implemented. Provider unavailable before execution returns a safe unavailable error; never pretend computation happened.

Extend buffered progress with phase running_code, message “Running code…”, execution_id and attempt ordinal. Emit only once execution begins, within ≤2.5 s of the sufficient-intent submission; no status for clarification-only turns. Progress has no numbers, stdout, code or chart contents and is excluded from answer TTFT. Do not fake an early execution status to hide code-generation latency.

Completed response adds optional code_execution_trace and computed_results/chart references after existing citation validation. Each computed value carries Computed, canonical value text/unit and validated source citations. The code drawer renders both attempts in order with final-attempt and published-output markers; stdout, stderr and source are escaped text, never executed as HTML. Numerical responses preserve the sandbox's exact returned representation. No guessed number on failure.

## Sandbox adapter (FR-GC-08, C-02)

Internal-only operations: create(profile, attempt_id), execute(handle, immutable_input_manifest, code, deadline), destroy(handle). Transport uses trusted service identity outside the untrusted code environment. No source credentials or network capability are injected. Runtime must enforce ≤2 vCPU, ≤1.5 GB RAM, ≤64 MB temporary /tmp, 15.0 seconds per run, no inbound/outbound packets and read-only input. Required Python libraries: math, statistics, numpy, pandas, matplotlib, scipy; no runtime pip installation. R6 records exact runtime version and byte interpretation without weakening caps.

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

## R6 admission evidence (FR-GC-08, NFR-SEC-01/02)

Before implementation/runtime admission, record provider configuration, runtime/library versions, EU region, no-training terms, exact isolation boundary and test evidence for: attempted network/metadata/DNS/inbound access, filesystem escape/input writes, CPU/memory/disk boundary, infinite loop terminated at 15.0 s, cleanup on all exits, cross-request state, 1-retry exception and no-retry timeout/OOM. Local Docker flags and JavaScript worker separation are not managed deployment evidence. This contract does not approve changing required caps; D18 selects the managed default and preserves all other controls. R6 qualification must pass before implementation/runtime admission, while design planning can complete.

## Selected managed lifecycle (FR-GC-08, D18)

Provision one parent Agent Platform runtime resource without deployed agent code through approved OpenTofu IaC; the API's trusted service identity alone invokes the provider. No runtime credentials enter Python. For every attempt, create a fresh Python sandbox using the documented default machine profile; verify returned configuration against 2 vCPU / 1.5 GB and reject unexpected profiles. Upload the immutable C-02-derived manifest via file bytes, execute the generated code, retrieve candidate output bytes, and destroy the sandbox in a finally/cleanup path. A successful execute result is not publication permission.

The controller owns a server-side 15.0-second execution deadline and initiates cancellation/destruction independently of model code; R6 must demonstrate the provider actually stops execution within the requirement, including any control-plane latency. Merely returning a timeout response is a failed qualification. Scratch and read-only enforcement must likewise be verified at the provider boundary, not asserted from a Python wrapper. Unproven controls disable runtime admission. Operational metadata stores provider handles and cleanup state server-side so a controller crash can reconcile and delete an orphan without replaying execution. Cleanup retries are idempotent resource deletion, not computation retries. Parent resource persists; child execution sandboxes do not.

## Current chat boundary migration (FR-GC-08, FR-GC-01/06, C-02)

`ChatService.runTurn` and `routes/chat.ts` retain status/final/error SSE framing and request replay. Add execution fields to both typed TurnEvent and SSE serializer; current `{phase}` serialization otherwise drops them. `GroundedModel.generate` currently accepts question/chunks/history/preferences and yields a strict draft; extend this boundary and ADK tool wiring with the deterministic controller. Clarification is a separate typed non-computed outcome, retained as a question/answer turn without source-derived factual claims; it must not be rejected merely because `verifyDraft` presently requires at least one claim for an answer. Existing factual claim verification remains fail-closed. A clarification answer uses new current scope, request ID and snapshot, never an old hidden selection.

Execution admission is durable per user/notebook; do not mistake the current AbortController set for a single-request lock. Replays of a finished request return the existing result; unresolved in-flight requests reconcile without duplicate Python execution. Scope-complete input acquisition stays behind the same request-bound C-02 snapshot, with evidence insufficiency explicit. Current projections `StoredMessage`, `VisibleMessage`, web `lib/types.ts` and `v2/runtime.ts`'s chat reader must carry or deliberately omit protected trace fields coherently. Legacy responses without traces remain valid; hidden source-dependent content also hides code/stdout/charts before any consumer receives it. D16/specs/013 closes DEV-04 with persisted v2 data; it does not implement sandbox execution admission, traces or cleanup.

## Readiness and app context (second refresh; FR-GC-08, FR-GC-06, C-02)

Preserve sources/history readiness before enabling chat submission, including a statistical clarification answer. Rejected or premature submissions do not emit Running code; timing starts at the actual sufficient-intent submission. API authorization, explicit scope and durable execution admission remain independently required. Any saved-response/feedback/follow-up integration retains visible-message filtering and the owning application's pool context; no process-default pool or test memory fallback is production authority. Clear chat invalidates sandbox outputs alongside the existing transactional feedback/follow-up deletion and generation epoch fence. V2 startup recovery does not cover remote execution handles; sandbox reconciliation must resolve/destroy unknown attempts without replaying Python.
