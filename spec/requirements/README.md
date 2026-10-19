# FR Cards

The SRS (`../System_Requirements_Specification_Gemeni_Notebook.md`) is the index of all
requirements. The FR cards in this folder add the detail that `/speckit-specify` needs, so
specs are transcribed from observed or memorized behaviour instead of invented. Template and examples:
[`_fr-card-template.md`](_fr-card-template.md).

## What to extract per FR

For each FR collect these details from your knowledge.  Write `Unknown` if you
do not know for sure; never guess.

| # | Extract | Why the spec needs it |
| - | :- | :- |
| 1 | **Trigger and entry point**: where in the UI, which button or gesture, and the preconditions | Given/When of the scenarios |
| 2 | **Actors**: which roles may do it (Owner/Editor, Viewer, Chat-only) | Permissions; RBAC tests |
| 3 | **Main flow**: numbered steps of what happens | User story and acceptance scenarios |
| 4 | **Inputs and limits**: fields, formats, sizes, counts, defaults, with **numbers** | Testable constraints |
| 5 | **Outputs and state**: what the user sees, what is persisted, status transitions | Then-clauses; key entities |
| 6 | **Errors and edge cases**: empty, too large, unsupported, deleted meanwhile, concurrent, offline; exact message text if it matters | Edge-case section |
| 7 | **Timing**: synchronous or asynchronous, rough duration, progress indicator | Success criteria |
| 8 | **Links to other FRs**: which FRs it depends on or triggers | Dependencies; release order |
| 9 | **Deviations**: what we deliberately do differently, and why | Avoids copying the product blindly |
| 10 | **Evidence**: screenshot or recording path, help URL, date observed | Traceability; the product changes |
| 11 | **Open questions**: what you could not determine | Max 3 clarification markers per spec |

Rows 1–6 are the minimum for a card to be usable.

## How to hand them over

- **One file per release package**, named `v<N>/package_<N>_<M>_<short_name>.md`
  (e.g. `v1/package_1_2_text_pdf_ingestion_inspector.md`): the package header
  first (see template), then one FR card per FR in that package.
- **Evidence** goes in `../evidence/<FR-ID>/` and is referenced by relative path.
- **The SRS stays the index**: keep the one-sentence FR there and add a link to its card.
- **Language**: German or English; generated specs are written in English.
- **Open questions**: at most 3 may remain per package; resolve the rest before specifying.
- **Specify**: run `/speckit-specify spec/requirements/v1/<package-file>.md` once per package.
  Each spec requirement cites its SRS ID, e.g. `FR-001 (FR-SI-03)`.
- **Flow-back spec (keep cards and upstream specs synchronized)**: FR cards are living
  sources of truth, not write-once inputs discarded after `/speckit-specify`. Any clarification,
  refinement, or reality gap discovered in a downstream Spec Kit stage must flow back into
  `specs/<feature>/spec.md` AND upstream into the governing tier:
  - **`/speckit-clarify`**: write resolved open questions and ambiguities back into the
    package's FR card (updating EARS, limits, Gherkin scenarios, or edge cases and removing the
    resolved item from `Open questions`) and into the SRS / GitHub issue if scope- or index-level,
    in addition to `specs/<feature>/spec.md`.
  - **`/speckit-plan` & `/speckit-analyze`**: flow refined contracts (`C-01..C-03`), numeric/text
    limits, error states, or technical choices back into `specs/<feature>/spec.md`, the package's
    FR card / `spec/requirements/README.md`, or `docs/solution-architecture.md` (`Dn`) before
    `/speckit-implement` starts.
  - **`/speckit-implement` & `/speckit-converge`**: when implementation or convergence reveals a
    reality gap, unstated edge case, or feasibility constraint, flow the resolution back to
    `specs/<feature>/spec.md` and upstream into the FR card, SRS, or
    `docs/solution-architecture.md` (`Dn`) (and affected GitHub issues), then rerun
    `/speckit-analyze` rather than only patching code or appending unbacked tasks.
