# Package 3.4 usage-limit handoff (NFR-PERF-01, C-02/C-03)

## Resume context

- Worktree: `/Users/luke/Projects/claude/everlast/everlast-lm-worktrees/impl-012`.
- Branch: `codex/package-3-4-implementation`; base main `87f8762` includes 3.1–3.3.
- Checklist approval `fa987c0` is on this branch. Foundation commit: `3fd5306`.
- Ignored `.specify/feature.json` pins `specs/012-long-context-latency-scaling`.
- User authorized implementation, push and PR, but requires stopping as remaining usage
  approaches 10%. Stopped new implementation at 18%; latest verification check was 12%
  five-hour remaining, 86% weekly. Check current usage before resuming.
- No cloud deployment, API enablement or IAM mutation occurred. Continue in this exact
  worktree; do not create competing lineage. Read current instructions and task artifacts.

## Completed vs partial

`[012-long-context-latency-scaling] T001–T009` checked: predecessor/release checks,
internal scale contracts, fixture recipe, canonical source-page token ledger and
backpressured C-02 chunk iterator. Existing array consumers retain a compatibility
adapter. Read quickstart.md for Red/Green evidence. Tokenizer qualification remains
UNAVAILABLE; the fixture is a recipe, not measured million-token evidence.

`[012-long-context-latency-scaling] T010–T021` are partial and remain unchecked:

- `latency.ts` implements 20-warm / max-40-attempt nearest-rank aggregation with retained
  observations, explicit failure and null failure timing. Concurrency/restart report
  integration remains missing; T010/T015 are not complete.
- `v3-scale-client.ts` reads bounded ordinary SSE and times only a fresh non-computed
  factual final receipt. Refusal/replay/error/missing output never gets a successful time.
  No deployment manifest/orchestrator/CLI or browser regression yet.
- `observability/benchmark.ts` supplies a private synthetic-notebook allowlist, boot/revision
  readiness classification with clock uncertainty and dependency evidence. Dependencies
  start false; /readyz is not sufficient. Qualification is an internal port, not a user API.
- ChatService optionally takes the recorder, measuring ordinary buffered-chat stages and
  publication/replay/error without changing public SSE or recording source content.
  Server/config composition and private durable observation sink are NOT wired. Computed
  path and finer model/verifier stages still need coverage. Production has no recorder.

`[012-long-context-latency-scaling] T022–T050` remain unimplemented: broad Guide routing,
production cache, model envelope integration, Studio streaming/segments/recursive reduction,
full coverage/runtime stress, deployed benchmarks and final convergence/analysis.
Do not claim package completion, Gate v3 acceptance, or mark the draft PR ready.

## Verification

- Foundation regression: 22 suites / 291 tests PASS (contracts, new scale tests, existing
  retrieval, Studio persistence and evidence helpers).
- Full latest unit suite: 43 suites / 430 tests PASS.
- Latest targeted US1/chat regression: 5 suites / 29 tests PASS against real disposable
  local PostgreSQL and ordinary API/SSE, using scripted model test doubles.
- TypeScript build, `node scripts/lint.mjs`, spec integrity and whitespace PASS.
- Deterministic eval: 222 cases; citation precision 160/160, leakage 0. Additional 60
  adversarial drafts: zero published. Deterministic reports and Studio structure PASS.
  Aggregate release state GatePending: judged metrics and UI release evidence unavailable.
- No new browser tests, million-token/300-source runtime tests or deployed latency run.
- pnpm dependencies installed. Host Node 26.3.0, installed runtime 26.12.1, pnpm 12.
  Unrelated pnpm-lock normalization was restored. Four verifier JS/declaration outputs
  from an initial relative test import were removed; import now uses @everlast/api.

Commands from this worktree:

```sh
node node_modules/vitest/vitest.mjs run --project unit
TEST_DATABASE_URL=postgres://everlast:everlast@127.0.0.1:54329/everlast node node_modules/vitest/vitest.mjs run apps/api/test/chat-scale.test.ts apps/api/test/benchmark-readiness.test.ts apps/api/test/chat.test.ts packages/evals/test/latency.test.ts packages/evals/test/v3-scale-client.test.ts
TEST_DATABASE_URL=postgres://everlast:everlast@127.0.0.1:54329/everlast node packages/evals/src/cli.ts deterministic
node scripts/lint.mjs
git diff --check
```

This is the repository's disposable Docker DB, not production credentials. `pnpm db:test:up`
started/reused everlast-pg-test; suites create/drop isolated DBs. Ignored reports/ holds
local eval results. Initial evaluator call omitted TEST_DATABASE_URL and was UNAVAILABLE;
the corrected invocation passed the deterministic gates above.

## Next steps / review focus

1. Complete US1 Red tests T010–T014: two-Owner diagnostics, exact scoped vector calibration,
   browser receipt, cancellation, failed/stale publication, and all framing edge cases.
2. Complete T015–T020. Do not infer readiness from configured dependencies. Use a bounded,
   approval-bound private sink and actual prompt/history/cache leakage audits; boolean
   correctness fields require trustworthy producing code, not manifest assertions.
3. Review split CRLF/UTF-8 framing, duplicate/missing final messages, malformed runtime
   readiness dependency evidence, canonical-page tokenizer composition and snapshot freeze
   timing. Ledger metadata grows with chunk count; text paging is not total-memory proof.
4. Follow task order through Guides/cache and Studio; retain D12/D13/D17/D20. The older
   quickstart sandbox paragraph still mentions obsolete scratch/read-only rules; current
   upstream D20 governs and should be reflected during final flow-back.
5. Final speckit-analyze/converge and deployed release evidence are outstanding. Optional
   git hooks are disabled in git-config.yml; commits were explicitly authorized.
