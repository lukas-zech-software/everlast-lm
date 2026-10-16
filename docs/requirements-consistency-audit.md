# Requirements consistency audit — 2026-10-16

## Scope and authority

Reviewed every file under `spec/requirements`: 19 package files containing 53 cards and
55 distinct SRS requirement IDs, plus the README and template. Reviewed each card's actors,
dependencies, EARS statements, inputs, state transitions, acceptance scenarios, edge cases,
metrics, scope exclusions and open questions against the constitution, SRS and architecture.
This is a source-requirements audit, not a generated-feature `/speckit-analyze` run: no
`specs/` feature spec, plan or task list exists yet.

The constitution is unchanged. Existing decisions D1–D10 and deviations DEV-01–03 are
preserved, including the prerequisite changes merged in PR #97. New architecture decisions
D11–D13 record the concrete resolutions for native Docs/Slides import, large-context evidence
coverage, and validation before answer publication. SRS §5.6 records the matching requirement
clarifications. No application behavior, release gate or cloud API is claimed to be implemented.

## Package review and corrections

All rows below include the [binding cross-package rules](../spec/requirements/README.md#binding-cross-package-rules)
and [within-release prerequisites](../spec/requirements/README.md#package-prerequisites).
“Reviewed” means the specification was checked and corrected, not that its runtime tests passed.

| Package | Requirement coverage | Review outcome |
| :- | :- | :- |
| [1.1](../spec/requirements/v1/package_1_1_workspace_foundation.md) | FR-WM-01, FR-WM-04, FR-WM-07 baseline | Reviewed: deterministic rename rejection; notebook/object/job deletion; decimal byte limit; atomic slot reservations and failed-upload release; baseline vs enterprise quota distinction; D5 deferral. |
| [1.2](../spec/requirements/v1/package_1_2_text_pdf_ingestion_inspector.md) | FR-SI-01 A, FR-SI-03, FR-SI-04 | Reviewed: one C-01 locator union; 300–600-token chunker target, not a schema constraint; explicit request scope, empty-scope API behavior, importing-session selection, responsive inspector behavior. |
| [1.3](../spec/requirements/v1/package_1_3_grounded_chat_citation_engine.md) | FR-GC-01, FR-GC-02, FR-GC-03, FR-GC-06 | Reviewed: full history provenance rather than citations alone; immediate refusal on invalid citations; validation before publication; consistent badge metadata; semantic support separate from ID validity; role-aware historical citations; one private thread per user. |
| [1.4](../spec/requirements/v1/package_1_4_ui_skeleton_quality_gates.md) | FR-UI-01, NFR-SEC-01, NFR-EVAL-01–04 | Reviewed: no-training requirement separated from unsupported zero-retention claim; deterministic vs judged suite cadence; eval success does not alone pass the full release gate; non-empty remaining scope in leakage scenario. |
| [2.1](../spec/requirements/v2/package_2_1_workspace_ui_comfort.md) | FR-WM-02, FR-WM-03, FR-UI-02 | Reviewed: emoji grapheme support without a contradictory 16-byte cap; per-user last-opened sorting; input/output language precedence and permissions; sorting benchmark covers enterprise notebook count; accurate gate attribution. |
| [2.2](../spec/requirements/v2/package_2_2_proactive_context_intelligence_chat_control.md) | FR-SI-02, FR-GC-04, FR-GC-05, FR-GC-07, FR-GC-09 | Reviewed: singleton Source Guide access through C-02; scoped/revision-aware overview caches; no stale follow-ups; small-source exceptions; 5,000-character persona maximum and Analyst preset; personal configuration; copy with/without citations; idempotent save-note action. |
| [2.3](../spec/requirements/v2/package_2_3_notes_pinboard_lifecycle.md) | FR-NM-01–04 | Reviewed: honest unsaved-draft handling; saved-note citation independence from cleared chats; editable-copy provenance; one bounded source per combined conversion; roundtrip tests the exact saved response; disclosed note-source conversion keeps direct AI note actions on the C-01/C-02 path. |
| [2.4](../spec/requirements/v2/package_2_4_studio_text_synthesis_reports.md) | FR-ST-10, FR-ST-11 | Reviewed: snapshot and authorization rules for C-03; stale revision cannot publish a report; custom-prompt minimum aligned to one non-whitespace character. |
| [3.1](../spec/requirements/v3/package_3_1_multimodal_ingestion_sync.md) | FR-SI-01 B, FR-SI-05 | Reviewed: delegated Docs/Slides import in assigned release (D11); preserve speaker notes; canonical locators/states; prompt-injection screening before indexing; SSRF exceptions do not bypass forbidden destinations; remove unrecorded headless-browser fallback; atomic revision swap and stale-citation behavior. |
| [3.2](../spec/requirements/v3/package_3_2_code_execution_sandbox.md) | FR-GC-08 | Reviewed: progress events do not count as answer TTFT; selected managed sandbox rather than unspecified interchangeable runtimes; retain isolation/resource limits and R6 verification; remove unsupported raw CSV upload example. |
| [3.3](../spec/requirements/v3/package_3_3_studio_structure_data_extraction_mindmaps_tables.md) | FR-ST-08, FR-ST-09, FR-ST-18 | Reviewed: reject invalid graphs; drilldown never restores deselected sources or injects their labels; shared citation/export/role rules apply to tables and visual artifacts. |
| [3.4](../spec/requirements/v3/package_3_4_long_context_latency_scaling.md) | NFR-PERF-01 | Reviewed: original-chunk map-reduce instead of summary-only evidence (D12); measure at least one million active tokens excluding decoys; validated-answer TTFT; no invented v6 federated-search commitment. |
| [4.1](../spec/requirements/v4/package_4_1_studio_active_learning_suite.md) | FR-ST-12–15 | Reviewed: composite lesson depends on 4.2 infographics and per-user progress; required block failures cannot become Completed; optional hint state; reset affects only the user's artifact progress; no invented LMS release. |
| [4.2](../spec/requirements/v4/package_4_2_studio_visuals_presentations.md) | FR-ST-16, FR-ST-17 | Reviewed: existing D8 PPTX/PDF and D9 deterministic SVG choices retained; common role, evidence, snapshot, citation and generated-media rules apply. No additional format or renderer introduced. |
| [5.1](../spec/requirements/v5/package_5_1_studio_dialogic_audio_overviews_live_voice.md) | FR-ST-01–04 | Reviewed: D7 single-host voice retained; exact interrupt timestamp; cited/validated live replies; consistent duration brackets; player dependency; D10 link sharing remains v6. |
| [5.2](../spec/requirements/v5/package_5_2_studio_video_overviews.md) | FR-ST-05–07 | Reviewed: validate both video renditions; unsupported playback handled explicitly; generated-media labels and evidence; a failed Cinematic job is not silently replaced with a slideshow. |
| [6.1](../spec/requirements/v6/package_6_1_enterprise_governance_sharing_analytics.md) | FR-WM-05, FR-WM-06, FR-WM-07 enterprise, NFR-SEC-02; FR-ST-04 delivery | Reviewed: Owner-only share management; answer-bound Chat-Only previews; upstream ACLs on imported/derived content; private chat preserved; UTC analytics fixture includes owner activity correctly; 500-notebook maximum; atomic daily quotas; SAML vs OIDC validation; D10 link delivery. |
| [6.2](../spec/requirements/v6/package_6_2_autonomous_research_agents_discover_deep_research.md) | FR-SI-06, FR-SI-07 | Reviewed: explicit research approval and external labels; screened candidates; C-02 reads; primary sources reach Ready before report synthesis; reserve report-source slot; artifact plus source output; deterministic cancellation/failure handling. |
| [6.3](../spec/requirements/v6/package_6_3_ecosystem_integration_notebook_mention.md) | FR-INT-01 | Reviewed as retained future requirements only: unscheduled under D5/DEV-03, Gate v6 #3 inactive; no new feature spec, MCP gateway or A2A implementation commitment. |

The README/template now distinguish target acceptance choices from unverified reference
observations. Example cards no longer contradict the real source-selection and Chat-Only
rules. Existing external links were not re-scraped: this audit establishes internal
consistency, not current feature parity with Google's product.

## Verification evidence

- `node scripts/check-spec-integrity.mjs`: relative links/anchors resolve and all 55 SRS
  requirements link to a card. Its implementation was inspected: this checks links and
  coverage, not semantic consistency.
- Separate inventory check: 19 packages, 53 cards, exactly 55 distinct defined IDs; no missing
  or unknown card IDs; every card retains the required sections; Markdown table delimiters
  are consistent. Intentional split requirements are FR-SI-01 and FR-WM-07.
- Manual cross-package review covers all rows above, C-01/C-02/C-03, every release gate,
  D1–D13 and DEV-01–03. The audit adds 16 targeted Gherkin scenarios and removes the invalid
  citation-regeneration scenario: 96 scenarios remain in the package files.
- `git diff --check`: no whitespace errors after corrections.
- No application lint, type-check, unit, contract or deterministic/LLM eval commands exist
  in `package.json`; those checks are unavailable, not passed. Measured runtime performance,
  model availability, sandbox feasibility and reference screenshots remain implementation/
  evidence work, not claims made by this audit.

## Handoff

Owner: this requirements-audit session. Branch: `fix/requirements-consistency-audit`.
Worktree: `/private/tmp/everlast-requirements-audit`. Integrated baseline: `9d95e8e`.
Scope: `spec/requirements/**`, matching SRS/architecture text, this report and derived root
README status. No feature task IDs exist yet. No changes to constitution, managed Spec Kit
files, application code, cloud resources or external issue bodies.

Next valid stage: `/speckit-specify` for the first assigned active package (normally 1.1),
then the repository's ordered clarify/plan/tasks/analyze workflow. Plans must consume the
corrected cards and shared rules; no implementation or later-release gate is pre-approved.
