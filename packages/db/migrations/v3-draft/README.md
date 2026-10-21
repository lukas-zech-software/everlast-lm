# Draft v3 schema (not applied)

Release v2 runs its notes and Studio artifact stores in process memory on purpose (architecture decision
[D16](../../../../docs/solution-architecture.md#decisions)). These two files are the PostgreSQL tables the v2
packages designed for that data. The migration runner ignores this folder. In v3 they become numbered
migrations after the latest v1 migration, together with the switch of the v2 stores to PostgreSQL.

The schema tests in `packages/db/test/notes-schema.test.ts` and `studio-artifacts-schema.test.ts` keep the
drafts valid against a minimal users/notebooks base.
