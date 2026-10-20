# Validation Log: Package 2.2

SRS trace: `FR-SI-02`, `FR-GC-04/05/07/09`, `FR-NM-02`, `C-02`, `NFR-EVAL-02/04`, Gate v2.0 #1/#2.

## Integration onto the converged v1 code base (2026-10-19, D16 / DEV-04)

> **Correction:** this package was built and tested against the pre-convergence v1 code: in-memory notebooks,
> quota and chat history, an API server that accepted unsigned tokens, and an eval script with hardcoded
> metrics. Earlier entries below that rely on those modules are superseded. By owner decision (D16, SRS §5.5
> DEV-04) the package keeps its own data in process memory until v3; it now runs on the converged v1 code.

- **Access:** every v2 route runs behind the v1 app: Identity Platform/local RS256 tokens, notebook ownership
  checked in PostgreSQL before any v2 handler (`apps/api/src/app.ts`), v2 never decides access itself.
- **Bridge:** `packages/db/src/poc-bridge.ts` mirrors authorized notebooks, Ready-source counts and the visible
  PostgreSQL chat history into the in-memory stores; a deleted notebook drops all v2 records.
- **Runtime:** `apps/api/src/v2/runtime.ts` composes the package; background work runs in the API process
  (single instance for the PoC).
- **Verification (worktree `v1-gate`, PostgreSQL 16 + pgvector):** `pnpm typecheck` clean; `pnpm lint` passed;
  Vitest 74 files / 578 tests passed; Playwright 33/33 (incl. `workspace-comfort.spec.ts` WC-E01..03); `pnpm eval:deterministic` Precision_ID 160/160, leakage 0. Gate v2.0 not run.
