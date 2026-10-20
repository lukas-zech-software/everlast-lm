# Validation Log: Package 2.3 Notes & Pinboard Lifecycle

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
- **Verification at that time (worktree `v1-gate`, PostgreSQL 16 + pgvector):** `pnpm typecheck` clean; `pnpm lint` passed;
  Vitest 74 files / 578 tests passed; Playwright 33/33 (incl. `workspace-comfort.spec.ts` WC-E01..03); `pnpm eval:deterministic` Precision_ID 160/160, leakage 0. Gate v2.0 not run.
- **Package 2.3 specifics:** note sources use the converged Markdown ingestion path
  (`createNoteMarkdownIngestor`, same chunker) and count against the PostgreSQL source slots. The Note
  Assistant uses the v1 grounded model and citation verifier (`GroundedNoteAssistant`); it answers 503 without
  a model. *(Superseded 2026-10-20, see below: note-sources are v1 PostgreSQL sources and the pinboard UI is built.)*

## Phase 8 convergence (2026-10-20, T030–T057, worktree `impl-007`, branch `feat/v2-007-converge`)

**Owner decision 2026-10-20 (D16 amendment, SRS §5.5 DEV-04, §5.6):** note-sources are normal v1 PostgreSQL sources
(`media_type: note_markdown`, migration `packages/db/migrations/0004_note_sources.sql`); notes stay in memory (D16).

### Current state (replaces the "Not built" and "not visible to the v1 chat" notes above)

- **Note-sources (FR-NM-03, FR-WM-07, C-01, C-02):** conversion reserves the slot with the v1 `reserveSources` under the
  notebook lock (one limit for uploads, copied text and note-sources), runs the v1 Markdown ingestion at once
  (`apps/worker/src/ingestion/note-markdown.ts` → `processIngestJob`: sections, chunker, embeddings, atomic Ready) and
  stores provenance (origin notes with revisions, reuse key, copied citations) in `note_source_provenance`. Verified
  `[[n]]`/`[n]` markers are removed from the source text. Failures mark the source Failed (slot released) and answer
  502 with a fixed message. The in-memory note-source registry is removed. The Left Panel list, the v1 chat
  retrieval and verifier, the history projection (`source_media_type`) and the Source Inspector read note-sources
  like any upload.
- **Shared save-note contract (FR-NM-02, FR-GC-09):** one DTO in `packages/contracts/src/package-v2-3.ts`, re-exported by
  `package-v2-2.ts`; `POST /notes/from-message` is removed; `POST /api/notebooks/{id}/chat/messages/{message_id}/note`
  is the only save route.
- **Note Assistant (FR-NM-04):** reuses a Ready note-source of the same `(note_id, revision)` set (no slot, works at
  50/50); summarize/create_outline read only the note-source; related_ideas/critique add the selected sources;
  question and verified answer are one turn of the PostgreSQL chat thread (visible in `GET /chat`, removed by Clear
  chat, savable through the shared route); refusals are stored as refusals.
- **Sanitizing (FR-NM-01 FR-002):** every note repository write (`createNote`, `updateNote`, `saveResponseAsNote`,
  `convertToEditable`, Studio-created notes) stores sanitized Markdown.
- **Pinboard UI (FR-NM-01..04):** `apps/web/src/notes/panel.ts` in the Right Panel: + Add note, editor with Markdown
  toolbar, auto-save ≤ 1.0 s, flush on close, local draft recovery, delete with confirmation, saved-response viewer
  with Source Inspector badges, Convert to editable, Convert to source / selected / all (limit tooltip), the converting
  browser selects the new source, the 4-action bar with separate snapshot and synthesis phases, and `Note` labels on
  note-source citations and Left Panel rows. Save to notes in chat lands in the pinboard.
- **T029 caveats superseded:** the routes are mounted by the v2 runtime (not a `server.ts` stub); the pinboard and the
  Playwright round trip exist. The exact 200,000,000-byte boundary is still enforced (pre-check before reservation and
  the v1 pipeline) but not exercised by a 200 MB fixture; the 500,000/500,001-word boundary is tested end to end.

### Verification (PostgreSQL 16 + pgvector `everlast-pg-test`, `TEST_DATABASE_URL` set; Node 26 via pnpm)

| Command | Result |
| :--- | :--- |
| `pnpm lint` | ✓ all lint checks passed |
| `pnpm typecheck` | ✓ clean |
| `pnpm test:unit` | ✓ 20 files, 272 tests passed |
| `pnpm test:integration` | ✓ 62 files, 409 tests passed (incl. Studio 2.4 suites after T054/T055) |
| Focused Package 2.3 suites (quickstart command) | ✓ 16 files, 112 tests passed |
| `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm eval:deterministic` | ✓ Precision_ID 160/160 = 1.0, leakage 0; judged metrics UNAVAILABLE |
| `pnpm test:e2e` | ✓ 35 passed, 1 skipped (pre-existing `test.fixme` GC-E04 in `chat.spec.ts`) |
| Playwright `notes-roundtrip.spec.ts` (T037, NM-E01) | ✓ passed |
| `node scripts/check-spec-integrity.mjs` | ✓ links, 55 SRS IDs, 24 Spec Kit artifacts |
| `git diff --check` | ✓ clean |

- **Gate v2.0 #2:** passed — the browser round trip (chat answer → Save to notes → Convert to source → TITAN-77 cited
  from the converted note-source, labelled `Note`) and the API round trip (`notes-roundtrip.integration.test.ts`:
  provenance `(note_source_id, 1)`, zero retrieval of the decoy) pass.
- **FR-019 / SC-003:** a 5,000-word note becomes a Ready, citable source through the full route with the v1 ingestion
  in < 2.0 s (lexical test embedder; Vertex embedding latency is not measured here).
- **UNAVAILABLE until a deployed run exists:** live Note Assistant TTFT ≤ 2.5 s against Vertex AI `europe-west4`;
  LLM-judged gate evals (`NFR-EVAL-01`, `NFR-EVAL-03`, semantic citation support); the FR-GC-07 response-length
  metric.
