# Tasks: UI Skeleton & Quality Gates

**Input**: [spec](spec.md), [plan](plan.md), [research](research.md), [data model](data-model.md), [interfaces](contracts/interfaces.md), [quickstart](quickstart.md), [checklist](checklists/ui-eval-security-gates.md).
**Package Source**: `spec/requirements/v1/package_1_4_ui_skeleton_quality_gates.md` + [binding cross-package rules](../../spec/requirements/README.md).
**SRS IDs in scope**: FR-UI-01, NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01, C-01, C-02, Gate v1.0.
**Branch / worktree**: `spec/v1-functional-requirements` (`update_mvp_spec_workflows`). Baseline: `25d3127` (`origin/spec/v1-functional-requirements` plus clarified `spec.md` `47c4e90`, updated `plan.md` `cf2e17e`, checklist `5c3c5ef`, and reconciled 1.1–1.3 tasks `54e6b60`/`9f75352`/`25d3127`).
**Prerequisites**: Plan CC-01..CC-08 passes at design level; all spec clarifications (`2026-10-17` session) resolved. `/speckit-analyze` must run before implementation. 1.1–1.3 provide real notebook, source, inspector and chat features (`D14` OpenTofu stack in `infra/stacks/v1_foundation/`); UI shell and test datasets can be prepared early, but full Gate v1.0 requires the integrated runnable application.

Tests are mandatory (constitution II/CC-02), overriding optional-test skill wording. All tasks are open/unexecuted. Every behavior task waits for its named tests to fail for the expected requirement-related reason. Setup/import/configuration failure is not Red. Shared schemas, migration ordering, manifests, entrypoints and CI require one owner. This session claims documentation only; no runtime code or cloud resources are edited now.

Task IDs are qualified as `specs/004-ui-skeleton-quality-gates Tnnn` in handoffs. [P] means disjoint files only after dependencies pass and fixtures/output ownership is assigned. Required adapters for package-owned behavior must be available. Assertions against later downstream consumers are handed off and tracked in the final integration task; they do not create a circular prerequisite on upstream implementation.

## Phase 1: Setup and shared prerequisite contracts

- [ ] T001 Confirm shared contracts and upstream implementation prerequisites from `specs/004-ui-skeleton-quality-gates/plan.md`; record ownership/base/allowed files and external dependencies in `specs/004-ui-skeleton-quality-gates/implementation-handoff.md` and shared issue/PR (C-01, C-02, Gate v1.0). Do not recreate 1.1 schemas, manifests or infra; reconcile newer accepted contracts/governance and rerun analyze before dependent changes. **Depends on:** approved analyze and assigned ownership.

- [ ] T002 Reuse foundation scripts and pin compatible package dependencies in `package.json`, `pnpm-lock.yaml` and package manifests; preserve existing OpenTofu scripts/workflow (Gate v1.0). Allocate isolated test DB/bucket/ports; configure only test harness and importable interface stubs, no behavior. Missing upstream app/harness is a blocker, not a passing test. **Depends on:** T001.

- [ ] T003 Write and run failing package DTO/state and integration-boundary tests in `packages/contracts/test/package-v1-4.test.ts` (C-01, C-02): validate every entity field/input constraint in `specs/004-ui-skeleton-quality-gates/data-model.md`, exact state/error enums, ownership, immutable revisions, no extra C-01 fields, and explicit nonempty scope. Capture assertion-related Red, not missing-import/configuration errors. **Depends on:** T002.

- [ ] T004 Implement package-specific DTOs in `packages/contracts/src/package-v1-4.ts` and shared exports in `packages/contracts/src/index.ts` (C-01, C-02); pass T003. Import shared schemas from 1.1 rather than redefining C-01/C-02; serialize index/manifest edits with their owner. **Depends on:** T003.


## Phase 2: User Story 1 - Use adaptive workspace (Priority: P1)

**Independent Test**: Run US1 acceptance, boundary and integration files against isolated fixtures; assert every case in its annex and CP1–CP7, with actual consumers required for end-to-end success.

### Tests (mandatory Red before implementation)

- [ ] T005 [US1] Write and run failing acceptance tests in `apps/web/test/workspace-layout.spec.ts` (FR-UI-01) for every original Gherkin scenario and EARS statement in Annex US1; preserve exact messages, fixtures and state transitions. Record each original scenario title and Red result. An external consumer may use contract fixtures now, but real integrated assertions remain open until that consumer exists. **Depends on:** T004.

