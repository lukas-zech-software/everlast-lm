# Main Refresh Report: Package 3.2

Date: 2026-10-21. Scope: FR-GC-08, FR-GC-01/02/06, C-01/C-02, NFR-EVAL-01..04, NFR-SEC-01/02; Gate v3.0 #2.

## Baseline and workflow (CC-01, CC-06)

Created `/private/tmp/everlast-v3-refresh-3-2-20261021` on `codex/v3-refresh-3-2-20261021` from completed package 3.1 commit `bdb9f7a9bd8d1d100cd82136504aa2a569026bfe`. Latest main `0a94f3f` is already inherited through integration merge `6d3624a`; no duplicate merge or history rewrite. Immediately after creation, exported the supplied `SPECIFY_FEATURE_DIRECTORY=specs/010-code-execution-sandbox`, wrote that exact feature_directory value to `.specify/feature.json`, unset it and asserted absence. Subsequent setup uses the JSON pin.

Reviewed the current constitution 2.0.0, SRS, README, package FR card and architecture; reviewed the feature spec and re-executed speckit-plan Phase 0/1 using setup-plan.sh and the override template. Current main was compared with actual source contracts before updating design. No new high-impact product ambiguity requires clarification. Tasks are absent, so speckit-analyze is not run prematurely. No tasks, application code, deployment or cloud API enablement is included.

## Substantive refresh (FR-GC-08, C-02, NFR-EVAL-01..04)

- Replaced nonexistent planned chat agent/publication/transport and web turn/history boundaries with current service/model/draft/verifier/prompt, routes, app/server and web panel/types boundaries.
- Reconciled the real `/chat/turns` endpoint, required request_id, SSE phase serializer, strict draft schema and clarification-only outcome with publication/verification. Preserve factual citation refusal and current snapshot fences.
- Recorded all persistence projections (StoredMessage, VisibleMessage, strict shared schema, web types and v2 chat reader). Durable admission/cleanup is required; the AbortController Map does not establish exclusive admission and D16/DEV-04's v2 PoC does not waive sandbox durability.
- Reconciled whole-table quantitative evidence with current top-12 targeted retrieval: sufficient original data comes through the same captured C-02 snapshot or yields an honest insufficiency response, never fabricated completeness.
- Corrected obsolete readiness-placeholder claims: main has real dev orchestration and migrations. Those baseline commands do not provide sandbox execution or R6 qualification.
- Applied Constitution 2.0.0 eval cadence to SC-006 and design/quickstart: deterministic each PR; judged once per release candidate on the fixed stratified 50-case sample with IDs, composition and dataset hash.
- Preserved accepted statistical follow-up, ordered two-attempt traces, D18's 2 vCPU / 1.5 GB managed default, all retained R6 controls, and D15/D16 main decisions. Warm-service exception is D17/DEV-05; no decision ID renumbering.
- Flowed the same requirements/design refinements upstream into this package's FR card and a narrow architecture section. No unrelated package edited.

## Checklist and hooks (CC-01)

Restored only package 3.2's custom sandbox checklist from `96b078253951c06419c368041526fc867fd5edf1`. Its original 32 questions are preserved with mechanical collision-reference corrections (sandbox D16 → D18; warm-service D15 → D17). Appended CHK033–035 for main refresh review, yielding 35 unchecked reviewer-owned items. No custom review approval is implied. Revalidated the separate built-in requirements checklist: all 16 criteria satisfied at specification quality level, not runtime acceptance.

Parsed `.specify/extensions.yml` successfully. before_plan/after_plan and before_checklist/after_checklist register only optional `speckit.git.commit` hooks; announced and skipped automatic hooks. A separately authorized explicit package commit records the reviewed result. No mandatory hook was skipped. The checklist prerequisite/template setup completed.

## Verification and evidence limits (CC-01..CC-08)

- PASS: pre-research and post-design constitution checks for this documentation design.
- PASS: `node scripts/check-spec-integrity.mjs` (all relative links/anchors, 55 SRS IDs and 32 feature artifacts).
- PASS: `git diff --check`, exact feature pin/environment absence, ancestor check for main `0a94f3f`, original custom-item preservation, contiguous CHK001–035 all unchecked and 16 built-in quality checks.
- UNAVAILABLE: package-specific sandbox tests, selected-runtime isolation/resource/termination/latency evidence, R6 qualification and complete Gate v3 acceptance. Existing baseline Vitest/Playwright/eval runners exist but were not executed for this documentation-only refresh; no sandbox test pass is claimed. Empirical R6 remains required before application implementation/runtime admission. Gate v2 acceptance is required before v3 implementation.
