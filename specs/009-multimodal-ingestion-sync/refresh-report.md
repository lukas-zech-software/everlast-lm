# Latest-main refresh: Package 3.1

Date: 2026-10-21. Scope: FR-SI-01 Subset B, FR-SI-05, supporting FR-SI-02/04, FR-NM-03, C-01/C-02, NFR-EVAL-01..04.

## Provenance and workflow (CC-01/06)

- Previous cumulative planning base: `e069add47b0df0040b413f90d11bb8d2c9f35059`. Latest fetched main: `0a94f3fca01395922fa788ea8cbb4286e8500f4a`. Integration merge: `6d3624a`. Main is an ancestor of this branch.
- Dedicated worktree: `/private/tmp/everlast-v3-refresh-3-1-20261021`; branch: `codex/v3-refresh-3-1-20261021`. First action created it. Second action exported the supplied target, wrote `feature_directory: specs/009-multimodal-ingestion-sync` in `.specify/feature.json`, then unset/asserted the environment variable. Subsequent setup resolves that pin; the setup script's BRANCH field describes the feature slug, while Git retains the branch above.
- Spec-first impact/ambiguity review preserved both accepted answers: reject overlapping sync with no follow-up; acceptance-to-transcript timing includes queue, excludes upload/indexing. No new product ambiguity requires an answer. Re-executed plan setup and Phase 0/1 research/design refresh. No tasks, implementation, provider enablement or deployment.
- Both upstream decision meanings survive the merge: main D15 canonical source text and D16/DEV-04 v2 PoC keep their identifiers. Colliding v3 branch-local references are disambiguated as D17/DEV-05 warm latency and D18 managed sandbox. This is collision reconciliation, with no deletion, reordering of meaning or altered acceptance; old and new mapping is recorded here. Mechanical reference updates in other v3 packages are the only cross-package artifact edits at this stage.
- Imported only package 3.1's custom checklist from `fcc694f8bb39a403a923e78ec45827390a4842b0`, without importing its pin. Existing 32 items preserved byte-for-byte and four latest-main quality questions appended.

## Changed assumptions and flow-back (FR-SI-01/05, C-01/C-02)

Current code already implements durable PostgreSQL ingestion jobs, quota fences, atomic canonical pages/chunks/embeddings, scoped hybrid retrieval and singleton Inspector. Updated plan/research/data model/contracts/quickstart to reuse those real files and preserve current upload response envelopes, C-01 revision and locators. Existing publication only admits Processing; re-sync needs a separate Ready-preserving fenced replacement, not a weakened guard.

Canonical viewer text follows D15 in PostgreSQL `source_pages`; raw/binary intermediates remain in GCS. Source Guide still uses the v2 API-process watcher and in-memory repositories: D16 requires its durable revision/language-keyed state and regeneration trigger for v3. Other v2 state migrations remain with the owning feature. Trusted note-source provenance/quota and distinct copied-text 100-point versus rename 200-point title limits are explicit. Spec/card and narrow architecture flow-back mirror these refinements.

Gate v2 is owner-approved override, with earlier failures and no post-fix live re-run documented in `docs/gate-v2-live-evaluation.md`. Refreshed Constitution 2.0.0 cadence: deterministic PR suites and once-per-release stratified 50-case judged run retaining sample IDs/composition/hash. No runtime evidence is inferred from the override.

## Review and validation (CC-01..08, NFR-EVAL-01..04)

- Pre/post-design CC-01..08: design PASS; exact evidence in plan. Reviewed own spec→plan→model→contracts→quickstart against latest main, including source lifecycles, publication, quotas, ACLs, historical citations and Guide revisions. `speckit-analyze` intentionally not invoked: tasks.md does not exist and is not generated for a planning refresh.
- Built-in specification quality: all 16 criteria re-evaluated and remain checked. Custom checklist: 36 unchecked, unique sequential CHK001–036; first 32 preserved, no reviewer evaluation claimed.
- `setup-plan.sh --json` and checklist prerequisites/template resolution: PASS. Extensions YAML parsed with Ruby Psych: only optional Git hooks for before/after plan/checklist; explicitly skipped automatic commits (all corresponding auto_commit flags false); reviewed explicit commits used instead.
- `node scripts/check-spec-integrity.mjs`: PASS (55 SRS IDs and 32 feature artifacts; tracked Markdown enumeration is repeated after commit). `git diff --check`: PASS.
- `node scripts/lint.mjs`: specification stage passed; compilation stage UNAVAILABLE because this fresh worktree has no installed TypeScript (`Cannot find module typescript/bin/tsc`). No implementation code changed. Unit/contract/integration/browser/runtime suites NOT RUN; no v3 adapter/runtime pass claimed. Shell Node is v26.3.0, whereas project target is Node24; configure the project runtime before implementation qualification.
- Speech/Drive/Model Armor deployment capability, 45-second ASR P95, full integrated v3 timestamp gate and live judged v3 qualification: UNAVAILABLE. Provider research is inherited and explicitly requires deployment-time requalification.

## Handoff (FR-SI-01/05, CC-06)

Next package must branch from this completed commit, initialize its own feature pin immediately, restore only its custom checklist and refresh its own semantics. Later implementation still needs test-first tasks, full task/spec analysis, qualified provider services and release evidence.
