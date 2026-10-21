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