- [ ] T006 [P] [US1] Write and run failing boundary/error tests in `apps/web/test/workspace-layout.boundaries.spec.ts` (FR-UI-01) covering every input row and edge/error case in Annex US1; explicitly test widths 1023/1024/1279/1280 px, reload with saved preferences, inspector navigation from collapsed Sources and narrow-screen tabs; test each inclusive limit at min-1/min/max/max+1 where applicable, Unicode after trim, malformed input, authorization, cancellation and duplicate/out-of-order callbacks. No truncation, source fallback, stale publication or silent partial success. **Depends on:** T004.

- [ ] T007 [P] [US1] Write and run failing integration/timing tests in `apps/web/test/workspace-layout.integration.spec.ts` (FR-UI-01, C-02, NFR-EVAL-04) for every measurable criterion in Annex US1 and cross-package cases CP1–CP7. Record fixture sizes, sample counts, versions, region and cold/warm conditions. Never count progress as answer TTFT or substitute a stub for real cloud/model acceptance. **Depends on:** T004.

### Implementation (Green → Refactor)

- [ ] T008 [US1] Compose existing modules with exact viewport defaults/tabs, persisted independent collapse, inspector expansion, placeholder and no chat draft/scroll loss. Domain implementation in `apps/web/src/workspace-layout.ts` (FR-UI-01); pass T005/T006/T007 applicable domain assertions before refactoring; preserve exact Annex US1 behavior and source precedence. **Depends on:** T005, T006, T007.

- [ ] T009 [US1] Integrate localStorage panel preferences and existing feature modules in `apps/web/src/workspace-state.ts` and `apps/web/src/main.ts` (FR-UI-01, C-02). Preserve draft, scroll and selection across breakpoint changes; citation navigation expands the inspector without changing chat scope. Pass remaining T005/T006 interface/state cases and connect T007 real adapters without bypassing upstream authorization. **Depends on:** T008.

- [ ] T010 [US1] Implement presentation/integration adapter in `apps/web/src/workspace.css` (FR-UI-01) per `contracts/interfaces.md`; preserve state, exact messages, safe authorized data rendering and all Annex US1 interactions. Pass T005/T006 presentation assertions, then real T007 integration. **Depends on:** T009.

- [ ] T011 [US1] Run Green then behavior-preserving refactor for `apps/web/test/workspace-layout.spec.ts`, `apps/web/test/workspace-layout.boundaries.spec.ts`, `apps/web/test/workspace-layout.integration.spec.ts`; append actual commands/case IDs and Red/Green evidence to `specs/004-ui-skeleton-quality-gates/validation.md` (FR-UI-01). This checkpoint covers package-owned assertions only; hand off later-consumer assertions to the final integration task. Required cloud adapters for owned behavior cannot be replaced by mocks. **Depends on:** T010.


## Phase 3: User Story 2 - Enforce evaluation and security gates (Priority: P1)

**Independent Test**: Run US2 acceptance, boundary and integration files against isolated fixtures; assert every case in its annex and CP1–CP7, with actual consumers required for end-to-end success.

### Tests (mandatory Red before implementation)

- [ ] T012 [US2] Write and run failing acceptance tests in `packages/evals/test/release-v1.test.ts` (NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01) for every original Gherkin scenario and EARS statement in Annex US2; preserve exact messages, fixtures and state transitions. Record each original scenario title and Red result. An external consumer may use contract fixtures now, but real integrated assertions remain open until that consumer exists. **Depends on:** T011.

- [ ] T013 [P] [US2] Write and run failing boundary/error tests in `packages/evals/test/release-v1.boundaries.test.ts` (NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01) covering every input row and edge/error case in Annex US2; explicitly check 99/100 unanswerable, 49/50 deselection and synthesis counts, hallucination 0.049/0.05/0.051, precision 0.99/1.0, rejection 0.98/0.99/1.0, leakage 0/1, zero denominators and missing/invalid judge results; test each inclusive limit at min-1/min/max/max+1 where applicable, Unicode after trim, malformed input, authorization, cancellation and duplicate/out-of-order callbacks. No truncation, source fallback, stale publication or silent partial success. **Depends on:** T011.

- [ ] T014 [P] [US2] Write and run failing integration/timing tests in `packages/evals/test/release-v1.integration.test.ts` (NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01, C-02, NFR-EVAL-04) for every measurable criterion in Annex US2 and cross-package cases CP1–CP7. Record fixture sizes, sample counts, versions, region and cold/warm conditions. Never count progress as answer TTFT or substitute a stub for real cloud/model acceptance. **Depends on:** T011.

