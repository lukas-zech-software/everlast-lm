# Quickstart: Notes & Pinboard Lifecycle

Trace: FR-NM-01, FR-NM-02, FR-NM-03, FR-NM-04, C-01, C-02, Gate v2.0 #2. Contracts: [interfaces.md](contracts/interfaces.md); entities: [data-model.md](data-model.md).

## Prerequisites

```sh
cd ../wt/007            # the 007 worktree (branch 007-notes-pinboard-lifecycle)
pnpm install --frozen-lockfile
```

## Validation commands

```sh
pnpm typecheck
pnpm lint
node scripts/check-spec-integrity.mjs
git diff --check
pnpm vitest run packages/contracts/test/package-v2-3.test.ts \
  packages/db/test/notes.test.ts packages/db/test/notes-schema.test.ts \
  apps/api/test/notes apps/worker/test/note-markdown.test.ts \
  apps/web/test/notes packages/evals/test/notes-roundtrip.eval.test.ts
```

Playwright E2E and LLM-judged evals (`NFR-EVAL-01/03`) are `UNAVAILABLE` for this package (no runnable UI page or live model endpoint is added); deterministic suites (`NFR-EVAL-02/04`) run in Vitest.

## Scenarios proven end to end

1. **Manual note (FR-NM-01)**: create → title `Key Audit Findings`, body `## Risk 1\nMissing mTLS on port 8080` → close → listed → reopen shows the Markdown. Auto-save fires 500 ms after the last edit; close flushes first.
2. **Saved response survives clear chat (FR-NM-02)**: save → `DELETE /chat` → note and `[1]` citation to `Spec.pdf` remain; repeated save returns the same note.
3. **Gate v2.0 #2 round trip (FR-NM-03)**: chat answer citing `Raw_Data.pdf` ("TITAN-77") → save as note → convert to source → source `Ready` and selected → next turn with only that source answers `TITAN-77` with `[1]` pointing at the converted source.
4. **Limits (FR-NM-03)**: 50/50 sources → `Source limit reached`; combined body exactly 500,000 words accepted, 500,001 rejected without slot use.
5. **Note Assistant (FR-NM-04)**: Summarize with notes only; Critique requires a comparison source; failed conversion makes zero model calls.

## Expected outcomes

All listed Vitest files pass; `check-spec-integrity` prints ✓ for links, SRS IDs, and Spec Kit artifacts.
