# FR Cards

The release index (`../System_Requirements_Specification_Gemeni_Notebook.md`) maps every release to its
packages and FR card IDs. This file holds the binding cross-package rules, package prerequisites,
[architectural contracts](#architectural-contracts) `C-01..C-03`, [release gates](#release-gates),
the [deviation log](#deviation-log) (`DEV-xx`) and the [card consistency clarifications](#card-consistency-clarifications).
The FR cards in this folder hold the detail that `/speckit-specify` needs, so
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
- **The release index stays current**: list every card's IDs under its release in `../System_Requirements_Specification_Gemeni_Notebook.md` and link the card.
- **Language**: German or English; generated specs are written in English.
- **Open questions**: at most 3 may remain per package; resolve the rest before specifying.
- **Specify**: run `/speckit-specify spec/requirements/v1/<package-file>.md` once per package.
  Each spec requirement cites its requirement ID, e.g. `FR-001 (FR-SI-03)`.
- **Flow-back spec (keep cards and upstream specs synchronized)**: FR cards are living
  sources of truth, not write-once inputs discarded after `/speckit-specify`. Any clarification,
  refinement, or reality gap discovered in a downstream Spec Kit stage must flow back into
  `specs/<feature>/spec.md` AND upstream into the governing tier:
  - **`/speckit-clarify`**: write resolved open questions and ambiguities back into the
    package's FR card (updating EARS, limits, Gherkin scenarios, or edge cases and removing the
    resolved item from `Open questions`) and into this file, the release index, or a GitHub issue if cross-package or release-level,
    in addition to `specs/<feature>/spec.md`.
  - **`/speckit-plan` & `/speckit-analyze`**: flow refined contracts (`C-01..C-03`), numeric/text
    limits, error states, or technical choices back into `specs/<feature>/spec.md`, the package's
    FR card / `spec/requirements/README.md`, or `docs/solution-architecture.md` (`Dn`) before
    `/speckit-implement` starts.
  - **`/speckit-implement` & `/speckit-converge`**: when implementation or convergence reveals a
    reality gap, unstated edge case, or feasibility constraint, flow the resolution back to
    `specs/<feature>/spec.md` and upstream into the FR card, this file, or
    `docs/solution-architecture.md` (`Dn`) (and affected GitHub issues), then rerun
    `/speckit-analyze` rather than only patching code or appending unbacked tasks.
- **Cadence**: cards for the current release first; the next release's cards may be written
  while the current one is implemented (Constitution Principle V).

## Binding cross-package rules

These rules apply to every card, including its scenarios and input defaults. They clarify
the cited requirement IDs; they do not introduce new release packages.

- **Authority, evidence, and flow-back:** The constitution, release index, this file, cards, and recorded architecture
  decisions govern the target behavior in that order, with recorded deferrals applied explicitly.
  Downstream Spec Kit stages (`/speckit-clarify`, `/speckit-plan`, `/speckit-analyze`,
  `/speckit-implement`, `/speckit-converge`) must flow any resolved questions, contract/limit
  refinements, or implementation edge cases back into both `specs/<feature>/spec.md` and the
  applicable upstream tier (FR card, this file, `docs/solution-architecture.md` `Dn`, and GitHub
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

## Architectural contracts

Moved from the archived SRS §5.1 (2026-10-22). Three fixed core interfaces, defined in v1.0
and v2.0, keep later releases from forcing breaking changes or refactoring in modules that
have already passed their gate:

1. **Contract C-01 (`UnifiedDocumentChunk` schema):** Every ingestion parser (PDF in v1.0,
   audio/video in v3.0, Deep Research in v6.0) converts source data into the same normalized
   object:
   $$\text{Chunk} = (\texttt{source\_id}, \texttt{chunk\_id}, \texttt{text}, \texttt{token\_count}, \texttt{locator})$$
   `locator` is polymorphic: page/paragraph offset (`page_span`; the physical page is optional
   for plain-text sources, which use deterministic text/paragraph offsets), time interval
   (`time_span`) or DOM path (`dom_path`). Slides use `page_span` in the normalized viewer;
   `char_span` and `slide_number` are not additional locator variants. The Citation Engine and
   all Studio agents work only against this schema.
2. **Contract C-02 (`ScopedContextProvider` interface):** No agent (chat or Studio) reads
   database tables directly. All consumers call only
   `getScopedContext(notebook_id, active_source_ids)`, so `NFR-EVAL-04`
   ($\text{Leakage} = 0$) is guaranteed in one place.
3. **Contract C-03 (`StudioPluginRegistry` & asynchronous job pattern):** Every Studio feature
   implements one `StudioGeneratorPlugin` interface
   (`triggerJob(scoped_context, params) -> artifact_id`) and stores its result as a typed
   JSON/media payload in the same `StudioArtifact` table. New Studio tiles in v3.0, v4.0 and
   v5.0 register as independent plugins without modifying existing code (open-closed
   principle).

## Release gates

Moved from the archived SRS §5.4 (2026-10-22). Implementation of release v(k+1) may start only
after every automated gate of release v(k) has passed ($\text{Gate}(V_k) = \text{PASS}$):

| Release | Mandatory validation gate (automated acceptance criteria) |
| :--- | :--- |
| **Gate v1.0** | **1.** An end-to-end upload (PDF/MD) produces valid `UnifiedDocumentChunk` records.<br>**2.** `NFR-EVAL-01` to `04` pass ($\epsilon_{\text{hallucination}} < 0{,}05$, $\text{Precision}_{\text{ID}} = 1{,}0$, $\text{Rejection} \ge 99\,\%$, $\text{Leakage} = 0$).<br>**3.** In a UI test, clicking citation `[n]` scrolls deterministically to the correct DOM element in the Source Viewer. |
| **Gate v2.0** | **1.** Every successfully ingested upload triggers `FR-SI-02` asynchronously (Source Guide $< 10\text{ s}$ P95 from `Ready`; failures must not block reading the source).<br>**2.** Round-trip test passes: *chat answer $\rightarrow$ save as note $\rightarrow$ convert to source $\rightarrow$ the new source is citable in the next chat turn*.<br>**3.** All 4 standard report templates (`FR-ST-10`) generate valid, source-cited documents. |
| **Gate v3.0** | **1.** Audio/video uploads produce chunks with clickable timestamp locators (`mm:ss`).<br>**2.** The Python sandbox (`FR-GC-08`) is network-isolated and returns correct results/plots.<br>**3.** Mindmap JSON is acyclic/hierarchical; table export yields valid CSV/XLSX; the context window scales to $10^6$ tokens (`NFR-PERF-01`). |
| **Gate v4.0** | **1.** Flashcard and quiz generators cover only the active sources $S_{\text{aktiv}}$.<br>**2.** Learning-progress state (`FR-ST-15`) persists wrongly answered questions for targeted review.<br>**3.** Slide deck export produces PPTX/PDF files that open without errors. |
| **Gate v5.0** | **1.** Audio synthesis produces a 2-speaker dialogue without overlap artifacts.<br>**2.** The live-voice interrupt (`FR-ST-03`) pauses the stream, answers the question strictly *source-grounded* through one designated host in that host's voice profile (DEV-01), and resumes the podcast.<br>**3.** The video rendering pipeline produces synchronized MP4/WebM streams for all three modes (`FR-ST-05` to `07`). |
| **Gate v6.0** | **1.** Penetration/RBAC test: a *Chat-Only* user can fetch neither raw sources nor Studio endpoints, through the UI or a direct API call.<br>**2.** ACL test (`NFR-SEC-02`): *Discover Sources* never finds intranet documents the requesting user may not read.<br>**3.** *(Deferred, DEV-03 / D5)* An `@Notebook` call in the external enterprise chat returns answers grounded identically to the internal notebook chat. Not part of v6.0 acceptance until D5 is reassessed. |

## Deviation log

Moved from the archived SRS §5.5 (2026-10-22). Architectural and operational deviations from
the reference product are recorded here so this folder stays the single source of truth for
development and test agents. Deviations that need an architecture decision cite its ID (`Dn`)
in the [solution architecture](../../docs/solution-architecture.md#decisions). IDs are never
renumbered.

| ID | Requirement / gate | Original requirement | Accepted behaviour (architecture decision) | Date & decision |
| :--- | :--- | :--- | :--- | :--- |
| **DEV-01** | `FR-ST-03` (Join-In), `Gate v5.0` #2 | Both AI hosts answer interruptions immediately in the same voice profile and then continue the discussion. | Playback pauses. **One designated host** answers the live question in that host's podcast voice through Gemini Live (grounded through `C-02`). Playback then resumes at the interruption point. The second host does not take part in the live answer. | 2026-10-16, project owner ([D7](../../docs/solution-architecture.md#decisions)) |
| **DEV-02** | `FR-ST-16` (Slide Decks) | Export as PPTX / PDF / Google Slides. | Export only as `.pptx` and `.pdf`. Google Slides export is deferred because it needs per-user OAuth authorization. | 2026-10-16, project owner ([D8](../../docs/solution-architecture.md#decisions)) |
| **DEV-03** | `FR-INT-01` (`@Notebook`), package 6.3, `Gate v6.0` #3 | `@Notebook` mention in the central enterprise chat and export of chat threads as a notebook or source in v6.0. | Deferred. Package 6.3 is not specified; Gate v6.0 #3 is not part of v6.0 acceptance. The chat agent stays stateless behind `C-02` and A2A-ready. | 2026-10-16, project owner ([D5](../../docs/solution-architecture.md#decisions)) |
| **DEV-04** | v2.0 packages 2.1–2.4 (`FR-WM-02/03`, `FR-UI-02`, `FR-SI-02`, `FR-GC-04/05/07/09`, `FR-NM-01..04`, `FR-ST-10/11`), `Gate v2.0` | Persistent storage of all v2 data (preferences, icons, pins, Source Guides, overviews, chat configuration, feedback, notes, Studio artifacts). | **Proof of concept:** until v3, v2 data lives in the process memory of a single API instance and is lost on restart or redeploy. Access control, sources and chat stay in PostgreSQL (v1). Exception: sources created from notes (note-sources, `FR-NM-03/04`) are normal v1 sources in PostgreSQL (`media_type: note_markdown`) sharing the source limit; the notes themselves stay in process memory. The move to PostgreSQL is deliberately postponed until after v3. **Closed 2026-10-21 (specs/013):** all v2 data lives in PostgreSQL (migrations `0005`–`0008`) and survives restart and redeploy. Still: one API instance, and v2 background work runs in the API process; on startup, interrupted Studio reports are marked failed (retry possible) and interrupted Source Guides are regenerated ([D16](../../docs/solution-architecture.md#decisions)). | 2026-10-19, project owner; note-source exception 2026-10-20 ([D16](../../docs/solution-architecture.md#decisions)); closed 2026-10-21, project owner (specs/013) |

## Card consistency clarifications

Moved from the archived SRS §5.6 (clarifications dated 2026-10-16 onwards; moved 2026-10-22).
These resolve contradictions within the existing IDs; they change no constitution principles
and do not authorize enabling cloud APIs.

- **v2.0 proof of concept (project owner decision 2026-10-19, DEV-04/D16):** The v2 packages
  first ran on process memory instead of PostgreSQL so a runnable proof of concept was
  available earlier. **Done 2026-10-21 (specs/013, v3 prerequisite):** v2 data lives in
  PostgreSQL and survives restart and redeploy; interfaces and behaviour of the v2 packages are
  unchanged. There is still one API instance (D16).
- **v2.0 card review (project owner decision 2026-10-20):** Note AI actions (`FR-NM-04`) reuse
  an already converted note-source when the same notes are present at the same revision; only
  new or changed content takes a source slot. A timeline (`FR-ST-10`) without dated events
  ends with an explicit notice and the main actors, never with invented dates. Source Guides
  (`FR-SI-02`) are created at `Ready` in the notebook's effective output language and stored
  per source, revision and language; another language is generated on open. In v1–v5 the
  owner sets the notebook language; personal per-notebook overrides apply from v6.0
  (`FR-UI-02`). Note-sources (`FR-NM-03/04`, project owner decision 2026-10-20) are stored as
  normal v1 sources in PostgreSQL: conversion reserves the slot through the atomic v1
  reservation (uploads and note-sources share one limit, 50 sources by default), the combined
  Markdown runs through v1 Markdown ingestion to `Ready`, and the origin notes, their revisions
  and copied citations are stored as provenance. Inline citation markers such as `[1]` are
  removed from the source text. Since 2026-10-21 (specs/013) the notes themselves are also in
  PostgreSQL (DEV-04 closed, D16).
- **NFR-EVAL-01..04, all release gates (project owner decision 2026-10-19):** Deterministic
  checks (`NFR-EVAL-02` ID precision, `NFR-EVAL-04` leakage) run on every PR. LLM-judged checks
  (`NFR-EVAL-01`, `NFR-EVAL-03`, semantic citation support) run once per release gate on a
  fixed, deterministically stratified sample of 50 cases from the versioned golden dataset; one
  passing run is sufficient gate evidence. Thresholds are unchanged (constitution v2.0.0).
- **FR-WM-07:** 200 MB = 200,000,000 bytes and 500,000 words are independent inclusive limits.
  Source slots are reserved atomically and released when ingestion fails. v1: 100 notebooks per
  user and 50 sources per notebook by default (deployment configuration up to 300); v6:
  tenant/role policies up to 500 notebooks and 300 sources. The existing daily generation
  quotas from card 6.1 are made precise: defaults of 500 chat requests, 20 audio and 20 video
  generations per user per UTC day; positive, administratively configurable limits. No
  additional billing features.
- **FR-GC-07/09, FR-UI-02:** Persona limit 5,000 characters, including the Analyst preset;
  copy with or without citations. Global and per-notebook input/output languages follow the
  precedence rules in the cards; personal settings never change other users' preferences.
- **C-01/C-02, FR-SI-01/02/05:** All parsers use the same locator union. The Source Guide
  starts after successful ingestion with an explicit single-source scope. Re-sync validates a
  new revision before the atomic swap; failures keep the old state. Google Docs/Slides import
  stays in v3 (D11); authenticated import is not moved to v6 search. Prompt-injection checks
  for web content apply from v3.
- **FR-NM-03/04, FR-GC-01/02, NFR-EVAL-04:** Converting several notes creates one combined
  source under the normal limits. Notes are user input, not automatic source evidence; for
  source-grounded note synthesis they are converted first and explicitly selected. The labelled
  note action authorizes this conversion as part of the operation, so summarize/outline still
  works with no prior source. Validated answers and media must cite sources; a failed citation
  check yields an immediate refusal. History, caches and artifact-to-chat actions must not
  bypass the current scope. Status displays do not count as answer TTFT (D13).
- **FR-WM-05/06, NFR-SEC-02:** Only owners manage shares; viewers keep their own chats and
  learning progress. Chat-Only users get only answer-bound citation previews, no freely
  addressable chunk/source API. Source ACLs also apply to derived artifacts after import.
  Analytics count UTC days, including owner visits.
- **FR-ST-04/12/16/17, FR-SI-07:** Audio links grant no additional rights; Learning Overviews
  also need the infographics from package 4.2. Deep Research imports primary sources before
  the cited report synthesis and stores the report as an artifact and as a source. The report
  source needs its own quota slot. Required parts must not be dropped through silent fallback
  or incomplete success states.
- **NFR-PERF-01:** The million-token measurement covers at least one million active tokens,
  not counting deselected decoys. Large Studio jobs process original chunks completely in
  batches; lossy Source Guides alone are not enough (D12).