### Implementation (Green → Refactor)

- [ ] T015 [US2] Implement versioned golden dataset validation, deterministic IDs/leakage, independent semantic/hallucination/rejection judging, no-training preflight and fail-closed complete release reporting. Domain implementation in `packages/evals/src/runner.ts` (NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01); pass T012/T013/T014 applicable domain assertions before refactoring; preserve exact Annex US2 behavior and source precedence. **Depends on:** T012, T013, T014.

- [ ] T016 [US2] Implement storage/service and API integration in `packages/evals/src/metrics.ts` and `packages/evals/src/report.ts` (NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01, C-02). Use integrated feature contracts; keep deterministic and judged checks distinct. Gate/report states fail closed on missing suites, invalid judge output or failed cases; no partial release promotion. Pass remaining T012/T013 interface/state cases and connect T014 real adapters without bypassing upstream authorization. **Depends on:** T015.

- [ ] T017 [US2] Implement enterprise endpoint and no-training configuration checks in `packages/evals/src/security-preflight.ts` (NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01) per `contracts/interfaces.md`; preserve state, exact messages, safe authorized data rendering and all Annex US2 interactions. Pass T012/T013 presentation assertions, then real T014 integration. Create versioned synthetic datasets in `packages/evals/fixtures/v1/golden.jsonl` (>=100 unanswerable, >=50 deselected/history, >=50 multi-document cases); record dataset/prompt/model hashes and implement `eval-report-v1.json` output with exact failing IDs. Use the threshold-boundary/missing-case Red evidence from T013 before implementing metrics. **Depends on:** T016.

- [ ] T018 [US2] Run Green then behavior-preserving refactor for `packages/evals/test/release-v1.test.ts`, `packages/evals/test/release-v1.boundaries.test.ts`, `packages/evals/test/release-v1.integration.test.ts`; append actual commands/case IDs and Red/Green evidence to `specs/004-ui-skeleton-quality-gates/validation.md` (NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01). This checkpoint covers package-owned assertions only; hand off later-consumer assertions to the final integration task. Required cloud adapters for owned behavior cannot be replaced by mocks. **Depends on:** T017.


## Phase 4: Polish and integrated verification

- [ ] T019 Execute whole-package regression and inherited integration assertions in `specs/004-ui-skeleton-quality-gates/quickstart.md` and `packages/evals/test/package-v1-4.test.ts` (Gate v1.0, NFR-EVAL-02, NFR-EVAL-04). Use real downstream clients when available; no cyclic prerequisite prevents handing off verified upstream interfaces, but deferred integration cases remain unchecked. **Depends on:** T018.

- [ ] T020 Integrate package checks into `.github/workflows/ci.yml` and `package.json` under serialized shared ownership (Gate v1.0, NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04). Run lint/type/unit/contract/deterministic every PR; judged suites on retrieval/prompt/chat and every release gate. Preserve `.github/workflows/opentofu.yml`; never turn unavailable tests into successful skips. **Depends on:** T018.

- [ ] T021 Run documentation integrity, all available quickstart gates and final diff review; update `specs/004-ui-skeleton-quality-gates/implementation-handoff.md`, `validation.md` and canonical `tasks.md` only with verified outcomes (Gate v1.0). Record commits, ownership, open external dependencies and UNAVAILABLE checks; full v1 gate requires integrated upload/schema, four eval metrics and citation navigation. **Depends on:** T019, T020.

## Dependencies, parallel examples and delivery

Setup/shared-contract Red precedes schema implementation; story phases follow their documented order, with acceptance/boundary/integration Red before domain, service/API, presentation and Green verification. Within each story its [P] boundary and integration tests may run concurrently after the previous checkpoint, because filenames differ; allocate separate DB/bucket/output fixtures. Never run their implementation before Red evidence is transferred. Shared schema/index/manifest edits are serialized.

The first story plus prerequisites is the first independently demonstrable increment, not a substitute for the remaining package or complete MVP. Source parsing precedes selection/inspection; reasoning precedes citation publication/verification/history integration; UI shells may precede the full evaluation runner. External package integration does not block handoff of verified foundation interfaces, but its assertions remain open. Full release awaits all three Gate v1.0 outcomes.

## Cross-package acceptance (C-02, FR-WM-04, NFR-EVAL-04)