- **Cadence**: cards for the current release first; the next release's cards may be written
  while the current one is implemented (Constitution Principle V).

## Binding cross-package rules

These rules apply to every card, including its scenarios and input defaults. They clarify
the cited SRS requirements; they do not introduce new release packages.

- **Authority, evidence, and flow-back:** The constitution, SRS, cards, and recorded architecture
  decisions govern the target behavior in that order, with recorded deferrals applied explicitly.
  Downstream Spec Kit stages (`/speckit-clarify`, `/speckit-plan`, `/speckit-analyze`,
  `/speckit-implement`, `/speckit-converge`) must flow any resolved questions, contract/limit
  refinements, or implementation edge cases back into both `specs/<feature>/spec.md` and the
  applicable upstream tier (FR card, SRS, `docs/solution-architecture.md` `Dn`, and GitHub
  issues) so upstream specs never drift from feature specs or code. Reference links and
  `Reference behaviour` paragraphs are background, not proof of current product behavior. An
  observation without a dated capture is unverified. Symbolic IDs in Gherkin (such as `chk_10`)
  stand for schema-valid fixture IDs when tests are derived. Numeric limits and UI choices in
  these cards are Everlast LM acceptance choices unless evidence says otherwise. Unknown
  reference internals do not block a project choice already stated in a card.
- **Roles and release order (FR-WM-04/05, NFR-SEC-02):** v1–v5 are owner-only. Editor,
  Viewer Full, and Viewer Chat-Only permissions mentioned in earlier cards apply only from
  v6. Owners and Editors may mutate source/note/Studio content; only Owners manage shares or
  delete the notebook. Full Viewers may read/export artifacts and update their own chat,
  learning progress, and personal preferences. Chat-Only users may use their own chat,
  copy/feedback, and personal chat preferences, but have no raw-source, Notes, or Studio API
  access. A valid login never substitutes for notebook and document authorization.
- **Explicit scope (FR-SI-03, C-02, NFR-EVAL-04):** Every generation request carries an
  explicit selection of Ready sources. `All Ready sources` is an initial UI selection, never
  a server fallback for an omitted or empty selection. Selection is local to each user's
  browser session and notebook; it never changes another user's selection. Chat-Only scope
  is resolved server-side to all Ready sources authorized for that user, since no source
  selector is exposed. Empty scope disables source-based generation and is rejected by the
  API; explicitly launched discovery/research can start in an empty notebook (FR-SI-06/07).
- **Snapshots and access (C-02/C-03, FR-SI-05, NFR-SEC-02):** Capture source IDs and content
  revisions at submission. Later checkbox changes affect subsequent requests only. Workers
  recheck access before reading and publishing. Deleted, replaced, or newly unauthorized
  source revisions fail the in-flight generation without publishing stale output; they must
  not silently substitute new content. Summaries, caches, history, sandbox inputs, live
  replies, and generated prompts all obey the same scope and revision checks through C-02.
  Cache keys include notebook, source IDs/revisions, effective authorization, language, and
  relevant generation parameters. Ingestion writes C-01; it is not a bypass for agent reads. A Source Inspector read uses an explicitly authorized singleton read scope through C-02 without changing chat selection; this viewing action does not make the source eligible for a new generation.
- **Historical outputs (FR-GC-03/06, FR-ST-09/13/14, NFR-EVAL-04):** Existing artifacts and
  chat remain viewable when a source is merely deselected, subject to current authorization.
  They are never automatically reintroduced into a new prompt. Drilldown, Explain, topic
  chips, and follow-ups use the current selection, and must not inject text from artifacts
  whose supporting sources/revisions are outside that scope. Show a select-sources prompt
  instead; never silently restore a past selection. On deletion/revocation, hide affected historical generated content or show an unavailable placeholder; do not keep a readable cached copy. Deleted/revoked content must not be
  exposed through cached snippets, generated artifacts, exports, or signed media URLs.
