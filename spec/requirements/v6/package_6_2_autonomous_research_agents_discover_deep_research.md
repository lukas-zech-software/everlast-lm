# Package 6.2 — Autonomous Research Agents (Discover & Deep Research)

- **Release:** v6.0
- **Goal:** Provide the two autonomous source-discovery agents: the interactive "Discover Sources" agent (curating up to 10 relevant intranet/web sources with 1-click import) and the multi-step "Deep Research" agent (autonomous iterative search, verification, synthesis report generation, and primary source import).
- **FRs:** FR-SI-06, FR-SI-07
- **Gate criteria (SRS §5.4):** Gate v6.0 #2 — ACL-Test (`NFR-SEC-02`): *Discover Sources* & *Deep Research* finden niemals Intranet-Dokumente, für die dem anfragenden Nutzer die Leseberechtigung fehlt.
- **Out of scope:** Autonomous write-actions on external websites (form submissions, purchases).

**Cross-package rules:** [Binding scope, roles, lifecycle, quotas and validation](../README.md#binding-cross-package-rules).

---

### FR-SI-06 — Discover Sources Agent ("Quellen entdecken")

| Field | Value |
| :- | :- |
| Release / Package | v6.0 / 6.2 |
| Priority (within package) | P1 |
| Actors | Owner/Editor |
| Depends on | FR-SI-01, FR-WM-07, NFR-SEC-02, C-01, C-02 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the Owner/Editor clicks `"Discover sources"` (`"Quellen entdecken"`) in the Left Panel or the `"Add sources"` modal, enters a topic description (or clicks `"I'm feeling curious"` / `"Ich bin neugierig"`), selects search scope (`Enterprise Intranet`, `Web`, or `Both`), and clicks `"Submit"`, the `Discovery & Research Agent` shall query the configured search indices (enforcing `NFR-SEC-02` ACLs) and return a curated list of up to $10$ relevant candidate sources, each with a title, URL, and an AI-annotated summary explaining why it is relevant to the query.
- *Event:* When the user checks the desired candidate sources from the curated list and clicks `"Import"` (`"Importieren"`), the system shall ingest all selected candidates into the notebook via the standard ingestion pipeline (`FR-SI-01` / `Contract C-01`).

**User story:** As a researcher starting a new notebook on an unfamiliar topic or internal project, I want to type what I'm interested in and have an agent find and summarize the 10 most relevant intranet and web documents for 1-click import.

**Reference behaviour**
1. In the Left Panel header (or inside `Add sources`), the user clicks `Discover` (`Quellen entdecken`).
2. A dialog asks `"What are you interested in?"` with a text area, an `"I'm feeling curious"` button, and a `Submit` button.
3. Within seconds, the dialog lists up to $10$ recommended sources with checkboxes, source titles/links, and a short paragraph explaining each source's relevance.
4. User checks the desired items, clicks `Import`, and they appear directly in the Left Panel (`Sources`) and begin ingestion.

Evidence: `https://blog.google/technology/ai/notebooklm-discover-sources-2025/`, `SRS §3.2 FR-SI-06` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Discovery query | UTF-8 string | $1\text{–}1,000$ characters | — |
| Search scope | Enum | `intranet` \| `web` \| `both` | `both` (or `intranet` per tenant policy) |
| Candidate results | Array of curated hits | Up to $10$ results per run | All checked by default for 1-click import |

**Outputs & state**
- Visible: Curated list of up to $10$ candidate sources with checkboxes and relevance summaries; imported sources added to Left Panel.
- Persisted: Imported candidates persisted as `Source` and `UnifiedDocumentChunk` records (`Contract C-01`).
- States: `Prompting` $\rightarrow$ `SearchingAndCurating` $\rightarrow$ `CandidatesPresented` $\rightarrow$ `Importing`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Discover Sources curates relevant ACL-filtered results and imports selected hits in 1 click (Gate v6.0 #2)
  Given an open notebook with 2 existing sources
  When the owner opens "Discover sources", enters "Zero Trust mTLS migration", and clicks Submit
  Then the agent presents up to 10 candidate sources Permitted by the user's ACLs, each with a relevance summary
  When the owner selects 3 candidates and clicks "Import"
  Then 3 new sources are added to the notebook, parsed into UnifiedDocumentChunks, and reach state "Ready"
```

**Edge & error cases**
- Notebook only has $2$ remaining source quota slots (`298 / 300`) $\rightarrow$ Allows checking at most $2$ candidates and shows a quota indicator.
- `"I'm feeling curious"` clicked $\rightarrow$ Show a suggested topic for the user to confirm; only Submit authorizes external discovery under the displayed scope.
- All candidate summaries and research results are labelled external and screened for prompt injection before model use/indexing. They are not notebook grounding until imported as Ready C-01 sources; existing notebook content can be read only through C-02.
- Deep Research needs at least two free source slots (one primary source and one report). If no permitted primary source imports successfully, fail with an explanation rather than publish an uncited report. Enforce per-source limits on the report too; a failed report import leaves the job Failed with existing primary sources intact.

**Measurable criteria**
- Discovery curation returns candidate list in $\le 8.0\text{ s}$ (P95).
- $0$ ACL violations on intranet candidates (`Gate v6.0 #2`).

**Deviations from reference:** Adds an explicit scope selector (`Intranet` | `Web` | `Both`) so enterprise users can restrict discovery strictly to internal company repositories when needed.

**Out of scope:** Importing paywalled third-party websites without credentials.

**Open questions:** `None`

---

### FR-SI-07 — Multi-Step Deep Research Agent

| Field | Value |
| :- | :- |
| Release / Package | v6.0 / 6.2 |
| Priority (within package) | P1 |
| Actors | Owner/Editor |
| Depends on | FR-SI-06, FR-ST-10, FR-WM-07, NFR-SEC-02, C-01, C-02, C-03 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook / Gemini Deep Research |

**Requirement (EARS)**
- *Event:* When the Owner/Editor launches `"Deep Research"` (`"Tiefenrecherche"`) with a complex research question, the `Discovery & Research Agent` shall first generate a multi-step **Research Plan** (`Forschungsplan`) for user approval, and only upon confirmation execute iterative autonomous search loops (formulating sub-queries, reading candidate pages/intranet docs under `NFR-SEC-02`, cross-checking facts, and refining follow-up searches).
- *Event:* When the multi-step investigation completes, the agent shall:
  1. Import the verified primary sources admitted by the approved plan and quota, after safety and ACL checks, through C-01. Await Ready before report synthesis; report any failed imports explicitly.
  2. Obtain these Ready sources through C-02 using the approved explicit research scope, then generate the fully cited **Deep Research Report** through C-03. Persist both a `StudioArtifact` and a separately ingested report `Source`, preserving primary-source provenance. The report cannot cite its own generated source or an unimported candidate. Mark externally obtained material as external (FR-GC-01).

**User story:** As a strategy or R&D analyst, I want an autonomous Deep Research agent that plans a multi-step investigation, reads dozens of intranet and web sources, writes a comprehensive cited research report, and imports both the report and the primary sources into my notebook automatically.

**Reference behaviour**
1. User selects `Deep Research` in the source discovery / research dialog and enters a complex prompt.
2. Agent presents a structured multi-step research plan (`Step 1: ...`, `Step 2: ...`); user clicks `Start research`.
3. A live progress tracker shows which queries and sources the agent is currently reading (`"Browsing 18 sources..."`).
4. Upon completion, the synthesized Deep Research Report and the discovered primary sources are populated in the notebook ready for grounded chat and Studio generation.

Evidence: `SRS §3.2 FR-SI-07`, `https://blog.google/products/gemini/google-gemini-deep-research/` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Research prompt | UTF-8 string | $10\text{–}5,000$ characters | — |
| Search iterations / depth | Integer | $2\text{–}5$ iterative refinement hops; up to $25$ imported primary sources per run; reserve one additional source slot for the report and bound primary imports by remaining `FR-WM-07` capacity | $3$ hops |

**Outputs & state**
- Visible: Editable/approvable Research Plan, real-time step-by-step progress log, final Deep Research Report, and imported primary sources in Left Panel.
- Persisted: Imported primary and report `Source` records (`Contract C-01`) plus synthesized `StudioArtifact` (`plugin_type: 'deep_research_report'`, primary source IDs/revisions and citations).
- States: `Planning` $\rightarrow$ `AwaitingPlanApproval` $\rightarrow$ `Researching (Step k/N)` $\rightarrow$ `IngestingPrimarySources` $\rightarrow$ `SynthesizingReport` $\rightarrow$ `IngestingReportSource` $\rightarrow$ `Completed` (or `Failed` / `Cancelled`). The research coordinator owns these progress states; report synthesis invokes the standard C-03 plugin lifecycle after primary sources are Ready.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Deep Research executes multi-step search, imports primary sources, and produces cited report (Gate v6.0 #2)
  Given an open notebook and an authenticated user
  When the owner starts Deep Research on a multi-part technical topic and approves the research plan
  Then the agent executes >= 2 iterative search steps respecting NFR-SEC-02 document ACLs
  And imports the discovered primary sources into the Left Panel in state "Ready"
  And saves a comprehensive Deep Research Report citing those primary sources

Scenario: Research reserves room for both primary evidence and the report source
  Given the notebook has exactly two free source slots
  When the owner approves Deep Research
  Then the job admits at most one primary source and reserves one slot for the report
  And the primary source reaches Ready before the report is synthesized through C-02
  And the completed report is stored as both a cited StudioArtifact and a Ready source
```

**Edge & error cases**
- User clicks `"Cancel research"` mid-run $\rightarrow$ Stop further hops and mark the job Cancelled; keep already imported sources, release unused quota reservations, and do not publish a partial report as Completed. Expose the imported-source list and cancellation status.

**Measurable criteria**
- Research Plan generated in $\le 5.0\text{ s}$; full 3-hop Deep Research run completes in $\le 180\text{ s}$ with live progress updates every $\le 3\text{ s}$.

**Deviations from reference:** None.

**Out of scope:** Running unconstrained background crawls exceeding $5$ hops per task.

**Open questions:** `None`
