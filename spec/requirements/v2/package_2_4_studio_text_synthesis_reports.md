# Package 2.4 — Studio: Text Synthesis (Reports)

- **Release:** v2.0
- **Goal:** Introduce the `StudioPluginRegistry` (`Contract C-03`) in the Right Panel and provide 1-click and custom text report generators (Briefing Doc, Study Guide, FAQ, Timeline, dynamic source-driven report suggestions, and custom-prompted reports).
- **FRs:** FR-ST-10, FR-ST-11
- **Gate criteria (SRS §5.4):** Gate v2.0 #3 — all 4 standard report templates (`FR-ST-10`) generate valid, source-cited documents.
- **v2.0 proof of concept (D16, SRS §5.5 DEV-04):** v2 data lives in API process memory until v3. "Persisted" in this package means kept by the running API; "across sessions" and "after reload" in scenarios mean within one running API instance. Access control, sources and chat stay in PostgreSQL.
- **Out of scope:** Interactive Learning Overviews (`v4.0` — `FR-ST-12`), Mindmaps & Data Tables (`v3.0`), Flashcards, Quizzes, Slides, Infographics (`v4.0`), Audio & Video Overviews (`v5.0`).

**Cross-package rules:** [Binding scope, roles, lifecycle, quotas and validation](../README.md#binding-cross-package-rules).

---

### FR-ST-10 — Standard Report Templates (Briefing Doc, Study Guide, FAQ, Timeline)

| Field | Value |
| :- | :- |
| Release / Package | v2.0 / 2.4 |
| Priority (within package) | P1 |
| Actors | Owner; Editor (from v6.0) |
| Depends on | FR-SI-03, FR-UI-01, C-02, C-03 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Ubiquitous:* The Right Panel (`Studio`) shall provide a `Reports` (`Berichte`) generator tile / modal backed by `StudioPluginRegistry` (`Contract C-03`) offering four standard 1-click report templates:
  1. **Briefing Doc (`Briefing-Dokument`):** Executive summary, core themes, key takeaways, and verbatim quotes/citations.
  2. **Study Guide (`Studienleitfaden`):** Comprehensive topic review, short-answer quiz questions with answer key, essay questions, and a glossary of key terms.
  3. **FAQ:** Frequently Asked Questions and detailed source-grounded answers derived from $S_{\text{aktiv}}$.
  4. **Timeline (`Zeitleiste`):** Chronological list of all dated events in $S_{\text{aktiv}}$ followed by a `"Cast of Characters"` (`Hauptakteure`) section.
- *Event:* When the Owner/Editor clicks one of the four template buttons, the system shall trigger an asynchronous `StudioArtifact` job via `Contract C-03` scoped strictly to $S_{\text{aktiv}}$ (`Contract C-02`), display a generating indicator in the Studio artifact list, and persist the completed Markdown report.
- *Ubiquitous:* Each template has required sections, identified by a stable section key in `payload_json` (heading text follows the output language): Briefing Doc — `executive_summary`, `core_themes`, `key_takeaways`, `quotes`; Study Guide — `topic_review`, `short_answer_questions`, `answer_key`, `essay_questions`, `glossary`; FAQ — at least one question with its answer; Timeline — `events`, `cast_of_characters`. A report missing a required section is `Failed`, never `Completed`, except the Timeline case under Edge & error cases. A report is valid for Gate v2.0 #3 when every required section is present and every factual sentence cites a chunk in its captured scope.
- *Event:* When the Owner opens a completed report, the viewer shall offer `Copy`, `Delete` (with confirmation) and `Convert to source`; `Convert to source` saves the report as a note and converts that note through `FR-NM-03`.

**User story:** As a professional or student, I want 1-click buttons to generate a Briefing Doc, Study Guide, FAQ, or Timeline from my selected sources, so that I can produce polished reference documents without writing complex prompts.

**Reference behaviour**
1. In the Right Panel (`Studio`), the user clicks the `Reports` tile (or the direct template chips `Briefing doc`, `Study guide`, `FAQ`, `Timeline`).
2. A new row appears in the Studio output list at the bottom of the Right Panel showing `"Generating Briefing doc..."` with a progress animation.
3. Meanwhile, the user can continue chatting or reading sources without blocking.
4. Once finished, clicking the generated artifact opens the formatted document inside the Right Panel viewer (with copy, convert-to-source, and delete actions).

Evidence: `https://support.google.com/notebooklm/answer/16164461`, `SRS §3.5.4 FR-ST-10` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| `template_type` | Enum | `briefing_doc` \| `study_guide` \| `faq` \| `timeline` | — |
| `active_source_ids` ($S_{\text{aktiv}}$) | Array of UUIDs | $\lvert S_{\text{aktiv}}\rvert \ge 1$; required | — (the UI preselects all `Ready` sources; the API never falls back) |

**Outputs & state**
- Visible: Asynchronous job row in the Right Panel Studio list; full formatted Markdown viewer on click.
- Persisted: `StudioArtifact` record (`id`, `notebook_id`, `plugin_type: 'report'`, `subtype`, `status`, `title`, `payload_json: { content_md, citations, sections }`, `source_revisions_snapshot` (source IDs with revisions), `created_at`).
- States: `Queued` $\rightarrow$ `Running` $\rightarrow$ `Completed` (or `Failed`). `Cancelled` exists in C-03, but v2 has no cancel action.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Generate all 4 standard report templates grounded in active sources
  Given a notebook with 2 active sources containing dated historical events and technical definitions
  When the owner triggers "Briefing Doc", "Study Guide", "FAQ", and "Timeline"
  Then 4 StudioArtifact jobs run asynchronously and reach state "Completed"
  And "Study Guide" contains a Glossary and Short-Answer Questions with Answer Key
  And "Timeline" contains chronological events and a "Cast of Characters" section
  And no report contains facts from unselected sources (Leakage = 0)

Scenario: A queued report cannot publish after a captured source is deleted
  Given a report job captured Source A revision 1 at submission
  When A is deleted before the job publishes
  Then the job fails with a source-changed explanation
  And no stale or silently regenerated report is published
  And Retry requires a fresh explicitly scoped request
```

The same applies when a source is replaced by a new revision once re-sync exists (`FR-SI-05`, from v3.0).

**Edge & error cases**
- User triggers `"Timeline"` on sources that contain zero dates or chronological events $\rightarrow$ Report completes with an explicit section stating that the selected sources contain no dated events, plus the `cast_of_characters` section; it never invents dates. This is the only case where a required section (`events`) may complete without entries.
- $\lvert S_{\text{aktiv}}\rvert = 0$ $\rightarrow$ Report template buttons are disabled.

**Measurable criteria**
- $100\%$ of the $4$ standard templates generate valid, grounded Markdown documents (`Gate v2.0 #3`) within $\le 25.0\text{ s}$ (P95).

**Deviations from reference:** All generated reports are stored as `StudioArtifact` records via `Contract C-03` and can be converted to a source by saving them as a note and converting that note through `FR-NM-03`.

**Out of scope:** Direct PDF/DOCX layout export of reports (Markdown/Rich-text copy is supported in `v2.0`; slide PDF/PPTX export is in `v4.0`).

**Open questions:** `None`

---

### FR-ST-11 — Dynamic & Custom Prompted Reports

| Field | Value |
| :- | :- |
| Release / Package | v2.0 / 2.4 |
| Priority (within package) | P2 |
| Actors | Owner; Editor (from v6.0) |
| Depends on | FR-ST-10, FR-SI-02, C-02, C-03 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the Owner/Editor opens the `Reports` (`Create report`) modal in the Studio panel, the system shall analyze the `Source Guide` metadata of $S_{\text{aktiv}}$ and display $3\text{–}4$ **Dynamic Suggested Report Formats** tailored to the domain of the sources (e.g., `"Market Analysis"`, `"Methodology Comparison"`, `"Contradiction Report"`, `"Blog Post"`, `"Clinical Trial Summary"`).
- *Ubiquitous:* The `Create report` modal shall also provide a `"Create Your Own"` (`"Eigenen Bericht erstellen"`) option where the user can specify a custom report structure, tone, and target audience via free-text prompt.
- *Event:* When the user clicks a suggested dynamic format (optionally clicking the edit pencil to tweak its pre-filled prompt) or submits a `"Create Your Own"` prompt, the system shall execute the report generation job via `Contract C-03`.
- *Ubiquitous:* Custom and edited suggestion prompts change only the report's structure, tone and audience; `FR-GC-01` grounding and `FR-GC-02` citations stay non-overridable, as for `FR-GC-07` Custom.

**User story:** As a domain expert, I want the Studio to suggest report formats that fit my uploaded documents (like a contradiction analysis or methodology comparison) and let me define my own custom report prompt, so that I can generate domain-specific deliverables.

**Reference behaviour**
1. User clicks `Reports` in the Studio panel.
2. A modal `"Create report"` opens showing:
   - Row 1: `Create Your Own` + standard formats (`Briefing Doc`, `Study Guide`, `Blog Post`, etc.).
   - Row 2 (`Suggested Format`): $3\text{–}4$ dynamically generated cards based on the notebook's sources, each with a title, short description, and a pencil icon to customize the underlying prompt before generating.
3. Clicking `Generate` creates the report artifact in the Studio list.

Evidence: `https://blog.google/technology/ai/notebooklm-audio-video-overviews-reports-2025/`, `SRS §3.5.4 FR-ST-11` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Dynamic suggestions | Array of `{ title, description, prompt_template }` | $3\text{–}4$ items derived from $S_{\text{aktiv}}$ summaries | — |
| Custom report prompt | UTF-8 string | $1\text{–}5,000$ characters | Pre-filled when editing a suggestion |

**Outputs & state**
- Visible: Dynamic suggestion cards inside the `Create report` modal; resulting report artifact in the Studio list.
- Persisted: `StudioArtifact` (`plugin_type: 'report'`, `subtype: 'dynamic' | 'custom'`, `params_json: { custom_prompt }`).
- States: `SuggestionsLoading` $\rightarrow$ `SuggestionsReady` $\rightarrow$ `ReportGenerating` $\rightarrow$ `Completed`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Studio suggests domain-relevant report formats based on active sources
  Given a notebook with 3 competing vendor architecture proposals in Ready state
  When the owner opens the "Reports" modal in the Studio panel
  Then the "Suggested Format" section displays 3 to 4 context-specific report cards
  When the owner clicks the edit pencil on a suggestion, appends "Include a risk matrix", and clicks Generate
  Then the resulting report includes a risk matrix grounded in the 3 vendor sources
```

**Edge & error cases**
- Empty/whitespace-only custom report prompt is rejected; Generate is enabled at one non-whitespace character, matching the 1–5,000 character limit.
- While `Source Guide` metadata of $S_{\text{aktiv}}$ is still pending, the dynamic suggestions show a loading state; if guide generation failed, the modal explains that suggestions are unavailable. Standard and custom report creation stay usable in both cases (clarified 2026-10-18).
- The custom report prompt limit counts Unicode code points after trimming outer whitespace; over-limit prompts are rejected, never truncated.

**Measurable criteria**
- Dynamic report format suggestions load in $\le 3.0\text{ s}$ (cached per scope key: notebook, source revisions, effective authorization, output language).

**Deviations from reference:** None.

**Out of scope:** Uploading external Word/LaTeX template files with placeholder variables.

**Open questions:** `None`
