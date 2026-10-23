# Implementation Evidence: Multimodal Ingestion & Sync (specs/009)

Scope: FR-SI-01 Subset B, FR-SI-05, C-01; supporting FR-SI-02/03/04, FR-GC-02/03/06, FR-WM-04/05/07, FR-NM-03,
C-02/C-03, NFR-SEC-01/02, NFR-EVAL-01..04, Gate v3.0 #1. Task references are qualified as
`[009-multimodal-ingestion-sync] Tnnn`.

## T001 — Preconditions (FR-SI-01/05, NFR-SEC-01/02, Gate v3.0 #1)

| Item | Recorded value |
| :--- | :--- |
| Worktree / branch | `/Users/luke/Projects/claude/everlast/everlast-lm-worktrees/impl-009`, `feat/v3-009-multimodal-ingestion-sync` |
| Base | `origin/main` `c9403554f8ee4886f448ccfbebf33c988891474b` |
| Feature pin | `.specify/feature.json` → `specs/009-multimodal-ingestion-sync` (`SPECIFY_FEATURE_DIRECTORY` unset, not persisted) |
| Gate v2 authority | Owner override recorded in `docs/gate-v2-live-evaluation.md` (2026-10-20). The 2026-10-22 live re-run passes #3; #1 (18/20 GuideReady) and FR-GC-07 Shorter still fail; judged rejection 24/25. These limitations are retained, not re-claimed as passing. |
| Runtime | Node.js `v26.3.0`, pnpm `12.0.0`, TypeScript `5.9.3`, Vitest `4.1.11`, Playwright browsers installed locally |
| Baseline suite | `pnpm test` on the base commit: 92 files / 800 tests passed (real PostgreSQL 16 + pgvector container `everlast-pg-test`, `TEST_DATABASE_URL=postgres://everlast:everlast@127.0.0.1:54329/everlast`) |
| Isolated DB / storage | Each suite creates a fresh migrated database (`packages/db/src/testing.ts`); storage is the versioned local filesystem adapter in a temp dir. No production data, credentials or cloud resources are used. |
| ADC / provider prerequisites | Speech-to-Text V2 (Chirp 2, `europe-west4`), Model Armor (`europe-west4` template), Google Drive API with a registered delegated OAuth client, Cloud Run Jobs (`everlast-render`): **UNAVAILABLE** in this environment (no approved API enablement, no delegated test account). Live adapters are implemented behind typed ports and exercised with labelled test doubles only. |
| LibreOffice | `soffice` **UNAVAILABLE** locally; `ffmpeg` present (`/opt/homebrew/bin/ffmpeg`) but not used by tests. Render job runs only in its container image. |
| Reviewer checklist | `checklists/requirements.md` 16/16 checked. `checklists/ingestion-sync.md` 0/37 checked: reviewer-owned requirements-quality items were **not** reviewed or approved by this implementation run; the orchestrating agent directed implementation to proceed. |
| Package boundaries | Package 3.1 only. Packages 3.2 (FR-GC-08), 3.3 (FR-ST-08/09/18) and 3.4 (NFR-PERF-01) are not touched. No deployment, `tofu apply` or API enablement was performed. |
| Migration reservation | `0009_multimodal_ingestion_sync.sql` (after applied 0001–0008). Packages 3.2/3.3 start at `0010`. |

## Security review findings (2026-10-23) — all fixed test-first (CC-02)

