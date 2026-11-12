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

6. **Gate v2.0 #3 (deterministic)**: `pnpm eval:deterministic` runs `packages/evals/test/studio-reports-gate.eval.test.ts` (all four templates, required section keys, per-sentence citations in scope, precision 1.0, leakage 0).
7. **Browser journey**: `pnpm test:e2e` runs `apps/web/test/studio-reports.spec.ts` (needs `TEST_DATABASE_URL`).

Status of external runners: LLM-judged evals (`NFR-EVAL-01/03`) and the Vertex Flash P95: `UNAVAILABLE` until a deployed run against Vertex AI `europe-west4` exists.


## Guide admission and pre-V4 follow-up (2026-11-07; FR-SI-02, FR-ST-10/11)

Migration0012 adds the private metadata ledger. Deployment must run ordinary
migrations before serving updated API code. Configure positive integer
`GUIDE_MAX_CONCURRENT` (default2) and `GUIDE_MAX_STARTS_PER_HOUR` (default20).
Ready-triggered primary Guides are excluded; extra-language source/revision/language
identity deduplicates before charging. A limited direct Guide read returns429
with `GuideAdmissionLimited`; suggestions become temporarily unavailable without
disabling standard/custom report creation. Terminal outcomes release a slot;
failures remain charged for the rolling hour. If release fails at the database,
capacity stays occupied until single-instance startup recovery.

Local verification uses the disposable connection returned by `pnpm db:test:up`
(actual port54329 in this run), never the cloud database:

```sh
pnpm exec vitest run apps/api/test/guide-admission.integration.test.ts apps/api/test/guide-admission-config.test.ts packages/db/test/guide-admission.integration.test.ts apps/api/test/studio-runtime.integration.test.ts apps/api/test/v2-restart.integration.test.ts apps/worker/test/studio-vertex-report-model.test.ts
```

The saved overall judged report remains FAIL (report validity75%, three Vertex504
warnings, missing OCR configuration). The report client retains20-second per-call
HTTP timeout and at most two transient retries. Logs do not bind the504s to an
extract/compose request or expose sufficient timing to distinguish provider vs
client deadline. No timeout was increased and no speculative report rewrite made.
Final candidate must qualify all four templates and unchanged P95<=25seconds.

Read-only coordinator inventory found an existing ENABLED EU layout processor:
`projects/865450204790/locations/eu/processors/7e8fb3b073398d36`. Set
`DOCUMENT_AI_PROCESSOR_NAME` to the approved existing processor for final judged
configuration; recheck its current status/permissions. Its existence is not an OCR
pass and authorizes no new paid run. No002 implementation is implied solely by
this previously missing configuration.

Recovered012 overlaps runtime imports/Studio wiring and report model/pipeline/cache
files. Preserve the008 admission paths, primary Ready dispatch and startup recovery
when integrating012; do not overwrite them with its older runtime copy. Report
model/pipeline files were deliberately unchanged here, so012's bounded original
evidence/cache repair can be reviewed separately before new live report evidence.


Primary identity is frozen in `guide_primary_languages` per source/revision before
any on-demand admission. Bootstrap existing revisions from an existing Guide
(preferring Ready-origin metadata). Subsequent notebook/user language changes
never redefine primary identity: a new language variant is charged, including
when it now matches the mutable preference. This also prevents a seen Ready
dispatcher from leaving the changed-language request permanently Pending.