- **Grounding before publication (FR-GC-01/02, C-03, NFR-EVAL-01..04):** Validate citation
  IDs against the scoped C-01 chunks before displaying factual content. On validation failure,
  replace the answer with a refusal, not a stripped-citation draft or a retry answer. Studio
  jobs fail with a refusal explanation and expose no invalid artifact. Status events may
  stream while the answer is buffered for validation; they do not count as answer TTFT.
  Summaries and media transcripts retain claim-level source references. Generated media is
  labelled `AI-generated`; computed results are labelled `Computed` and cite input data.
  Illustrative media is labelled as illustration, never presented as documentary evidence.
- **Jobs and insufficient evidence (C-03, FR-ST-01..18):** Every Studio generator uses the
  same registry and `Queued → Running → Completed | Failed | Cancelled` lifecycle; specific
  rendering stages are progress substates of Running. Retry creates a new attempt with fresh
  authorization and explicit scope. Never publish missing required blocks as Completed.
  Requested counts/lengths are targets constrained by available evidence: produce fewer items
  with an explanation, or a refusal if none are supported, rather than invent padding.
- **Text limits (FR-WM-01, FR-GC-01/07, FR-NM-01):** Unless a field explicitly says bytes, words or grapheme clusters, count Unicode code points after trimming outer whitespace; reject over-limit input rather than truncate it.
- **Quotas and units (FR-WM-07, FR-SI-01, FR-NM-03, FR-SI-06/07):** `200 MB` means
  200,000,000 bytes, inclusive; 500,000 extracted words is a separate inclusive limit for
  every source type. Reserve source slots atomically before ingestion, including batch,
  notes, research and re-sync paths. Uploading/Processing/Ready sources consume a slot;
  Failed uploads release it and retain only a dismissible error row. Re-sync uses the same
  slot and leaves the old revision intact if validation fails. Each source obeys both limits.
- **Validation cadence (NFR-EVAL-01..04, all release gates):** Deterministic citation-ID and
  leakage checks run on every PR. LLM-judged faithfulness/rejection and semantic citation
  support checks run once per release gate on a fixed stratified 50-case sample of the
  golden dataset; that single passing run is sufficient gate evidence (Constitution v2.0.0). All other
  constitution checks still apply. Passing one package's tests is not passing the full gate.
  Package timing criteria are measured on declared fixtures/environments; standard chat TTFT
  starts at submission and ends at the first validated answer token, excluding progress UI.

## Package prerequisites

Gate v(k) must pass before implementation of v(k+1). Within each release, use these
dependencies when deriving Spec Kit tasks; mutual FR links describe integration, not an
impossible requirement that each side be fully implemented first.

| Release | Within-release ordering / shared prerequisite |
| :- | :- |
| v1 | Define C-01/C-02 once; 1.1 supplies identity, notebooks and quotas; 1.2 supplies ingestion/inspector; 1.3 supplies chat/citations; 1.4 supplies UI integration and full gate tests. Test harness/UI shells may be built before their consumers. |
| v2 | 2.1 language preferences precede language-sensitive generators; 2.2 response actions and 2.3 saved notes share one save-note contract (`POST /api/notebooks/{notebook_id}/chat/messages/{message_id}/note`). 2.4 defines C-03. Source Guide is asynchronous; overview generation can read chunks without waiting for it. |
| v3 | 3.1 extends C-01 adapters without changing the locator union; 3.2 and 3.3 consume existing contracts; 3.4 benchmarks the integrated v3 result. |
| v4 | 4.1 flashcards/quizzes and 4.2 infographics precede the composite FR-ST-12 Learning Overview. Each generator remains an independent C-03 plugin. |
| v5 | 5.1 TTS and v4 slide rendering precede 5.2 narrated video. Join-In also depends on the player in FR-ST-04. |
| v6 | 6.1 identity/document authorization and quota policies precede 6.2 research. Package 6.3 and Gate v6.0 #3 remain deferred by D5; no feature spec is generated for 6.3. |