| # | Severity | Finding | Resolution | Red → Green evidence |
| :- | :- | :- | :- | :- |
| 1 | HIGH | OAuth `state` signed but not bound to the initiating browser (login CSRF / account-linking confusion) | `authorize` (an authenticated bearer request) now sets an `HttpOnly; SameSite=Lax; Path=/oauth/google` nonce cookie and stores `{nonce_hash, user_id, PKCE verifier, return_to, expires_at}` in `oauth_states` (migration 0009). The callback requires the signed state, a cookie whose hash matches the state, and atomically consumes the single-use, unexpired row for exactly the state's user; PKCE S256 challenge in the consent URL, verifier only server-side; cookie cleared on success. The SPA has no session cookie (bearer tokens only), so the nonce cookie set on that user's authenticated response is the browser/session binding. | `apps/api/test/office-import.test.ts` OFFICE-API-07: Red (`expected '' to match /^everlast_oauth_nonce=…/`) → Green; covers tampered state, missing/foreign cookie, another user's state, replay, PKCE. |
| 2 | MEDIUM | Render SA had bucket-wide `roles/storage.objectUser` | Replaced by `roles/storage.objectViewer` conditioned on `objects/notebooks/` and `roles/storage.objectCreator` conditioned on `notebooks/*/sources/*/normalized/*` (no overwrite/delete). IaC edited only; not applied. | `apps/render/test/render-config.test.ts` RENDER-07 Red → Green |
| 3 | MEDIUM | LibreOffice/ffmpeg could follow linked/external content | Render sanitizes OOXML before conversion (drops External/scheme relationships and relationships to removed parts, OLE/ActiveX/embedded `.bin`, `vbaProject`, `externalLinks`, DDE/field instructions, `ddeLink`/`oleObj`); profile sets Writer/Calc link update mode to never and disables active content; ffmpeg forces the demuxer per allowed type (`mp3`/`wav`/`mov`) with `-protocol_whitelist file` (playlist/concat refused); the job egresses only into an isolated NAT-less VPC with Private Google Access. A deny-all firewall + private `googleapis.com` DNS zone was rejected (fixed idle cost, CC-08; NAT-less egress already has no internet path). `compute.googleapis.com` joins the approval-gated v3 API list. | RENDER-03, RENDER-03b, RENDER-04, RENDER-06 Red → Green |

### Security review round 2 (2026-10-23, render sanitizer) — fixed test-first

| # | Severity | Finding | Resolution | Evidence |
| :- | :- | :- | :- | :- |
| 4 | MEDIUM | Zip bomb / malformed archive handling in `apps/render/src/zip.ts` | Budget checked against declared size before inflating (stored entries included) and against actual output; inflate capped at the declared size; local/central method and sizes must agree (unless a data descriptor is flagged); entry data must lie inside the archive before the central directory; overlapping entries and duplicate names rejected. | `apps/render/test/render-sanitize.test.ts` SAN-06, SAN-07 Red → Green |
| 5 | MEDIUM | Regex `.rels`/field sanitizer bypassable | Replaced by namespace-aware parsing with jsdom's XML mode (already a repo dependency; saxes resolves no DTD/external entities). Relationships kept only if TargetMode is Internal, the Target has no scheme/backslash, and it resolves inside the package to a kept part (absolute paths outside the package never survive). `instrText`, OLE objects, ActiveX controls, `subDoc`, `altChunk`, DDE/external references removed and `fldSimple` unwrapped by namespace URI (transitional and strict namespaces), independent of prefix. Malformed XML aborts the conversion. | SAN-01, SAN-02, SAN-05 Red → Green |
| 6 | MEDIUM | Parts chosen by case-sensitive extension | Parts are classified by `[Content_Types].xml` (case-insensitive names); only allowlisted content types survive (Office XML parts, package relationships/core properties, raster/metafile images); OLE/ActiveX/VBA/external-link/SVG/unknown parts are dropped and their Overrides removed; unsafe or case-duplicate part names abort. | SAN-03, SAN-04 Red → Green |

### Security review round 3 (2026-10-23) — fixed test-first

| # | Severity | Finding | Resolution | Evidence |
| :- | :- | :- | :- | :- |
| 7 | HIGH | Relationship elements in other namespaces skipped instead of failing closed | Every `.rels` root must be `Relationships` in the package relationship namespace, otherwise the document is rejected; `.rels` files are rebuilt from scratch from validated `Relationship` children only (foreign-namespace or unknown elements vanish). | `render-sanitize.test.ts` SAN-08, SAN-09 Red → Green |
| 8 | HIGH | Part allowlist trusted attacker-declared content types | Output contains only parts reachable from `_rels/.rels` through an allowlist of relationship Types (officeDocument, styles, image, header/footer, theme, notes, slide/layout/master, numbering, settings, fontTable, webSettings, footnotes/endnotes, comments, charts/diagrams, core/extended properties …); dangerous part names (`embeddings/`, `activeX`, `externalLinks`, `customXml`, `vbaProject`, `oleObject`, `.bin`, executables) are denied regardless of type; images must pass a magic-byte check (PNG/JPEG/GIF/BMP/TIFF/EMF/WMF). Declared content types remain a necessary condition only. | SAN-10, SAN-11 Red → Green (RENDER-03b and SAN-01..05 fixtures updated to real relationship Types) |
| 9 | MEDIUM | Web fetch had only a per-socket idle timeout | `guardedFetch` has one total wall-clock deadline (default 60 s) covering every redirect hop, headers and body streaming; on expiry the request is aborted (AbortSignal passed to the Node transport) and the response stream destroyed. | `ingestion-web-security.test.ts` SSRF-09 Red (60 s timeout) → Green |