- CP1: Missing/empty scope rejects, non-Ready/cross-notebook IDs reject entirely; no server All Ready fallback. Test 401/403/404/empty-scope/stale errors explicitly.
- CP2: Checkbox changes affect only subsequent requests; deleted/replaced/revoked captured revisions fail before reads and publication, never substitute new content.
- CP3: Complete provenance controls history/cache eligibility, including uncited/tool/summary content; exclude both question/answer if any dependency is outside scope; missing provenance excludes.
- CP4: Deselected but authorized historical content can remain visible; deleted/revoked content and cached snippets/search/export copies cannot. Inspector singleton reads never mutate chat selection.
- CP5: Invalid or missing factual citation causes immediate refusal before publishing any factual draft; no stripped-citation answer or silent regeneration. Progress does not count toward TTFT.
- CP6: Atomic slots precede upload; Uploading/Processing/Ready consume, Failed releases once; 200 MB=200000000 bytes and 500000 words independently inclusive. Late callbacks/deletion and retries cannot recreate content.
- CP7: Owner-only v1, enterprise no-training for LLM/OCR/embeddings, EU-default verified configuration; no zero-retention inference. Preserve later-release exclusions and shared schemas.

## Acceptance coverage annex

Each annex transcribes the binding source blocks to make test tasks self-contained. Initial All Ready defaults, future-role mentions and historical visibility are qualified by CP1–CP7. Symbolic chunk IDs become schema-valid fixtures. Technical requirements are bound to their source IDs, not newly invented implementation behavior.

### US1: FR-UI-01 — Adaptive 3-Column Workspace Layout

**Trace**: FR-UI-01. EARS/Gherkin → T005; inputs/errors → T006; measurements/integration → T007; implementation → T008, T009, T010.

**EARS**

- *Ubiquitous:* The web application shall render the notebook workspace as a reactive Single-Page Application (SPA) divided into a top navigation header and three distinct functional panels:
  1. **Left Panel (Sources):** Source list, `"Select all"` and per-source checkboxes, `"+ Add source"` button, and the collapsible Source Inspector (`FR-SI-04`).
  2. **Center Panel (Chat):** Scrollable conversation stream, inline citation badges, and bottom prompt input bar displaying the active source count (`"<n> sources"`).
  3. **Right Panel (Studio & Notes):** Collapsible container reserved for Notes and Studio artifacts (rendered as an empty/placeholder panel in `v1.0` and populated starting in `v2.0`).
- *Event:* When the user clicks the collapse/expand toggle icon on the Left Panel or Right Panel header, the system shall collapse that panel into a narrow rail and expand the Center Chat Panel smoothly without losing scroll position or input state.
- *State:* While the Source Inspector (`FR-SI-04`) is open in the Left Panel, the system shall widen the Left Panel so that the source document and the Center Chat Panel can be read side-by-side.

**Original Gherkin scenarios**

```gherkin
Scenario: Workspace renders all three panels and active source counter
  Given a notebook with 3 Ready sources all selected
  When the user opens the notebook on a 1440x900 desktop viewport
  Then the Left Panel ("Sources"), Center Panel ("Chat"), and Right Panel ("Studio") are visible simultaneously
  And the Chat input bar displays "3 sources"

Scenario: Collapsing side panels preserves chat draft and scroll position
  Given the user has typed "Summarize section 2" into the chat input without sending
  When the user collapses the Left Panel and the Right Panel
  Then the Center Chat Panel expands to fill the available horizontal width
  And the chat input still contains "Summarize section 2"
```

**Exact inputs and limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Viewport width | Pixels | Desktop $\ge 1280\text{ px}$ (3 columns side-by-side, both side panels expanded); Laptop $1024\text{–}1279\text{ px}$ (3 columns, Right Panel collapsed by default); Tablet/Mobile $< 1024\text{ px}$ (tabbed) | Desktop 3-column open |
| Panel collapse toggle | Click event | Left panel and Right panel independently collapsible | Both expanded on desktop |

**Edge and error cases**

- Clicking citation `[1]` while the Left Panel is collapsed $\rightarrow$ Automatically un-collapses the Left Panel, opens the Source Inspector, and scrolls to chunk `[1]`.

**Measurable criteria**

- Panel expand/collapse layout transition completes in $\le 200\text{ ms}$ at $60\text{ fps}$ with zero layout shift data loss.


### US2: NFR-EVAL-01..04 & NFR-SEC-01 — Automated Evaluation & Security Gate Suite

