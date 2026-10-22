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
