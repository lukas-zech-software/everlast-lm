# Pre-V4 continuation — 2026-11-10

Traceability: Gate v3.0, CC-01/06/09, FR-GC-08, NFR-EVAL-01..04.

The user reactivated the full pre-V4 implementation/gate/test goal after the
usage-window reset. Initial remaining usage: 100% five-hour /44% weekly. The
10%-remaining checkpoint rule remains in effect; no reset credits are used.

## Baseline and package work

Worktree `/private/tmp/everlast-pre-v4-resume-20261110`, branch
`codex/pre-v4-resume-20261110`, starts from final checkpoint `4e18590`.
Fresh origin/main fetch still resolves to `5f44947`; no additional main merge
was necessary. Root/main checkout was not modified.

Existing Package 010 agent resumed in a NEW worktree from `4e18590` with the
matching feature pin and current Constitution2.1/CC-09 bootstrap. Scope remains
T062 optional typed parent recovery, T063 bounded authenticated application
collector and T052 live acceptance. No live model/sandbox execution is authorized
by this local implementation stage. Subsequent 011/012 work waits for its checkpoint.

Collector design: pure cohort orchestration through explicit transport and private
evidence ports, ordinary authenticated chat SSE, bounded private evidence reader.
Missing qualified serving/fixture/request evidence remains UNAVAILABLE. API code
must not import eval/test tooling; cross-package producer schemas belong in
production-safe shared contracts. No public telemetry bypass or invented zeroes.

## Roadmap governance review

Used the repository sync-github-project skill in dry-run mode. Result: zero field
updates and zero issue closures. No project/issue state was changed.

An isolated governance worktree refreshed the existing PR174 head from `7216179`
by merging current main, producing `3df9ac51b987a7d48151d01d6e226ae19bd8c579`.
The diff remains exactly four governance/audit files; no application changes.
Local four acceptance-rule tests, lint, typecheck, spec/link/diff checks passed;
policy graph0 with the branch's 293 exact unchanged approved baseline records.
This differs legitimately from the candidate's 186 records after interface repairs.

Pushed that fast-forward to the existing codex/pre-v4-finalization branch. No
PR comment, issue close, gate acceptance or deployment was performed.
Remote CI: run42779053234 /job129704387848; spec integrity42779053483 succeeded.
Both workflow runs completed successfully. Actual CI log counts: 447 unit/contract
tests, 815 integration tests passed with 12 skips, and 64 browser journeys passed
with one skip. SCALE-UI-01 passed in this CI environment; its older local failure
remains historical and its brittle setup should still be reviewed in 012. The
deterministic report remains GatePending; judged/live skips are not acceptance.

Known SCALE-UI-01 setup problem is actually in apps/web/test/chat-scale.spec.ts:
it expects Send enabled before entering a question. The 012 saved patch only
lists studio-scale.spec.ts, so do not assume it already fixes this test. Retain
readiness assertions and repair the actual setup under the owning 012 feature.

## Current dependency alert inventory (read-only)

GitHub reports three open moderate transitive alerts: #14 minimatch9.0.9
(GHSA-g3hv-75wg-m249; first patch11.0.1), #13 glob10.5.0
(GHSA-3g3m-2fjr-6pw4; first patch14.0.2), #2 uuid8.3.2
(GHSA-w5hq-g745-h8pq; first patch11.1.1). No dismissal or override applied.

The lockfile traces glob/minimatch through google-gax5.0.8→rimraf5.0.10.
No direct project glob/minimatch/rimraf uses were found in apps/packages/scripts;
installed google-gax JavaScript inspection found no rimraf call. This is scoped
caller triage, not a whole-program reachability proof or a security acceptance.
Preserve the earlier uuid v4 caller findings and review compatible upstream
remediation rather than applying blanket major overrides.

## PR174 merge authorization

All required checks were green, mergeStateStatus CLEAN and reviewDecision empty
on head3df9ac5. Normal merge API with expected-head SHA was attempted; automatic
approval review rejected it because final mutation of shared main lacked explicit
merge authorization. No merge occurred; no workaround/admin bypass was attempted.
The user explicitly approved merging PR174. Head/checks were revalidated unchanged
and green, then the normal merge succeeded at
1957b3aa99c8c7faeb085b7e48fb6f369ea49f1f. No review/admin bypass was used.
Origin/main was fetched afterward. Package010 receives that base update; the
coordinator will merge it after inheriting 010 to preserve linear package lineage.

## Collector review findings

Parent review identified the actual VisibleMessage projection has no public
request_id field. The collector must correlate through its initiated request,
fresh stream/execution identity and private evidence; a fixture inventing that
field would falsely test compatibility. Regression uses the actual public shape.

Additional cases: bind qualification and retained calibration, preserve known
SSE-error failures as failed observations, hard timeout despite unresponsive ports,
reject duplicate execution/attempt identities and trace/timing mismatch. Missing
private evidence remains UNAVAILABLE and stops further unqualified batches.

## Package 010 final local checkpoint

Final package commit `f2d82bafc4e054c3cb00faa9993ac9741e440d1e`, clean. T062 and T063 are implemented
locally; T064 trusted production producer and T052 live qualification remain open.
Actual checks: 35 collector/transport/CLI/evaluator tests, 23 API/DB regressions,
seven parent mock plans, four module policy tests, typecheck/lint/spec/diff pass.
Final strengthened bindings and bounded-transport checks were rerun as recorded
in the package handoff; no paid sandbox run occurred. Architecture graph/artifact
checks pass with 185 unchanged approved records; only the stale eval wildcard
record was removed with the actual export repair.

Parent inherited 010 and merged approved origin/main1957b3a at `b1c9df7e52d85b02463c3d3cfb8ebf9076bc7649`.
All agents are finished. User cutoff observed at 10% five-hour /30% weekly; no
011 dispatch or new implementation/check starts afterward. Final handoff:
`docs/pre-v4-implementation-handoff-2026-11-10.md` and its /private/tmp copy.
Goal remains incomplete; next is 011, then 012 and retained release obligations.