## T047 — Red → Green record (FR-SI-01/05, FR-NM-03, NFR-SEC-02, C-01/C-02, Gate v3.0 #1)

Runner: Vitest 4.1.11 (`unit` + `integration` projects, real PostgreSQL 16 + pgvector), Playwright chromium against
`apps/web/test/e2e-server.ts` (real API/PostgreSQL/worker; provider doubles labelled in `e2e-v3-doubles.ts`).

| Task | Test file(s) | Red observed (requirement-related) | Green |
| :- | :- | :- | :- |
| T003 | `packages/contracts/test/package-v3-1.test.ts` | 14 failing (missing v3 DTOs, 200-point display title, media types); 5 C-01/copied-text regressions green | 19/19 |
| T004 | `packages/db/test/source-sync-foundation.integration.test.ts` | module `source-sync.ts` / migration 0009 absent | 9/9 |
| T005 | `packages/db/test/multimodal-scope.integration.test.ts`, `apps/api/test/multimodal-scope.test.ts` | module absent; v3 routes 405; empty-scope regressions green | 9/9, 4/4 |
| T009 | `apps/render/test/render-config.test.ts` | `src/main.ts` absent | 8/8 (after security rounds) |
| T010–T012 | `apps/worker/test/ingestion-office.test.ts`, `ingestion-drive.test.ts`, `apps/api/test/office-import.test.ts`, `apps/web/test/office-import.spec.ts` | adapters/routes absent | 9/9, 7/7, 7/7, 3/3 |
| T018–T021 | `ingestion-web-security.test.ts`, `ingestion-web.test.ts`, `ingestion-screening.test.ts`, `apps/api/test/web-import.test.ts`, `apps/web/test/web-import.spec.ts` | `web.ts` / Model Armor / `sync.ts` absent | 10/10, 7/7, 6/6, 3/3, 2/2 |
| T025–T028 | `ingestion-media.test.ts`, `apps/api/test/media-content.test.ts`, `apps/web/test/media-citations.spec.ts`, `packages/evals/test/audio-transcription-benchmark.test.ts` | `media.ts`, media proxy, benchmark module absent | 8/8, 5/5, 3/3, 6/6 |
| T033 | `apps/api/test/source-rename.test.ts`, `apps/web/test/source-management.spec.ts` | Rename route Red was observed earlier in T005 SCOPE-A02 (PATCH → 405); the route was delivered by T016's `source-sync.ts`, so T033's own assertions passed on first run (recorded, not re-claimed as Red) | 4/4, SM-E01 |
| T034, T035 | `packages/db/test/source-sync.integration.test.ts`, `apps/api/test/source-sync.test.ts` | Same situation: admission/fence/webhook code came from T007/T016 whose Red was observed in T004/T005; these story tests passed on first run | 6/6, 5/5 |
| T036 | `packages/db/test/source-guide-sync.integration.test.ts`, `apps/worker/test/source-sync-recovery.test.ts`, `apps/api/test/source-guide-sync.test.ts` | stale Guide stored for a replaced revision; `drainPublicationEvents` absent | 2/2, 4/4, 2/2 |
| T037 | `packages/db/test/source-lifecycle.integration.test.ts`, `apps/api/test/source-lifecycle.test.ts` | replaced-revision answer hidden instead of "Source updated" | 4/4, 3/3 |
| T038 | `apps/web/test/source-management.spec.ts` | (UI written with T046) SM-E04 initially failed on the placeholder expectation, corrected to the specified hidden-answer behaviour | 4/4 |
| Security review | `render-sanitize.test.ts`, SSRF-09, OFFICE-API-07, RENDER-03b/04/06/07 | see the security tables above | all green |

Regressions intentionally updated (requirement changed, not weakened): `apps/api/test/sources.test.ts` SRC-03 and
`apps/web/test/sources.spec.ts` SI-E04 used `.pptx` as the "unsupported" example — `.pptx` is now supported (FR-SI-01
Subset B), so they use legacy `.ppt` and the new message; `packages/db/test/v2-schema.integration.test.ts` asserted the
last five migrations — it now asserts 0004–0008 order wherever later migrations follow.