- **Package 2.2 specifics:** Source Guides read whole sources through PostgreSQL C-02
  (`listSnapshotChunks`); chat configuration reaches the grounded model as response preferences (never the
  grounding rules). The guide shows in the source inspector only when a source is opened from the list, never
  on citation opens (Gate v1.0 #3 scroll target).
- **Current state (convergence 2026-10-20, see below):** a Vertex AI Flash-Lite `StructuredGenerationClient`
  is wired whenever the Vertex model is configured, so Source Guide, overview and follow-ups no longer answer
  503 in a configured deployment (503 remains only when no model is configured). "Save to notes"
  (`/chat/messages/:id/note`) writes the single Package 2.3 notes store; the separate 2.2 saved-response store
  is retired. `/notes/from-message` still exists and is Package 007's to remove or redirect.

## Release prerequisite: Gate v1.0 (Constitution V)

- `pnpm test:unit` — **PASS** — 46 files, 364 tests (previous recorded prerequisite run).
- `pnpm eval:deterministic` — initially **FAIL** when shell Gemini API-key variables caused the keyless NFR-SEC-01 preflight to reject the test enterprise/europe-west4 configuration.
- `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm eval:deterministic` — **PASS** — 6 test files, 29 tests. This resolves the environment-only blocker; it does not recertify prior Gate v1 upload/citation evidence or the Package 2.1 language-preference prerequisite.

## Gate v1.0 recheck with keyless environment

- `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm eval:deterministic` — **PASS** — 6 test files, 29 tests. The shell API-key variables caused the earlier security-preflight failures; they are not required by the configured keyless test endpoint.
- Gate v1.0 deterministic evaluation/security prerequisite: **PASS**. Gate v1 upload/citation evidence and Package 2.1 feature prerequisite are still recorded as upstream release evidence; this work does not claim those v1 acceptance artifacts anew.

## Package 2.2 implementation verification

- `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm exec vitest run packages/contracts/test/package-v2-2.test.ts packages/db/test/package-v2-2.test.ts apps/worker/test/package-v2-2.test.ts apps/api/test/package-v2-2.test.ts apps/api/test/chat-config.test.ts apps/web/test/source-guide.test.ts apps/web/test/package-v2-2.integration.test.ts` — **PASS** — 7 files, 31 tests.
- `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm typecheck` — **PASS** — TypeScript project references compile.
- `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm lint` — **PASS** — repository lint, spec integrity and TypeScript compilation.
- `node scripts/check-spec-integrity.mjs` — **PASS** — 98 Markdown files, 55 SRS links, 15 Spec Kit feature artifact sets.
- `git diff --check` — **PASS** — no whitespace errors.
- `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm eval:deterministic` — **PASS** — 6 files, 29 tests.

## Convergence implementation verification

- `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm exec vitest run packages/contracts/test/package-v2-2.test.ts packages/db/test/package-v2-2.test.ts apps/worker/test/package-v2-2.test.ts apps/worker/test/package-v2-2-context.test.ts apps/worker/test/package-v2-2-runtime.test.ts apps/api/test/package-v2-2.test.ts apps/web/test/source-guide.test.ts apps/web/test/source-list-loader.test.ts apps/web/test/saved-response-note.test.ts apps/web/test/source-selection.test.ts apps/web/test/package-v2-2.integration.test.ts` — **PASS** — 11 files, 56 tests.
- `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm typecheck` — **PASS** — TypeScript project references compile.
- `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm lint` — **PASS** — repository lint, integrity and TypeScript checks.
- `node scripts/check-spec-integrity.mjs` — **PASS** — 98 Markdown files, 55 SRS links, 15 feature artifact sets.
- `git diff --check` — **PASS** — clean.
- `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm eval:deterministic` — **PASS** — 6 files, 29 tests.
- `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm test:unit` — **PASS** — 57 files, 415 tests.

T057–T059 were first run red (four expected schema/pipeline failures), then passed after implementation. The new local performance tests use injected deterministic readers/generators and verify the documented guide, overview, follow-up, copy/feedback and note-render budgets; they are not cloud P95 evidence. C-02 reader authorization and source revision are rechecked around reads/publication, and cached follow-ups are reauthorized against the submitted assistant snapshot. Runtime/API composition is dependency-injected; absent production source-list, grounded-chat, or model configuration fails closed. The Map-backed repository remains a local/test adapter, not durable production persistence. No production enterprise model endpoint is configured, so regional/no-training compliance and cloud P95 remain deployment evidence. Gate v2.0 #2 remains pending Package 2.3 FR-NM-03 note conversion and subsequent citation evidence.

## Convergence 2 against the revised card (2026-10-20, Phase 11 T060–T083)

Worktree `impl-006`, branch `feat/v2-006-converge` (built on `feat/v2-005-converge`, rebased onto `main` after #128 merged), Node 24.22.0 via pnpm,
PostgreSQL 16 + pgvector at `127.0.0.1:54329` (`TEST_DATABASE_URL`), `GEMINI_API_KEY`/`GOOGLE_API_KEY` unset.

| Check | Result |
| :-- | :-- |
| `pnpm lint` | **PASS** (spec integrity + TypeScript) |
| `pnpm typecheck` | **PASS** |
| `pnpm test:unit` | **PASS**: 20 files, 268 tests |
| `pnpm test:integration` | **PASS**: 58 files, 371 tests |
| Focused Package 2.2 suites (13 files incl. `package-v2-2-gemini`, `package-v2-2-runtime`, `chat-control`, `response-length`) | **PASS**: 13 files, 85 tests |
| `pnpm eval:deterministic` | **PASS** (exit 0): Precision_ID 160/160, leakage 0, adversarial 0/60 published; judged metrics and FR-GC-07 response length UNAVAILABLE |
| `pnpm test:e2e` (Chromium) | **PASS**: 34 passed, 1 skipped (GC-E04 is `test.fixme` on `main`, not changed here) |
| `node scripts/check-spec-integrity.mjs` | **PASS**: 134 Markdown files, 55 SRS IDs, 24 feature artifact sets |
| `git diff --check` | **PASS** |

Each test task was run red before its implementation (CC-02): T062, T063, T064+T069 (together, before the
T074/T080 contract change), T065, T066, T067, T068, T070, T071.

- **FR-SI-02 / Gate v2.0 #1:** guides are keyed by (source, revision, output language) and generated in the
  notebook's effective output language; `?language=` starts on-demand generation (`202 GuidePending`). A
  bounded-interval Ready watcher in the API process (D16) dispatches the guide once per (source, revision)
  without any source listing, with a keyset cursor over `(updated_at, id)` so a burst of more than one batch
  cannot stall it; `ready_at` is stored so latency is measured from `Ready`. The T066 tests live in
  `apps/api/test/package-v2-2-runtime.test.ts` (they need the composed API and PostgreSQL).
- **FR-GC-05:** each chip carries its own support IDs; out-of-scope chips are dropped; one row above the input
  bar, cleared on stream start and scope/language change; late chips of an earlier scope are discarded.
- **FR-GC-09 / FR-NM-02:** shared save-note route on the 2.3 notes store; question-derived title; `400` for
  mismatched body IDs; feedback can be cleared (`DELETE …/feedback`).
- **Security (review fixes):** upstream model error text is logged server-side only; `StructuredGenerationError`
  has a fixed message and reason enum; `GuideFailed` and the overview/follow-up error bodies are fixed text.
- **UNAVAILABLE (not claimed):** live Vertex AI calls (the client is tested with a fake transport only); Gate
  v2.0 #1 cloud P95 < 10 s from `Ready`; the FR-GC-07 response-length release metric and the judged suite
  (`pnpm eval:judged`), until a deployed run against Vertex AI in `europe-west4` exists.
- **Pending:** Gate v2.0 #2 (save → convert → cite) until Package 2.3 conversion is proven end to end.

## Live Gate v2.0 fixes, 2026-10-20

Branch `fix/v2-006-live-gate` (base `main` 5a8dbe0, which includes the Gate v2.0 #1 harness from #133). Tasks `[006-source-guide-chat-control] T084–T088`.

**Before (first live Gate v2.0 run, 2026-10-20):**
- Gate v2.0 #1 (`FR-SI-02`, FR-018): timing passed (P95 2.8 s from `Ready`), but 6/20 guides were rejected, so the gate failed:
  - `key_topics` "at least 5 topics" (Travel_Policy.md en/de, Infrastructure_Inventory.pdf de).
  - `summary_md` over 250 words (Vendor_Contracts.md en).
  - "exactly one sentence" for a source under 50 words (Office_Handbook.pdf en/de).
- FR-GC-07 (FR-012): Shorter, Default and Longer gave identical token counts (e.g. 15/15/15, 25/25/25). Six eligible synthesis cases had a Default refusal (0 tokens), so the metric failed closed.

**Root causes and fixes:**
- The contract required at least 5 topics, but the card treats 5–10 as a target ("no unsupported padding"). The hard rules are now 1–10 topics (≤ 3 under 50 words), each ≤ 40 code points (`FR-SI-02`).
- `Intl.Segmenter` counted Markdown line breaks and German abbreviations as sentence boundaries ("**Title**\n…" = 2; "z. B." = 3; "u. a. … (Fr. 15:30 Uhr)" = 3). It is replaced by the deterministic, linear `countSentences`. Real second sentences are still rejected.
- The guide instruction now states the source's word count, "never more than 250 words" and, under 50 words, the one-sentence rule, with no line breaks or lists. The response schema also has `minItems: 1` / `maxItems: 10` and a 250-word description. Invalid structured output is still not retried, and 250 words is still a hard limit (rejected, never truncated).
- The length preferences were soft "prefer …" hints. They now set concrete targets:
  - Shorter: at most 2 cited sentences with only the asked fact(s).
  - Longer: at least 4 cited claim sentences covering every relevant supported fact; this replaces "Be concise" in rule 8 only.
  - Both lines repeat that no fact may come from outside the SOURCE CHUNKS, and Longer refuses exactly as the rules require (`FR-GC-01/02`).
- FR-GC-07 eligibility: a Default refusal is not "a case whose sources support a longer answer". Such a case is excluded and listed in `excluded_case_ids` (Shorter/Longer are not run for it). If no eligible case remains, the metric fails closed. A Shorter or Longer refusal where Default answered also fails closed.

**Flow-back:** Package 2.2 card (key-topic and summary hard limits; measurable criterion for FR-GC-07), `spec.md` FR-002/FR-012, `plan.md` (limits, evals row), `data-model.md` (guide validation).

**Offline verification (CC-02: T084/T086 first ran red with 4 + 3 expected failures, then passed):**
- `pnpm lint` passed. `pnpm typecheck` passed.
- `pnpm test:unit`: 20 files / 278 tests passed.
- `pnpm test:integration` (`TEST_DATABASE_URL` set): 67 files / 466 tests passed.
- `pnpm test:e2e`: 37 passed, 1 skipped.
- `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm eval:deterministic`: exit 0. citation_precision 160/160, leakage 0, Gate v2.0 #3 deterministic PASS, FR-GC-07 `unavailable` (judged only).
- `node scripts/check-spec-integrity.mjs` passed.

**Live verification:** `UNAVAILABLE`. The targeted live check (`runSourceGuideReleaseGate`, project `lukas-gcloud-playground`, `europe-west4`) failed before any model call: every request returned `400 invalid_grant` from Application Default Credentials, because the ADC refresh token had expired. No billable calls were made. Gate v2.0 #1 and the FR-GC-07 numbers stay open (T088) until the owner re-runs `gcloud auth application-default login` and then `pnpm eval:judged` once.
