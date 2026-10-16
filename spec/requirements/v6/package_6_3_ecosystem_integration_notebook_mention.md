# Package 6.3 — Ecosystem Integration (@Notebook)

- **Release:** Unscheduled (original allocation: v6.0; deferred by D5)
- **Status:** Deferred (D5). `FR-INT-01` is out of scope per architecture decision D5; do not run `/speckit-specify` for this package until D5 is revisited.
- **Goal:** Expose an enterprise ecosystem gateway (`FR-INT-01`) allowing users in the central corporate AI chat assistant to query any authorized notebook via `@Notebook` mentions with identical source grounding and citations, and to export general chat threads into a new or existing notebook.
- **FRs:** FR-INT-01
- **Gate criteria (SRS §5.4):** Gate v6.0 #3 is deferred by D5/DEV-03 and is not required for the current v6 release. The retained criteria below apply only after an explicit reinstatement decision.
- **Out of scope:** Third-party unauthenticated webhook consumers.

**Cross-package rules:** [Binding scope, roles, lifecycle, quotas and validation](../README.md#binding-cross-package-rules).

---

### FR-INT-01 — Central Enterprise Chat Integration (`@Notebook` Mention & Thread Export)

| Field | Value |
| :- | :- |
| Release / Package | Unscheduled / 6.3 (original v6.0 allocation) |
| Status | Deferred (D5) |
| Priority (within package) | P1 |
| Actors | Owner/Editor, Viewer (Full), Viewer (Chat-Only) |
| Depends on | FR-WM-05, FR-GC-01, FR-GC-02, NFR-SEC-02, C-02 |
| Reference provenance (unverified) | 2026-10-15, Gemini App `@NotebookLM` extension & SRS §3.6 |

**Requirement (EARS)**
- *Event:* When an authenticated user in the central Enterprise Chat application types `@` (or `@Notebook`), the `Ecosystem Gateway` shall return an autocomplete list of notebooks the user has permission to access (`Owner`, `Editor`, `Viewer Full`, or `Viewer Chat-Only` per `FR-WM-05`).
- *Event:* When the user submits a prompt mentioning `@<Notebook Title>` in the central Enterprise Chat, the `Ecosystem Gateway` shall route the query to the target notebook's `Grounded Reasoning & Citation Agent` (`FR-GC-01`, `FR-GC-02`) using `ScopedContextProvider` (`Contract C-02`), and return the strictly source-grounded response including inline citations `[n]` and a deep-link back to the notebook.
- *Event:* When a user in the central Enterprise Chat clicks `"Export to Everlast LM"` (`"Als Notebook / Quelle exportieren"`) on an ongoing chat thread, the system shall either create a new notebook containing the thread transcript as a `Ready` source or append the thread transcript as a new source to a user-selected existing notebook (where the user is `Owner` or `Editor`).

**User story:** As an enterprise employee working inside the main company AI assistant, I want to type `@Notebook` to query my team's verified notebooks without switching apps, and export brainstorming threads directly into a notebook for deeper Studio synthesis.

**Reference behaviour**
1. In the main Gemini / Enterprise Chat interface, typing `@Notebook` opens a picker showing the user's recent and shared notebooks.
2. Selecting `@Q4 Security Policy` and asking `"What are our password rotation rules?"` invokes the Gemini Notebook grounding engine and displays the cited answer with a link to open the notebook.
3. Clicking `"Save to Notebook"` on a general chat thread imports the conversation into a new or existing notebook.

Evidence: `SRS §3.6 FR-INT-01`, `SRS §5.4 Gate v6.0 #3`

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| `@Notebook` query payload | `{ notebook_id, query, active_source_ids }` + authenticated application session; no arbitrary external history is trusted as notebook evidence | User must hold $\ge$ `viewer_chat_only` role on `notebook_id` | All `Ready` sources in `notebook_id` |
| Thread export payload | `{ target_notebook_id (optional), title, messages: [...] }` | User must hold `owner` or `editor` role if `target_notebook_id` is specified | Creates new notebook if `target_notebook_id` is null |

**Outputs & state**
- Visible: Autocomplete dropdown of authorized notebooks; grounded response with citations `[n]` in the external chat; deep-link to `/notebook/<notebook_id>`.
- Persisted: Imported chat thread saved as a `Source` (`media_type: 'exported_chat'`) and `UnifiedDocumentChunk` records (`Contract C-01`).
- States: `MentionSelected` $\rightarrow$ `GatewayRouting` $\rightarrow$ `GroundedReplyReturned`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: @Notebook mention in external Enterprise Chat returns identically grounded answers (Gate v6.0 #3)
  Given Notebook N1 contains a Ready source stating "Release freeze starts on November 12"
  And User U1 has "viewer_chat_only" access to N1
  When U1 queries "@N1 When does the release freeze start?" from the external Enterprise Chat
  Then the Ecosystem Gateway invokes N1's Grounded Reasoning & Citation Agent
  And returns "November 12" with inline citation [1] matching the internal notebook chat behaviour
  When U1 queries "@N1 What is the capital of France?"
  And no source in N1 mentions France
  Then the response refuses to answer from world knowledge per FR-GC-01

Scenario: Unauthorized user cannot query or autocomplete a private notebook via @Notebook
  Given Notebook N_private belongs to User A and is not shared with User B
  When User B types "@N_private" or calls the Ecosystem Gateway API for N_private
  Then N_private does not appear in autocomplete and the API returns HTTP 403 Forbidden
```

**Edge & error cases**
- Target notebook has `viewer_chat_only` permission for the calling user $\rightarrow$ `@Notebook` response includes citation text/badges `[n]`, while deep-links to raw source documents are omitted (`Gate v6.0 #1`).

**Measurable criteria**
- Grounding faithfulness ($\epsilon_{\text{hallucination}} < 0.05$), citation precision ($\text{Precision}_{\text{ID}} = 1.0$), and negative rejection ($\ge 99\%$) via `@Notebook` gateway match internal notebook chat 1:1 (`Gate v6.0 #3`).

**Deviations from reference:** Deferred under D5/DEV-03. The architecture remains A2A-ready, but commits to no gateway or MCP implementation in the current release plan. Retained behavior is future scope, not permission to build it now.

**Out of scope:** Allowing `@Notebook` mentions from external unauthenticated Slack/Teams workspaces outside the corporate tenant.

**Open questions:** `None`
