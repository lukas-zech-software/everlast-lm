# Gate v4.0 Evaluation & Release Clearance (v4.0 — Active Learning Suite & Visuals / Presentations)

## Scope

Release `v4.0` implements **Package 4.1 (`014-studio-active-learning-suite`)** and **Package 4.2 (`015-studio-visuals-presentations`)**:

- **Gate v4.0 #1 (`FR-ST-12`..`FR-ST-15`, `NFR-EVAL-02`, `NFR-EVAL-04`, `NFR-SEC-01`)**: Active Learning quality, semantic short-answer grading equivalence, prompt-injection blocking, server-side Explain `S_aktiv` guard (`409 SupportingSourcesRequired`), `1.000` citation precision, and `0` unselected-source leakage.
- **Gate v4.0 #2 (`FR-ST-13`, `FR-ST-14`, `FR-ST-15`)**: PostgreSQL `learning_progress` persistence (`0013_studio_active_learning.sql`), multi-session mastery retention, `Review missed` filtering, and confirmed reset.
- **Gate v4.0 #3 (`FR-ST-16`, `FR-ST-17`, `D8`/`DEV-02`, `D9`, `NFR-SEC-02`, `NFR-EVAL-02/04`)**:
  - **Slide Decks (`FR-ST-16`)**: 5 layouts (`title`, `two_column`, `key_metric_callout`, `comparison_table`, `diagram_chart`), `5..20` slides (default `10`), `0..2,000` trimmed Unicode code point `focus_prompt` rejection without truncation, `<= 5` bullets per slide x `<= 15` words per bullet with overflow routed into `speaker_notes`, editable OOXML `.pptx` text shapes + linked `notesSlide` speaker notes (macro-free, zero external links), and valid 16:9 multi-page `.pdf` verified with `pdfjs-dist`. Google Slides export remains explicitly deferred (`D8` / `DEV-02`).
  - **Visual Infographics (`FR-ST-17`, `D9`)**: 5 styles (`auto`, `process_flow`, `comparison`, `metrics_summary`, `architecture_diagram`), `0..1,000` trimmed Unicode code point `focus_prompt` rejection without truncation, deterministic crisp vector SVG with dynamic wrapping and height expansion (zero clipping or overlap), `"AI-generated · Illustration"` label, cited source badges, `.svg` and 2x Canvas `.png` export, safe DOM mounting without `innerHTML`, and zero partial exports on `Failed` rows.

## Deterministic & Automated Verification (`pnpm eval:deterministic`, Integration, & Playwright E2E)

| Gate | Suite / Command | Observed Evidence | Status |
| :--- | :--- | :--- | :--- |
| Gate v4.0 #1 | `pnpm eval:deterministic` (`packages/evals/src/studio-active-learning-eval.ts`) + Playwright (`apps/web/test/studio-active-learning.spec.ts`) | Citation precision `1.000`, unselected leakage `0`, semantic equivalence (`"0.2 GB (200 MB)"` == `"200 megabytes"`) `true`, prompt-injection blocked `true`, Explain scope guard `true` | PASS (Local under `D24`/`DEV-07`) |
| Gate v4.0 #2 | PostgreSQL integration (`packages/db/test/studio-active-learning.integration.test.ts`, `apps/api/test/studio-active-learning.test.ts`) + Playwright (`apps/web/test/studio-active-learning.spec.ts`) | Cross-reload `learning_progress` persistence (`3 mastered, 2 needing review`), `Review missed` filter (`Q2`, `Q4`), and confirmed reset verified | PASS (Local under `D24`/`DEV-07`) |
| Gate v4.0 #3 | `pnpm eval:deterministic` (`packages/evals/src/studio-v4-eval.ts`) + Playwright (`apps/web/test/studio-visuals.spec.ts`) + API/Worker/Render tests | 8-slide deck across active sources, `.pptx` ZIP/XML + `notesSlide1..8.xml` (`sanitizeOoxml` clean), 8-page `960x540` 16:9 `.pdf` (`pdfjs-dist`), `process_flow` D9 `.svg` & 2x `.png`, Failed Retry without export, `everlast-render` private `studio` namespace | PASS (Local under `D24`/`DEV-07`) |
| Monorepo Regression | `ARCHITECTURE_BASE_REF=origin/main node scripts/lint.mjs`, `check-kpi-sanity.mjs --include-specs --strict`, `pnpm test:contract` (`19/19` files, `277` tests), `pnpm test:unit` (`72/72` files, `605` tests), `pnpm test:integration` (`152` passed files, `888` tests), `pnpm test:e2e` (`70/70` Chromium E2E tests) | Zero lint/type/architecture/KPI findings; `88` exact legacy `T035` exceptions preserved | PASS |

## Live Cloud & External Runtime Disclosure (`UNAVAILABLE` Locally)

- **Live Vertex LLM Evaluation (`pnpm eval:judged`)**: `UNAVAILABLE` in local developer verification (no live Gemini/Vertex API credentials or billing-enabled project attached to this offline worktree environment). Deterministic extraction/composition models, schemas, citation verifiers (`NFR-EVAL-02/04`), and `StructuredGenerator` wiring (`VertexFlashcardsModel`, `VertexQuizModel`, `VertexLearningOverviewModel`, `VertexSlideDeckModel`, `VertexInfographicModel`) are verified locally; live `eval:judged` stays scoped to dev cloud release pipelines (`D24` / `DEV-07`).
- **Headless LibreOffice (`soffice`) Binary Conversion**: `UNAVAILABLE` on the local macOS development host (`/Applications/LibreOffice*` and `soffice` binary not installed). Local API `.pdf` exports use deterministic 16:9 PDF 1.4 generation verified via `pdfjs-dist`, while `apps/render/src/main.ts` enforces private `notebooks/{notebookId}/studio/{artifactId}/...` namespace isolation and macro stripping for Cloud Run `everlast-render` deployments (`NFR-SEC-02`).
- **Google Slides Export**: Intentionally deferred per `D8` / `DEV-02`; requests for `format: "google_slides"` return `422 ValidationError` and no UI button is rendered.
