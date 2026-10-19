# Quickstart: Package 2.2

Trace: `FR-SI-02`, `FR-GC-04`, `FR-GC-05`, `FR-GC-07`, `FR-GC-09`, `FR-NM-02`, `C-02`, `NFR-EVAL-02/04`, Gate v2.0 #1/#2.

## Prerequisites

- Worktree on `006-source-guide-chat-control`; Node.js 24 and pnpm 10; dependencies already installed.
- Use deterministic test fixtures and an injected fake structured-generation client. No cloud APIs, keys, or model endpoint are needed for unit tests.
- Production model P95/no-training/residency claims require an approved enterprise endpoint and deployment configuration; local fake-client timings are not production evidence.

## Focused validation

```sh
env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm exec vitest run packages/contracts/test/package-v2-2.test.ts packages/db/test/package-v2-2.test.ts apps/worker/test/package-v2-2.test.ts apps/worker/test/package-v2-2-context.test.ts apps/worker/test/package-v2-2-runtime.test.ts apps/api/test/package-v2-2.test.ts apps/web/test/source-guide.test.ts apps/web/test/source-list-loader.test.ts apps/web/test/saved-response-note.test.ts apps/web/test/package-v2-2.integration.test.ts
env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm typecheck
env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm lint
node scripts/check-spec-integrity.mjs
```

Expected: all focused tests pass; the worker runtime is built only from the canonical C-02 provider and fails closed without an injected model; invalid limits, empty scope, unsupported chunk IDs, stale revisions, authorization mismatches and duplicate note saves reject without publishing content.

## Acceptance scenarios

1. Feed a Ready 15-page fixture through the Guide pipeline with singleton C-02 scope; check 100–250 summary words, 5–10 topics ≤40 code points, all support IDs, exact 3-attempt/100 ms/200 ms transient retry behavior, no retry for permanent/invalid output, the deterministic local <10 s fake-client budget, and independent full-text access (`FR-SI-02`, Gate v2.0 #1).
2. Use sources A/B with disjoint facts; request overview for `[A,B]`, change selection to `[A]`, and verify old overview disappears before replacement and no B chunk/support ID is in the new result; the deterministic fake completes within the local 6 s budget (`FR-GC-04`, C-02, `NFR-EVAL-04`).
3. Complete a response with 3 supported follow-ups; verify hidden during stream, ≤1 second generation budget locally, clearing on scope change, and click dispatch and local ≤1 s completion (`FR-GC-05`).
4. Exercise default/preset/custom and response-length inputs at empty, 1, 5,000 and 5,001 trimmed Unicode code points; verify invalid config does not overwrite saved config or relax grounding (`FR-GC-07`, FR-GC-01/02).
5. Copy cited/uncited answers, submit up/down feedback with all categories and comment bounds, and save notes twice; assert identical note identity, citations preserved, user isolation, note independent of deleted chat history, local copy/feedback ≤200 ms and note display ≤300 ms (`FR-GC-09`, `FR-NM-02`).
6. End-to-end Gate #2 requires Package 2.3 FR-NM-03 conversion and a subsequent chat citation. Package 2.3 is outside this feature; run its integrated roundtrip before declaring Gate v2.0 passed (`FR-NM-03`, Gate v2.0 #2).

## Stop condition

Never claim cloud P95, LLM-judged quality, production durability, or Gate v2.0 completion from deterministic local tests alone. Keep upstream flow-back aligned and rerun analysis after any behavior/contract refinement (`CC-01`).
