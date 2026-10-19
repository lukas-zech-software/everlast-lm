# Quickstart: Studio Text Synthesis & Reports

**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **SRS IDs**: FR-ST-10, FR-ST-11, C-03, Gate v2.0 #3

```bash
pnpm install
pnpm typecheck && pnpm lint                       # lint also runs node scripts/check-spec-integrity.mjs
pnpm exec vitest run packages/contracts/test/package-v2-4.test.ts \
  packages/db/test/studio-artifacts.test.ts packages/db/test/studio-artifacts-schema.test.ts \
  apps/worker/test/studio apps/api/test/studio apps/web/test/studio
```

## Validation scenarios

1. **Four standard templates** (`apps/worker/test/studio-reports.integration.test.ts`): two Ready sources (dated events + definitions) → four jobs reach `Completed`; Study Guide has Glossary and Answer Key; Timeline has events and Cast of Characters; leakage = 0 (FR-ST-10).
2. **Replaced revision** (`studio-runner.test.ts`): replace Source A rev 1→2 before publish → `Failed/SourceChanged`, no payload; retry needs fresh explicit scope.
3. **Custom prompt boundary**: 1 and 5,000 code points accepted, empty/whitespace and 5,001 rejected (FR-ST-11).
4. **Suggestions**: 3–4 cards ≤ 3.0 s, cached per source-set identity; Pending → loading; Failed → unavailable (FR-ST-11).
5. **Studio list/viewer** (`apps/web/test/studio-*.test.ts`): `Generating Briefing doc...` row, viewer with copy/convert/delete.

Status of external runners: Playwright E2E and LLM-judged evals (`NFR-EVAL-01/03`): `UNAVAILABLE` (no live model/browser harness in this slice).