**Trace**: NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01. EARS/Gherkin → T012; inputs/errors → T013; measurements/integration → T014; implementation → T015, T016, T017.

**EARS**

- *Ubiquitous (`NFR-SEC-01`):* The system shall configure all LLM, OCR, and embedding model calls with enterprise no-training policies so that uploaded documents, prompts, and outputs are never used to train foundation models.
- *Event (`NFR-EVAL-01` — Grounding Faithfulness):* When the CI/CD pipeline executes the Grounding Evaluation Suite against a golden dataset of $(S_{\text{aktiv}}, Q, A)$ triples, the automated NLI / LLM-as-a-Judge verifier shall verify that the hallucination rate $\epsilon_{\text{hallucination}}$ is strictly $< 0.05$ ($5\%$).
- *Event (`NFR-EVAL-02` — Citation Precision):* When the CI/CD pipeline evaluates generated citations, the system shall verify that $100\%$ of inline citation badges reference a real `chunk_id` in $S_{\text{aktiv}}$ ($\text{Precision}_{\text{ID}} = 1.0$); a separate LLM-judged semantic-support suite shall check that the chunk entails the claim. Deterministic ID validation does not require a model judge.
- *Event (`NFR-EVAL-03` — Negative Rejection):* When the CI/CD pipeline runs unanswerable world-knowledge queries against unrelated active sources, the system shall refuse to answer from world knowledge in $\ge 99\%$ of test cases.
- *Event (`NFR-EVAL-04` — Strict Context Scoping):* When the CI/CD pipeline runs queries while specific sources are deselected ($s_i \notin S_{\text{aktiv}}$), the system shall verify that zero chunks from $s_i$ appear in the retrieval log, LLM prompt, or response ($\text{Leakage} = 0$).

**Original Gherkin scenarios**

```gherkin
Scenario: Release Gate v1.0 passes all four evaluation metrics
  Given the v1.0 application and the golden evaluation dataset
  When the automated evaluation runner executes NFR-EVAL-01 through NFR-EVAL-04
  Then hallucination rate is < 0.05
  And citation ID precision is 1.0
  And negative rejection rate on out-of-scope world knowledge is >= 0.99
  And chunk leakage from deselected sources is 0
  And the evaluation portion of Gate(v1.0) passes
  And the full gate remains pending until upload/schema and citation-navigation checks also pass

Scenario: Deselected source does not leak via conversation history
  Given Sources A and B are selected and only Source B states "Project Aurora budget is $4.2M"
  And the user asked "What is the Project Aurora budget?" and received an answer citing Source B
  When the user deselects Source B and leaves Source A selected
  And asks "Repeat the Project Aurora budget"
  Then neither the prompt context nor the response contains "$4.2M"
  And the answer states that the selected sources do not mention Project Aurora
```

**Exact inputs and limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Golden Eval Benchmark | JSONL dataset | $\ge 100$ unanswerable world-knowledge cases (`NFR-EVAL-03`), $\ge 50$ deselected-source cases incl. history carry-over (`NFR-EVAL-04`), $\ge 50$ multi-document synthesis cases (`NFR-EVAL-01`, `02`) | Versioned golden dataset for v1.0 |
| $\epsilon_{\text{hallucination}}$ | Float | $< 0.05$ | Target $\le 0.02$ |
| $\text{Precision}_{\text{ID}}$ | Float | $= 1.00$ | $1.00$ |
| Negative Rejection Rate | Float | $\ge 0.99$ | $1.00$ |
| Scoping Leakage | Integer | $= 0\text{ chunks}$ | $0$ |

**Edge and error cases**

- Any single metric falls below threshold (e.g., $\text{Precision}_{\text{ID}} = 0.99$) $\rightarrow$ Gate fails with non-zero exit code and logs the exact failing test case IDs.

**Measurable criteria**

- $\epsilon_{\text{hallucination}} < 0.05$, $\text{Precision}_{\text{ID}} = 1.0$, $\text{Rejection} \ge 0.99$, $\text{Leakage} = 0$ (`SRS §4.2` & `§5.4 Gate v1.0`).

## Completion boundary

Generation validates task format, ordering and transcription only. No behavior tests or Gate v1.0 pass is claimed; current runtime runners are UNAVAILABLE. Next stage is `/speckit-analyze` pinned to this feature. Future changes to upstream contracts/requirements require affected artifact updates and another analyze before implementation.
