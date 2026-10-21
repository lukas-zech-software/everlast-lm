# Quickstart: validate v2 persistence

## Prerequisites

- Node.js 24 via `pnpm`, dependencies installed (`pnpm install --frozen-lockfile`).
- Local PostgreSQL 16 + pgvector: `pnpm db:test:up`, then `export TEST_DATABASE_URL=postgres://everlast:everlast@127.0.0.1:54329/everlast`.

## Automated validation

| Step | Command | Expected |
| :- | :- | :- |
| Migrations apply in order | `pnpm exec vitest run packages/db/test/notes-schema.test.ts packages/db/test/studio-artifacts-schema.test.ts` | pass against `0007`/`0008` |
| Store suites (PostgreSQL) | `pnpm exec vitest run packages/db/test` | pass |
| Restart suite (US1–US4, SC-001/003/004) | `pnpm exec vitest run apps/api/test/v2-restart.integration.test.ts` | pass: records equal after a second runtime on the same DB; sweeps fail interrupted reports and drop orphaned pending guides; cascade leaves 0 rows |
| v2 regression (SC-002) | `pnpm test:integration` | all existing v2 suites pass unchanged |
| E2E | `pnpm test:e2e` | pass |
| Spec integrity | `node scripts/check-spec-integrity.mjs` | pass |

## Manual check (optional, local)

1. `pnpm dev` (or the local API) against the test database; sign in, create a notebook, add a note, pin the notebook, set a custom icon, generate a report.
2. Stop and restart the API.
3. Reload the browser: note, pin, icon and report are unchanged; the notebook list order is the same.

## Validation results (2026-10-21, local, PostgreSQL 16 + pgvector)

| Check | Result |
| :- | :- |
| `pnpm lint`, `pnpm typecheck`, `node scripts/check-spec-integrity.mjs` | pass |
| `pnpm test:unit` | 20 files, 279 tests pass |
| `pnpm test:integration` (`--maxWorkers=4`) | 72 files, 506 tests pass (once, US1-B11 in `apps/worker/test/ingestion.boundaries.test.ts` timed out under load and passed alone; unrelated to v2) |
| `pnpm test:e2e` | 37 passed, 1 skipped |
| Restart suite `apps/api/test/v2-restart.integration.test.ts` | 14/14 (US1-1..4, US2-1..4, US3-1..5, US4-1..2) |
| Note save latency on PostgreSQL (analysis C1, `FR-NM-01` ≤ 1.0 s) | 100 sequential note PATCHes through the API: P50 5.2 ms, P95 7.0 ms, max 12.9 ms |

Test setup changes to existing suites (assertions unchanged): `apps/api/test/workspace-preferences.test.ts` reads the owner id from `notebooks` instead of the removed notebook mirror; `apps/api/test/package-v2-2-runtime.test.ts` reads guides inside the app's store scope; `apps/api/test/support.ts` / `notes-pg-support.ts` can reuse a database for the restart suite. The SQLite draft-schema tests were replaced by `packages/db/test/v2-schema.integration.test.ts`.
