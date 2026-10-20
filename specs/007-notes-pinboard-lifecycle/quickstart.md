# Quickstart: Notes & Pinboard Lifecycle

Trace: FR-NM-01, FR-NM-02, FR-NM-03, FR-NM-04, C-01, C-02, Gate v2.0 #2. Contracts: [interfaces.md](contracts/interfaces.md); entities: [data-model.md](data-model.md).

## Prerequisites

```sh
cd ../everlast-lm-worktrees/impl-007   # the 007 worktree
corepack enable && pnpm install --frozen-lockfile
export TEST_DATABASE_URL=postgres://everlast:everlast@127.0.0.1:54329/everlast   # PostgreSQL 16 + pgvector (pnpm db:test:up)
```

## Validation commands

```sh
pnpm typecheck
pnpm lint
node scripts/check-spec-integrity.mjs
git diff --check
pnpm vitest run packages/contracts/test/package-v2-3.test.ts \
  packages/db/test/notes.test.ts packages/db/test/notes-schema.test.ts packages/db/test/note-sources.integration.test.ts \
  apps/api/test/notes apps/worker/test/note-markdown.test.ts \
  apps/web/test/notes packages/evals/test/notes-roundtrip.eval.test.ts
env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm eval:deterministic
pnpm test:e2e apps/web/test/notes-roundtrip.spec.ts   # Gate v2.0 #2 in the browser (fixture model)
```

Without `TEST_DATABASE_URL` the PostgreSQL suites and Playwright report `UNAVAILABLE`. Live Note Assistant TTFT against Vertex AI and the LLM-judged evals (`NFR-EVAL-01/03`) are `UNAVAILABLE` until a deployed run exists.

## Scenarios proven end to end

1. **Manual note (FR-NM-01)**: create → title `Key Audit Findings`, body `## Risk 1\nMissing mTLS on port 8080` → close → listed → reopen shows the Markdown. Auto-save fires 500 ms after the last edit; close flushes first.
2. **Saved response survives clear chat (FR-NM-02)**: save → `DELETE /chat` → note and `[1]` citation to `Spec.pdf` remain; repeated save returns the same note.
3. **Gate v2.0 #2 round trip (FR-NM-03)**: chat answer citing `Raw_Data.pdf` ("TITAN-77") → Save to notes (shared route) → Convert to source → v1 source `Ready` (`note_markdown`) and checked in the Left Panel → next v1 chat turn with only that source answers `TITAN-77` with `[1]` pointing at the converted source, labelled `Note`.
4. **Limits (FR-NM-03, FR-WM-07)**: uploads and note-sources share one limit; 50/50 → `Source limit reached`, and two concurrent conversions at 49/50 create exactly one source; combined body exactly 500,000 words accepted, 500,001 rejected without slot use.
5. **Note Assistant (FR-NM-04)**: Summarize with notes only (repeating it reuses the note-source); Critique requires a comparison source; failed conversion makes zero model calls; the turn appears in `GET /chat` and Clear chat removes it.

## Expected outcomes

All listed Vitest files pass; `check-spec-integrity` prints ✓ for links, SRS IDs, and Spec Kit artifacts.