Final full runs (2026-10-23): `pnpm test` 118 files / 962 tests passed (+ T048 file → 119/964, see T053);
`pnpm test:e2e` 50 passed, 1 skipped (pre-existing `test.fixme` GC-E04 on main, not this package).

## T048 — deterministic evals (FR-GC-02, NFR-EVAL-02/04)

- `pnpm exec vitest run --project integration packages/evals/test/multimodal-deterministic.eval.test.ts`: 2/2 —
  mixed-modality (DOCX page_span, web dom_path, MP3 time_span, re-synced web, removed web) citation-ID precision 1.0,
  leakage 0; an adversarial model citing removed/replaced/deselected chunks is always refused (D13).
- `pnpm eval:deterministic`: exit 0 — citation_precision 160/160 = 1, scoping_leakage_count 0; Gate v2.0 #3 Studio
  deterministic PASS. Judged metrics in that report are UNAVAILABLE by design (no Vertex endpoint in this run).

## T049 — judged release evals: NOT RUN (open)

The fixed stratified 50-case judged run (NFR-EVAL-01/03, semantic support) belongs to an authorized v3 release
candidate with the Vertex AI enterprise endpoint. No release candidate exists and no paid model call was authorized
for this implementation run → **UNAVAILABLE**; task left open. No judged-per-PR obligation was added.

## T050 — benchmark and integrated Gate v3.0 #1 scenario (partially done; open)

- Integrated click scenario: `apps/web/test/media-citations.spec.ts` MEDIA-E01 passes — uploading `Interview.mp3`,
  citation [1] → Inspector opens the transcript, the segment at 04:15 (`data-start-ms=255000`) is highlighted and in
  view, the player seek target is 255000 ms; MEDIA-E02 seeks a playable WAV to 255 s. Speech-to-Text is a labelled
  transcript double, so this proves the application path, not live ASR.
- Live 30-minute benchmark: `pnpm eval:v3-audio` → `[UNAVAILABLE] … Speech-to-Text V2 is not configured`, exit 2.
  Requires owner-approved Speech API enablement (`enable_v3_ingestion`), a declared plan file (N ≥ 20, fixture
  hash/size/codec/language, provider/model/region, environment, concurrency) and the fixture. **≤ 45 s P95 is not
  claimed.** Task left open.

## T051 — migration 0009 rollout compatibility (FR-SI-01/05, C-01/C-02)

- Additive only: new nullable columns/tables, widened CHECKs, `IF NOT EXISTS`; `runMigrations` second pass is a no-op
  (SYNC-F01). Data written under 0001–0008 survives (SYNC-F01).
- Previous API revision on the new schema: a detached checkout of `origin/main` (`c940355`) with only 0009 added ran
  its own `packages/db`, `apps/api` and `apps/worker` integration suites: 393/394 passed; the single failure is
  main's hard-coded "last five migrations" assertion (generalized on this branch), not a runtime incompatibility.
- `MIGRATE_ON_START=true`: the advisory-locked runner applies 0009 once; failure rolls back that file and keeps the
  new revision unready (existing runner behaviour, unchanged).
- Rollout order/one instance: an old worker ignores `sync` jobs (it claims only `ingest`/`cleanup`) and would fail a
  linked-import `ingest` job (no uploaded object) — deploy the new worker before (or with) the API that admits
  linked imports; D16 single-API operation is unchanged.
- IaC (no apply): `tofu init -backend=false` + `tofu validate` pass for dev/staging/prod; `tofu fmt -check` clean;
  `infra/modules/storage_secrets` `tofu test` 4/4. New billable APIs (Speech, Drive, YouTube Data, Compute for the
  isolated render VPC) and Model Armor stay behind `enable_v3_ingestion` (default false) pending recorded owner
  approval; the render job is created only when `render_image` is set. **No deployment or apply was performed.**

## T052 — flow-back and re-analysis (2026-10-23)

