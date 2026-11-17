# Quickstart & Verification Guide: Studio Visuals & Presentations (Package 4.2)

**Feature**: `specs/015-studio-visuals-presentations`
**Worktree**: `/Users/luke/Projects/claude/everlast/worktree/v4-015-studio-visuals-presentations`
**Branch**: `feat/v4-015-studio-visuals-presentations`
**SRS IDs**: `FR-ST-16`, `FR-ST-17`, `C-01..C-03`, `NFR-EVAL-01..04`, `Gate v4.0 #3`

## 1. Prerequisites

```sh
pnpm install --frozen-lockfile
pnpm db:test:up
export TEST_DATABASE_URL=postgres://everlast:everlast@127.0.0.1:54329/everlast
```

## 2. Verification Commands

| Check | Command | Scope |
| :--- | :--- | :--- |
| Spec integrity | `node scripts/check-spec-integrity.mjs` | Links, anchors, FR links, CC-01/CC-02 |
| KPI sanity | `node scripts/check-kpi-sanity.mjs --include-specs --strict` | `D24` / `DEV-07` proportionality |
| Architecture & lint | `ARCHITECTURE_BASE_REF=origin/main node scripts/lint.mjs` | Spec integrity, 39 arch fixtures, `check-architecture`, `check-architecture-artifacts`, `tsc -b --noEmit` |
| Build | `pnpm build` | `tsc -b && node scripts/build-web.mjs` |
| Contract tests | `pnpm test:contract` | `packages/contracts/test/**/*.test.ts` incl. `package-v4-2.test.ts` |
| Unit tests | `pnpm test:unit` | Pure unit tests registered in `vitest.config.ts` `UNIT` array |
| Project sync test | `node --test scripts/sync-github-project.test.mjs` | GitHub Project roadmap/gate mapping |
| Integration tests | `TEST_DATABASE_URL=postgres://everlast:everlast@127.0.0.1:54329/everlast pnpm test:integration` | PostgreSQL 16 + pgvector (`studio-visuals.integration.test.ts`, `studio-visuals.test.ts`) |
| Deterministic eval | `TEST_DATABASE_URL=postgres://everlast:everlast@127.0.0.1:54329/everlast pnpm eval:deterministic` | `NFR-EVAL-02 = 1.0`, `NFR-EVAL-04 = 0`, `Gate v4.0 #1` & `#3` |
| E2E Playwright | `TEST_DATABASE_URL=postgres://everlast:everlast@127.0.0.1:54329/everlast pnpm test:e2e` | Full Chromium E2E suite incl. `studio-visuals.spec.ts` (`Gate v4.0 #3`) |

## 3. Manual Smoke Scenarios

1. **Slide Deck + PPTX/PDF Export (`FR-ST-16`, `Gate v4.0 #3`)**: Upload 2 active sources -> click `"Slide Deck"` -> set slide count `8` -> generate -> open Completed deck in 16:9 carousel viewer -> verify 8 slides, `<= 5` bullets (`<= 15` words/bullet), citations `[n]`, toggle `"Speaker Notes"` -> click `"Export PPTX"` (validates 8 slide XMLs + `notesSlide` XMLs) -> click `"Export PDF"` (validates 8 landscape 16:9 pages via `pdfjs-dist`).
2. **Failed Slide Deck Retry (`FR-ST-16`, `C-03`)**: Trigger failed slide deck -> verify `"Failed"` status, failure reason, `"Retry"` button, and zero partial `.pptx`/`.pdf` export actions.
3. **4-Stage Process Flow Infographic + SVG/PNG Export (`FR-ST-17`, `D9`)**: Upload source describing a 4-stage incident response workflow -> click `"Infographic"` -> select `"process_flow"` -> generate -> open zoomable viewer -> verify all 4 stages, `"AI-generated · Illustration"` badge, cited sources footer, non-clipping wrapped boxes -> click `"Export SVG"` and `"Export PNG"`.
