# Validation Log: Package 2.4 Studio Text Synthesis & Reports

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Tasks**: [tasks.md](tasks.md)

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
- **Package 2.4 specifics:** Studio access, snapshot verification and generation read sources through the
  v1 PostgreSQL C-02 path; reports run in the API process (`InlineStudioDispatcher`). *(Superseded 2026-10-20,
  see below: the Vertex Flash report adapter exists.)*
  The designed table moved to `packages/db/migrations/v3-draft/` (not applied).
- **Not built (superseded 2026-10-20):** the reports modal and artifact list UI — now built (T058).

## Phase 7 convergence (2026-10-20, branch `feat/v2-008-converge`, T038–T060)

Worktree `impl-008`, Node 24, PostgreSQL 16 + pgvector (`everlast-pg-test`, port 54329). Base `feat/v2-007-converge`
(`c96bf41`), with the Reports UI branch `feat/v2-008-ui` merged (T048, T049, T058).

| Gate / command | Result |
| :- | :- |
| `pnpm lint` | pass (incl. spec integrity and TypeScript compilation) |
| `pnpm typecheck` | pass, 0 errors |
| `pnpm test:unit` | 20 files / 276 tests passed |
| `pnpm test:integration` (`TEST_DATABASE_URL` set) | 66 files / 459 tests passed |
| `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm eval:deterministic` | exit 0; Precision_ID 160/160 = 1.0, leakage 0; **Gate v2.0 #3 Studio reports: PASS** — validity 100 % (4/4 templates), citation precision 1.000, leakage 0, P95 2.5 ms (≤ 25,000 ms), deterministic report model (test double) |
| `pnpm test:e2e` (Chromium) | 37 passed, 1 skipped (`GC-E04`, a pre-existing `test.fixme`); includes `studio-reports.spec.ts` ST-E01 and ST-E02 |
| `node scripts/check-spec-integrity.mjs` | pass (134 Markdown files, 55 SRS IDs, 24 feature artifacts) |

**Current state of Package 2.4**

- Reports use the Vertex AI Flash report model (`gemini-2.5-flash`, `europe-west4`, keyless ADC, fixed grounding and
  citation system instruction; T053) when Vertex is configured (`createV2ReportModel` in `apps/api/src/server.ts`),
  else the deterministic extractor. Owner default 2026-10-20: Flash only (no Pro routing).
- Dynamic suggestions use Flash-Lite through the Package 2.2 structured-generation client (T054); without it, or when
  guides can never be generated, the API answers `SuggestionsUnavailable` (owner default 2026-10-20).
- Studio jobs read every chunk of their snapshot in keyset pages (T050, D12); sections use the card's stable keys
  (T051); Gate v2.0 #3 rules are enforced by `validateReportPayload` (T052); the cancel route and UI are removed
  (T056); the snapshot field is `source_revisions_snapshot` (T059); Convert to source saves a cited note and converts
  it through FR-NM-03 (T057). The Reports tile, modal, list and viewer are mounted in the Right Panel (T058).
- Security review 2026-10-20: `output_language` must be one of the FR-UI-02 supported tags (400 otherwise), and
  on-demand Source Guide runs start only for such a tag. Deferred: per-notebook cap/rate limit for on-demand guide
  runs (T061).
- v2 has no source-delete route; the deletion-before-publication tests (T047) remove the source row in PostgreSQL.

**Gate v2.0 #3:** passed for the deterministic run (T042 and T049 pass). **UNAVAILABLE:** the Vertex Flash release
variant (P95 ≤ 25.0 s with the live model) and the LLM-judged evals (`NFR-EVAL-01/03`) until a deployed run against
Vertex AI `europe-west4` exists; no live Vertex run was made.

## Live Gate v2.0 fixes, 2026-10-20 (branch `fix/v2-008-live-gate`, T062–T065)

**Before (first live `pnpm eval:judged`, Vertex `europe-west4:gemini-2.5-flash`):** Gate v2.0 #3 FAIL — validity
75 % (3/4), citation precision 1.000, leakage 0, P95 28,379.6 ms (> 25,000 ms). The Study Guide was refused with
`InsufficientEvidence` ("The selected sources do not contain enough supported content for every required section of
this report"). That was correct: the 4-chunk fixture could not support every required section, and the card says never pad.

**Changes (FR-ST-10, Gate v2.0 #3, D12):**

- Latency: every report call (extract and compose) now sends `thinkingConfig: { thinkingBudget: 0 }` and
  `maxOutputTokens: 8192` (`REPORT_GENERATION_CONFIG`, `@google/genai` 2.30 `ThinkingConfig`; 0 = thinking off on
  `gemini-2.5-flash`). It goes through a new optional `generationConfig` on the shared Package 2.2
  `generateStructured`. Source Guide, overview and follow-up requests stay byte-identical (tested). A truncated
  response fails JSON validation and becomes a `GenerationError`; it never produces a partial report.
- Pipeline: the map step runs up to `EXTRACT_CONCURRENCY` = 4 extract calls in parallel, with findings merged in
  batch order. No new batches start after a failure. The default batches shrink to ≤ 8 chunks / 4,000 tokens
  (research R2), so a 20-chunk notebook needs 3 parallel extract calls instead of 1 long one. Compose stays one call.
- Gate fixture: `studioGateFixture()` now has two selected sources with 10 chunks each (diplomatic history
  1648–1919 with dated events and actors; cryptography/ledger definitions with dates and people), plus a two-chunk
  unselected source that carries `LEAK_TERM`. Every validation rule is unchanged; this changes test data, not the bar.

**Verification (local, keyless):**

| Gate / command | Result |
| :- | :- |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass, 0 errors |
| `pnpm test:unit` | 20 files / 276 tests passed |
| `pnpm test:integration` (`TEST_DATABASE_URL` set) | 67 files / 467 tests passed |
| `env -u GEMINI_API_KEY -u GOOGLE_API_KEY -u GOOGLE_GENAI_API_KEY pnpm eval:deterministic` | exit 0; citation_precision 160/160 = 1.0, scoping leakage 0; **Gate v2.0 #3 (deterministic): PASS**, validity 100 % (4/4), precision 1.000, leakage 0, P95 7.5 ms |
| `pnpm test:e2e` (Chromium) | 37 passed, 1 skipped (`GC-E04`, pre-existing `test.fixme`) |
| `node scripts/check-spec-integrity.mjs` | pass |

**Live Gate v2.0 #3 re-run: UNAVAILABLE (T065).** One attempt with `runStudioReportsReleaseGate` (`VERTEX_PROJECT=lukas-gcloud-playground`,
`VERTEX_LOCATION=europe-west4`) failed during authentication with `invalid_grant`, because the ADC refresh token
has expired. No model call was made. After `gcloud auth application-default login` the check must be re-run, and
the validity, precision, leakage and P95 values recorded here. Until then the live P95 ≤ 25.0 s is not proven.
