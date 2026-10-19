# Validation Record: Workspace & UI Comfort

SRS scope: `FR-WM-02`, `FR-WM-03`, `FR-UI-02`, `FR-GC-03`. Exact pnpm commands unset Gemini key variables because those shell values can falsely trigger the keyless deterministic-eval preflight; clean invocation passed 29/29.

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
- **Package 2.1 specifics:** overview fields, icon (`PATCH /api/notebooks/:id/icon`), opened
  (`POST .../opened`) and sort are served by the v1 notebook routes; Ready counts come from PostgreSQL
  (`countReadySources`). Chat turns now carry the caller's input/output language (`ResponsePreferences` in
  `apps/api/src/chat/prompt.ts`, test `apps/api/test/chat-preferences.test.ts`). API tests
  (`apps/api/test/workspace-preferences.test.ts`) run on the real app; the Chromium acceptance
  (`apps/web/test/workspace-comfort.spec.ts`) measures SC-002 at the 100-notebook cap of FR-WM-07 (the
  former 500-row fixture exceeded the per-user limit). The topic icon needs Vertex AI (`VertexTopicEmojiSelector`).
- **Not carried over:** tests of the removed v1 stub modules (`notebooks.ts`, `workspace-layout.ts`,
  `sources/list.ts`) were deleted; their behaviour is covered by the E2E journeys above.

## Convergence against the revised Package 2.1 card (2026-10-20, T040–T059)

SRS scope: `FR-WM-02`, `FR-WM-03`, `FR-UI-02`. Tasks are qualified as `[005-workspace-ui-comfort] Tnnn`.
Database: PostgreSQL 16 + pgvector (`pgvector/pgvector:pg16`, local container `everlast-pg-test`) via
`TEST_DATABASE_URL`. pnpm ran on Node 24.22.0 (devEngines). All commands ran with `env -u GEMINI_API_KEY -u GOOGLE_API_KEY`.

### Flow-back (T040–T042, `CC-01`)

`spec.md`, `plan.md`, `data-model.md`, `contracts/interfaces.md`, `quickstart.md` and the Solution Architecture §4.1
Relational DB row now match the revised card: SC-002 at 100 notebooks; view mode and sort order only in
`localStorage`; `Intl.Collator` title order with a `created_at` tie-break; Role column from v6.0; D16 meaning of
"persisted" and "after reload"; theme in `localStorage` and on the server, the server value winning once loaded;
input language passed as the question language (typed input only); personal per-notebook overrides from v6.0;
output default user > supported browser locale > `en-US`. Re-analysis recorded in [analysis.md](analysis.md).
No card change was needed.

### TDD Red (`CC-02`)

- **Vitest**, after writing T043, T045, T047, T049, T051, T053, T055 and T057 and before any implementation:
  `vitest run packages/contracts/test/package-v2-1.test.ts packages/db/test/workspace-preferences.test.ts apps/api/test/workspace-preferences.test.ts apps/web/test/workspace-preferences.test.ts`
  → 4 files failed; **20 failed, 40 passed (60)**. Every failure was a requirement assertion: empty state was a `<p>`
  and sort stayed enabled (T043); `updated_at` did not advance after source, note and Studio writes (T045);
  `renderIconPicker` was not exported for the header (T047); view/sort were sent to and accepted by the server, and
  the server list used the saved sort (T049); the server theme was applied but not written to `localStorage` (T051);
  equal titles broke by `id`, and the UI locale was ignored (T053, client and server); override fields were accepted
  with 200 (T055); the settings select showed `en-US` instead of the browser locale, and the workspace sent raw
  `pt-PT` (T057).
- **Drift test** for the browser `resolveOutputLanguage` copy (T057): `vitest run apps/web/test/v2-contracts.test.ts`
  → 1 failed, 8 passed (the copy did not exist).
- **Chromium**, new/extended WC-E02, WC-E04, WC-E05 run against the unchanged sources:
  `pnpm test:e2e --grep "Workspace comfort Chromium acceptance"` → **3 failed, 2 passed** (header icon was a static
  span; no `Create your first notebook` button; `/api/preferences` still returned `view_mode`).
- One test bug was fixed during Green, not counted as Red: the T055 API case first called the runtime with the
  sign-in name instead of the internal user id.

### Implementation (T044, T046, T048, T050, T052, T054, T056, T058)

| Task | Change |
| :- | :- |
| T044 | `home.ts`: `Create your first notebook` button (creates and opens a notebook); sort control disabled while empty. |
| T046 | `touchNotebookModified()` now runs after source upload completion, copied-text sources and failed-source dismissal (`routes/sources.ts`, `routes/notebooks.ts` via `V2Runtime.notebookModified`), note create/update/delete, saved responses, convert-to-editable and note sources (`NotesService`), and Studio create/retry/cancel/delete/convert plus job completion (`StudioService`, `runtime.ts`). D16 in-memory mirror unchanged; v1 has no source rename route. |
| T048 | `renderIconPicker` is exported and used in the workspace header (`data-testid=workspace-notebook-icon`), with the same 400 handling. |
| T050 | `view_mode`/`sort_order` removed from `OwnerWorkspacePreferences(Patch)Schema`, the store type, the API default sort (`recent`) and the settings state; the home view no longer PATCHes them; a theme change keeps the local view/sort. |
| T052 | `adoptServerTheme()` applies the hydrated server theme and writes it to `localStorage` (home and workspace). |
| T054 | Client and server sorters use `Intl.Collator(locale, { sensitivity: "base" })`; ties fall back to `created_at` desc, then `id`. |
| T056 | `input_language_override`/`output_language_override` removed from the notebook preference schema and patch (400 on PATCH); the resolver's personal-override slot stays unused until v6.0. |
| T058 | Browser copy of `resolveOutputLanguage` (with drift test); the settings select and the workspace's effective output language use it. |

### Green and gates (T059)

| Command | Result |
| :- | :- |
| Focused Vitest: `vitest run packages/contracts/test/package-v2-1.test.ts packages/db/test/workspace-preferences.test.ts apps/api/test/workspace-preferences.test.ts apps/web/test/workspace-preferences.test.ts apps/web/test/v2-contracts.test.ts apps/api/test/chat-preferences.test.ts` | PASS, 6 files / 74 tests |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS (spec integrity + `tsc -b --noEmit`) |
| `pnpm test:unit` | PASS, 19 files / 262 tests |
| `pnpm test:integration` | PASS, 55 files / 337 tests |
| `pnpm eval:deterministic` | PASS (exit 0): citation_precision 160/160, scoping_leakage_count 0; judged metrics `UNAVAILABLE` (need the Vertex AI enterprise endpoint) |
| `pnpm test:e2e --grep "Workspace comfort Chromium acceptance"` | PASS, 5 tests (WC-E01..05); 100 notebooks: view 36.3 ms, sort 31.9 ms (SC-002 ≤ 100 ms) |
| `pnpm test:e2e` (full Chromium suite) | PASS, 35 tests; view 64.4 ms, sort 38.7 ms |
| `node scripts/check-spec-integrity.mjs` | PASS, 134 Markdown files, 55 SRS IDs, 24 feature artifacts |
| `git diff --check` | PASS |

`UNAVAILABLE`: the live Flash-Lite topic-icon smoke test and the judged eval suite (no enterprise Vertex AI
credentials). v2 data stays in API memory (D16); no durable persistence and no Gate v2.0 completion is claimed.

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
