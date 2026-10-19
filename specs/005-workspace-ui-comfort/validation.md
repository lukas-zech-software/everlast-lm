# Validation Record: Workspace & UI Comfort

SRS scope: `FR-WM-02`, `FR-WM-03`, `FR-UI-02`, `FR-GC-03`. Exact pnpm commands unset Gemini key variables because those shell values can falsely trigger the keyless deterministic-eval preflight; clean invocation passed 29/29.

## Foundational TDD Red (CC-02)

**Command**: `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm exec vitest run packages/contracts/test/package-v2-1.test.ts packages/db/test/workspace-preferences.test.ts`

**Expected requirement-related Red**: 2 files failed; 15 failed, 6 passed out of 21 tests. Assertion failures demonstrated missing emoji/enumeration/language contracts, owner-scoped pin/open state, stable pinned-first ordering, Ready-only count, custom-icon stickiness, and timestamp updates. No setup, import, or missing-dependency failures occurred.

**Existing baseline**: `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm exec vitest run packages/contracts/test/workspace.test.ts packages/db/test/workspace.integration.test.ts` — PASS, 2 files / 36 tests.

## User Story 1 and User Story 2 TDD Red (CC-02)

**Command**: `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm exec vitest run --reporter=dot packages/contracts/test/package-v2-1.test.ts packages/db/test/workspace-preferences.test.ts apps/api/test/workspace-preferences.test.ts apps/api/test/chat-language.test.ts apps/web/test/workspace-preferences.test.ts apps/worker/test/topic-emoji.test.ts`

**Expected requirement-related Red**: 6 files failed; 34 failed, 8 passed out of 42 tests. Assertions covered contracts/repository (T003/T004), API (T006/T007/T019), 500-record and UI/settings cases (T008/T020), first-Ready selector behavior (T009), locale precedence (T018), and chat/citation fidelity (T021). The browser suite uses a synthetic 500-notebook fixture and `performance.now()`; Chromium acceptance was added after convergence identified it as a missing proof.

## Convergence TDD Red

**Command**: `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm exec vitest run apps/web/test/workspace-preferences.test.ts`

**Expected Red**: 3 requirement assertions failed (8 passed): global language settings were not hydrated; the active workspace did not render saved notebook title/icon; and System theme did not react to a `prefers-color-scheme` change. The failures were behavior assertions, not test setup failures.

**Chromium Red**: `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm test:e2e --grep "Workspace comfort Chromium acceptance"` (after `pnpm build`) exposed an invalid duplicate overview selector and measured view switching at 113.20 ms for 500 records, exceeding SC-002. The feature renderer was optimized before rerunning.

## Green Results

- Focused Package 2.1 suites: `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm exec vitest run packages/contracts/test/package-v2-1.test.ts packages/db/test/workspace-preferences.test.ts apps/worker/test/topic-emoji.test.ts apps/api/test/workspace-preferences.test.ts apps/api/test/chat-language.test.ts apps/web/test/workspace-preferences.test.ts` — PASS, 6 files / 47 tests.
- Chromium acceptance: `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm test:e2e --grep "Workspace comfort Chromium acceptance"` — PASS, 3 tests. Latest Chromium observations: metadata visible 46.60 ms (SC-001 ≤200 ms); view change 67.00 ms and sort 83.50 ms on 500 records (SC-002 ≤100 ms); theme change 4.90 ms across four panels (SC-003 ≤50 ms). Saved icon/header journey passed.
- Full typecheck: `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm typecheck` — PASS.
- Build for browser harness: `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm build` — PASS.
- Lint: `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm lint` — PASS; included integrity, TypeScript compilation, and style checks.
- Spec integrity: `node scripts/check-spec-integrity.mjs` — PASS, 97 Markdown files, 55 SRS links, and 15 feature artifacts.
- Patch formatting: `git diff --check` — PASS.
- Full unit suite: `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm test:unit` — PASS, 52 files / 411 tests.
- Deterministic evaluation: `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm eval:deterministic` — PASS, 6 files / 29 tests.

## Integration Limits and Release Claims

The live enterprise Vertex AI topic-icon smoke test is `UNAVAILABLE` because no approved project credentials were supplied; selector behavior is verified through injected deterministic tests. The in-memory repository remains process-local and is not claimed as durable Cloud SQL persistence. No Source Guide, Note Assistant, Studio generator, or complete Gate v2.0 behavior is claimed.
