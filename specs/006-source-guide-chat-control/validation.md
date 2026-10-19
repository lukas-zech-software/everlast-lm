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
  Vitest 74 files / 576 tests passed; Playwright 33/33 (incl. `workspace-comfort.spec.ts` WC-E01..03); `pnpm eval:deterministic` Precision_ID 160/160, leakage 0. Gate v2.0 not run.
- **Package 2.2 specifics:** Source Guides read whole sources through PostgreSQL C-02
  (`listSnapshotChunks`); chat configuration reaches the grounded model as response preferences (never the
  grounding rules). **No Gemini client exists for `StructuredGenerationClient`**, so Source Guide, overview and
  follow-up generation answer 503 until one is added; the UI hides them. The guide shows in the source
  inspector only when a source is opened from the list, never on citation opens (Gate v1.0 #3 scroll target).
- **Known duplication:** "Save to notes" here (`/chat/messages/:id/note`) and the Package 2.3 pinboard
  (`/notes/from-message`) keep separate saved-response stores; unify in v3.

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