Implementation refinements were written to `spec.md`, `plan.md`, `spec/requirements/v3/package_3_1_multimodal_ingestion_sync.md` and `docs/solution-architecture.md` (Package 3.1 paragraph); no SRS scope change, no new `Dn`/`DEV` and no C-01 change were needed. `spec/requirements/README.md` needed no change (v3 ordering unchanged; 3.2/3.3 start at migration 0010). `/speckit-analyze` re-run: 0 CRITICAL, coverage 24/24; stale "no implementation" wording (I1/I2) corrected; open items are C1 (T049/T050 live evidence), U1 (Drive watch-channel creation needs a verified public callback domain — deployment follow-up), U2 (YouTube delegated captions not implemented), R1 (reviewer checklist 0/37).

## T053 — quickstart and gate run (2026-10-23, HEAD after T052)

| Command | Result |
| :- | :- |
| `node scripts/check-spec-integrity.mjs` | PASS (188 Markdown files, 55 SRS IDs, 39 feature artifacts CC-01/CC-02) |
| `git diff --check origin/main` | PASS |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | PASS / PASS / PASS |
| `pnpm test:contract` | PASS 14 files / 238 tests |
| `pnpm test:unit` | PASS 21 files / 298 tests |
| `pnpm test:integration` | 98 files / 666 tests passed in every run. One run reported 2 unhandled `57P01 terminating connection due to administrator command` errors from the teardown (`DROP DATABASE … WITH (FORCE)`) of the pre-existing, unmodified `packages/db/test/workspace-preferences.pg.integration.test.ts` (exit 1); two immediate re-runs and three isolated runs of that file exited 0. Recorded as a pre-existing teardown flake, not claimed as fixed. |
| `pnpm eval:deterministic` | PASS (citation precision 160/160, leakage 0; Studio Gate v2.0 #3 deterministic PASS) |
| `pnpm test:e2e` | 50 passed, 1 skipped (pre-existing `test.fixme` GC-E04) |
| `pnpm eval:judged` | **UNAVAILABLE / not run** — release-candidate-only judged run with paid Vertex calls; not authorized here (T049 open) |
| `pnpm eval:v3-audio` | **UNAVAILABLE** (exit 2: Speech-to-Text V2 not configured; T050 open) |
| `tofu validate` (dev/staging/prod), `tofu fmt -check`, `storage_secrets` `tofu test` | PASS / PASS / 4 of 4 |
| Live Drive, Model Armor, LibreOffice job, YouTube | **UNAVAILABLE** (no approved API enablement, OAuth client or deployed render image) |

Unresolved runtime limits for the handoff: the v3 release gate (Gate v3.0) is not certified; the ≤ 45 s P95 ASR target, judged
NFR-EVAL-01/03, live delegated Drive, live Model Armor and the LibreOffice renderer have no runtime evidence; Drive watch
channels are not created (webhook endpoint ready); deployment requires owner approval of `enable_v3_ingestion`
(Speech, Drive, YouTube Data, Compute, Model Armor), a Model Armor template, an OAuth client + secret, and a render image.

## Convergence (Phase 8, T054–T056)

`/speckit-converge` found 3 partial gaps (F1 FR-011 Drive watch channels never created; F2 FR-002 authorized picker missing; F3 FR-005 video citations not seekable) and appended T054–T056.

| Task | Red observed | Green |
| :- | :- | :- |
| T054 | `ingestion-drive.test.ts` DRIVE-08: `expected [] to have a length of 1` | DRIVE-08/09 (9/9 file) |
| T055 | `office-import.test.ts` OFFICE-API-08: `expected undefined to be null` | OFFICE-API-08; `apps/web/test/drive-picker.spec.ts` PICKER-E01 (Google Picker/Identity scripts faked via network routes; app integration, server import, DB and worker real) |
| T056 | `video-player.test.ts` VIDEO-01 and `ingestion-media.test.ts` MEDIA-07: player was `link` | VIDEO-01/02, MEDIA-07; `media-citations.spec.ts` MEDIA-E04 (written after the API change; browser Red not separately observed) |

IaC: picker identifiers and `DRIVE_WEBHOOK_ADDRESS` are wired behind `enable_v3_ingestion` (validate passes).

Final gate run after convergence (2026-10-23): spec integrity, `git diff --check`, typecheck, lint, build, `pnpm test` (120 files / 969 tests), `pnpm eval:deterministic`, `pnpm test:e2e` (52 passed, 1 pre-existing fixme skipped) — all exit 0. A second `/speckit-converge` assessment found no further buildable gaps; only the environment-gated T049 (judged release run) and T050 (live ASR benchmark) remain open.
