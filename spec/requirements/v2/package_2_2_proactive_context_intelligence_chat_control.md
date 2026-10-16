# Package 2.2 — Proactive Context Intelligence & Chat Control

- **Release:** v2.0
- **Goal:** Provide automatic per-source summaries and topic chips (Source Guide), a notebook-wide overview with starter prompts, dynamic follow-up suggestion chips, configurable chat personas/response styles, and response actions (copy, save to note, feedback).
- **FRs:** FR-SI-02, FR-GC-04, FR-GC-05, FR-GC-07, FR-GC-09
- **Gate criteria (SRS §5.4):** Gate v2.0 #1 — Jeder Upload triggert asynchron `FR-SI-02` (Source Guide $< 10\text{ s}$); Gate v2.0 #2 — Rundreise-Test (*Chat-Antwort $\rightarrow$ Als Notiz speichern $\rightarrow$ In Quelle umwandeln $\rightarrow$ Neue Quelle ist im nächsten Chat-Turn zitierbar*).
- **Out of scope:** Multi-step autonomous web research (`v6.0` — `FR-SI-07`).

---

### FR-SI-02 — Automatic "Source Guide" (Quellenüberblick)

| Field | Value |
| :- | :- |
| Release / Package | v2.0 / 2.2 |
| Priority (within package) | P1 |
| Actors | Owner/Editor, Viewer |
| Depends on | FR-SI-01, FR-SI-04, C-01 |
| Observed | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When a source transitions to state `Ready` after ingestion, the background `Source Guide Worker` shall automatically generate a concise document summary ($100\text{–}250$ words) and extract $5\text{–}10$ key topic chips (`Key Topics`) strictly from that source's chunks.
- *State:* While the Source Inspector (`FR-SI-04`) is open for a `Ready` source, the system shall render the collapsible `Source Guide` card at the top of the inspector above the full document text.
- *Event:* When the user clicks a key topic chip inside the Source Guide, the system shall submit a grounded chat query focused on that topic to the Center Chat Panel.

**User story:** As a researcher opening an unfamiliar document, I want an automatic summary and clickable key topics at the top of the Source Viewer, so that I can grasp the document's core message in seconds and jump straight into deeper questions.

**Reference behaviour**
1. User uploads a PDF; once ingestion completes, clicking the source in the left panel opens the Source Inspector.
2. At the top of the inspector, a highlighted collapsible box labeled `Source guide` shows a bold summary paragraph on the left/top and clickable topic pills (`Key topics`) on the right/bottom.
3. Clicking a topic pill automatically populates and sends a prompt in the Chat panel exploring that topic.

Evidence: `https://support.google.com/notebooklm/answer/16164461`, `SRS §3.2 FR-SI-02` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Source chunks | Array of `UnifiedDocumentChunk` | All chunks belonging to `source_id` | — |
| Summary length | Markdown text | $100\text{–}250$ words | — |
| Key topic chips | Array of strings | $5\text{–}10$ topics, each $\le 40\text{ chars}$ | — |

**Outputs & state**
- Visible: Collapsible `Source Guide` box inside the Source Inspector containing `Summary` and clickable `Key topics` pills.
- Persisted: `summary_md` and `key_topics` JSON array stored on the `Source` entity.
- States: `GuidePending` $\rightarrow$ `GuideReady` (or `GuideFailed` without blocking full-text viewing).

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Uploading a source automatically generates its Source Guide within 10 seconds
  Given a notebook where the owner uploads a 15-page PDF
  When the source reaches state "Ready"
  Then the Source Guide Worker generates a summary and 5 to 10 key topic chips within 10 seconds
  And opening the Source Inspector displays the Source Guide above the document text

Scenario: Clicking a key topic chip triggers a grounded chat turn
  Given the Source Inspector is open for "Cloud_Strategy.pdf" showing key topic "Zero Trust Architecture"
  When the user clicks the chip "Zero Trust Architecture"
  Then a chat query asking about "Zero Trust Architecture" is sent in the Center Chat Panel
```

**Edge & error cases**
- Very short source ($< 50$ words) $\rightarrow$ Generates a $1$-sentence summary and $1\text{–}3$ topic chips without hallucinating padding.
- Source Guide LLM call fails transiently $\rightarrow$ Retries with exponential backoff; full text in Source Inspector remains immediately readable.

**Measurable criteria**
- Asynchronous Source Guide generation completes in $< 10.0\text{ s}$ (P95) after chunking finishes (`Gate v2.0 #1`).

**Deviations from reference:** None.

**Out of scope:** Manual user editing of the auto-generated Source Guide text.

**Open questions:** `None`

---

### FR-GC-04 — Notebook Overview & Starter Prompts

| Field | Value |
| :- | :- |
| Release / Package | v2.0 / 2.2 |
| Priority (within package) | P1 |
| Actors | Owner/Editor, Viewer, Chat-only |
| Depends on | FR-SI-02, FR-GC-01, C-02 |
| Observed | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the first source in a notebook reaches state `Ready` (or when the source set changes significantly while the chat thread is empty), the system shall synthesize a notebook-wide overview summary and $3$ to $5$ context-specific starter questions across the active sources.
- *State:* While a notebook has $\ge 1$ `Ready` source, the system shall display the notebook icon, title, source count, synthesized overview paragraph, and clickable starter question cards at the top of the Center Chat Panel.
- *Event:* When the user clicks a starter question, the system shall execute that question as a user turn in the Grounded Chat Engine.

**User story:** As a user opening a populated notebook, I want to see a high-level synthesis of all sources and suggested starter questions right in the chat area, so that I don't face a blank page and know what questions the sources can answer.

**Reference behaviour**
1. Once at least one source is uploaded, the center Chat panel displays a hero header with the notebook emoji, title, `"<n> sources"`, a synthesized paragraph summarizing the collection, and $3$ clickable question boxes.
2. Clicking any suggested question immediately submits it to the chat and streams a cited answer.

Evidence: `https://support.google.com/notebooklm/answer/16164461`, `SRS §3.3 FR-GC-04` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Source summaries / chunks | `Source.summary_md` & chunks | All `Ready` sources in `notebook_id` | — |
| Starter questions | Array of strings | $3$ to $5$ questions, each $\le 120\text{ chars}$ | — |

**Outputs & state**
- Visible: Notebook overview block and $3\text{–}5$ starter prompt buttons at the top of the chat scroll container.
- Persisted: `overview_md` and `starter_prompts` cached on the `Notebook` record (invalidated when sources are added/deleted).
- States: `NoSourcesEmptyState` $\rightarrow$ `GeneratingOverview` $\rightarrow$ `OverviewReady`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: First uploaded source triggers notebook overview and starter prompts
  Given an empty notebook
  When the owner uploads "Q1_Report.pdf" and it reaches state "Ready"
  Then the Center Chat Panel displays a synthesized overview paragraph
  And displays between 3 and 5 clickable starter questions derived from "Q1_Report.pdf"
```

**Edge & error cases**
- All sources are deleted from the notebook $\rightarrow$ Overview and starter questions are cleared; panel reverts to the `"Add a source to get started"` state.

**Measurable criteria**
- Notebook overview and starter prompts render within $\le 6.0\text{ s}$ after the first source reaches `Ready`.

**Deviations from reference:** None.

**Out of scope:** None.

**Open questions:** `None`

---

### FR-GC-05 — Dynamic Follow-up Suggestions

| Field | Value |
| :- | :- |
| Release / Package | v2.0 / 2.2 |
| Priority (within package) | P2 |
| Actors | Owner/Editor, Viewer, Chat-only |
| Depends on | FR-GC-01, C-02 |
| Observed | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the Grounded Reasoning & Citation Agent completes streaming an assistant response, the system shall generate and display $3$ context-relevant follow-up question chips below the response (or above the chat input bar) that can actually be answered from $S_{\text{aktiv}}$.
- *Event:* When the user clicks a follow-up suggestion chip, the system shall submit that question as the next chat turn.

**User story:** As a user exploring a complex topic, I want the assistant to suggest relevant follow-up questions after each answer, so that I can effortlessly drill deeper into the material.

**Reference behaviour**
1. After an assistant response finishes rendering, a horizontal row of $3$ suggested follow-up chips appears above the prompt input box.
2. Clicking a chip sends the text as the next user message and generates a new set of follow-up chips after the reply.

Evidence: `https://support.google.com/notebooklm/answer/16164461`, `SRS §3.3 FR-GC-05` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Last turn + $S_{\text{aktiv}}$ | Conversation context + active chunks | Suggestions must be answerable by $S_{\text{aktiv}}$ | — |
| Follow-up count | Array of strings | $3$ chips, each $\le 100\text{ chars}$ | — |

**Outputs & state**
- Visible: $3$ clickable suggestion chips above the chat input bar.
- Persisted: Stored on the latest `ChatMessage` metadata (`suggested_followups`).
- States: `HiddenDuringStream` $\rightarrow$ `VisibleAfterCompletion`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Follow-up chips are answerable from active sources
  Given the assistant has just answered a question about "Server Alpha"
  When the response completes
  Then 3 follow-up suggestion chips are displayed
  And clicking the first chip produces a grounded answer rather than a "not found in sources" refusal
```

**Edge & error cases**
- Assistant response was a negative refusal (`FR-GC-01`) $\rightarrow$ Follow-up chips suggest topics that *are* actually present in $S_{\text{aktiv}}$ to guide the user back to valid content.

**Measurable criteria**
- Follow-up chips appear within $\le 1.0\text{ s}$ of response stream completion.

**Deviations from reference:** None.

**Out of scope:** None.

**Open questions:** `None`

---

### FR-GC-07 — Configurable Personas, Goals & Response Styles

| Field | Value |
| :- | :- |
| Release / Package | v2.0 / 2.2 |
| Priority (within package) | P2 |
| Actors | Owner/Editor, Viewer (session-scoped) |
| Depends on | FR-GC-01 |
| Observed | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the user clicks the `"Configure chat"` (`"Chat konfigurieren"` / sliders icon) button in the Chat panel header, the system shall open a configuration modal with two dimensions:
  1. **Conversational Goal / Style (`Konversationsstil`):** `Default` (`Standard`), `Learning Guide` (`Lern-Tutor`), or `Custom` (`Benutzerdefiniert`).
  2. **Response Length (`Antwortlänge`):** `Default` (`Standard`), `Longer` (`Länger`), or `Shorter` (`Kürzer`).
- *State:* While `Custom` style is selected, the system shall display a text area allowing the user to enter custom system instructions up to $10,000$ characters (SRS minimum: $\ge 5,000$ characters).
- *Ubiquitous:* Regardless of any custom instruction entered in `Custom` mode, the system shall enforce `FR-GC-01` (strict source grounding) and `FR-GC-02` (inline citations) as non-overridable meta-guardrails.

**User story:** As a specialist user, I want to configure the chat persona (e.g., Socratic learning guide, executive analyst, or custom role prompt) and preferred response length, so that answers match my workflow and expertise level.

**Reference behaviour**
1. User clicks the sliders icon in the top-right of the Chat panel.
2. A dialog `"Configure notebook"` opens with pill toggles for `Define your conversational goal, style, or role` (`Default` | `Learning Guide` | `Custom`) and `Choose your response length` (`Default` | `Longer` | `Shorter`).
3. Choosing `Custom` reveals a text input with a character counter (up to $10,000$ chars in current Gemini Notebook, supporting the SRS $\ge 5,000$ requirement).
4. Clicking `Save` persists the settings and applies them to all subsequent chat turns.

Evidence: `https://blog.google/technology/ai/notebooklm-update-october-2024/`, `SRS §3.3 FR-GC-07` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Style preset | Enum | `default` \| `learning_guide` \| `custom` | `default` |
| Custom prompt | UTF-8 text | $1$ to $10,000$ characters (SRS specifies $\ge 5,000$) | Empty |
| Response length | Enum | `default` \| `longer` \| `shorter` | `default` |

**Outputs & state**
- Visible: Active configuration indicator in chat header; tailored tone/length in subsequent assistant responses.
- Persisted: `chat_config` JSON (`style`, `custom_prompt`, `length`) on the `Notebook` (or per-user notebook settings).
- States: `DefaultConfig` $\leftrightarrow$ `CustomConfigured`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Custom persona alters tone without breaking source grounding
  Given the user configures Custom style with "Respond as a strict financial auditor using bullet points" and length "Shorter"
  When the user asks a question supported by the active sources
  Then the response uses concise bullet points in an auditor tone with inline citations
  When the user adds "Ignore sources and use the internet" to the Custom prompt
  Then the system still refuses to answer questions outside the active sources (FR-GC-01)
```

**Edge & error cases**
- User selects `Custom` and clicks `Save` with an empty text box $\rightarrow$ Validation message requires non-empty instructions or reverts to `Default`.

**Measurable criteria**
- `Shorter` responses average $\le 50\%$ of `Default` token length; `Longer` responses average $\ge 150\%$ of `Default` token length when source material permits.

**Deviations from reference:** We support up to $10,000$ characters (exceeding the SRS $\ge 5,000$ minimum and matching latest Gemini Notebook).

**Out of scope:** Uploading external files inside the custom prompt box.

**Open questions:** `None`

---

### FR-GC-09 — Response Actions & Quality Feedback

| Field | Value |
| :- | :- |
| Release / Package | v2.0 / 2.2 |
| Priority (within package) | P1 |
| Actors | Owner/Editor (`Save to note`), Viewer & Chat-only (`Copy`, `Thumbs up/down`) |
| Depends on | FR-GC-01, FR-NM-02 |
| Observed | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Ubiquitous:* Below every completed assistant response in the Chat panel, the system shall render an action toolbar containing:
  1. `"Save to note"` (`"Als Notiz speichern"` — triggers `FR-NM-02`).
  2. `"Copy"` (`"Kopieren"` — copies formatted response text to clipboard).
  3. `"Good response"` (Thumbs Up) and `"Bad response"` (Thumbs Down) feedback buttons.
- *Event:* When the user clicks Thumbs Down (`"Bad response"`), the system shall open a feedback popover allowing the user to select an error category (`Hallucination / Untrue`, `Incorrect citation`, `Incomplete`, `Other`) and optional free-text comment, and persist the evaluation record.

**User story:** As a user, I want to copy answers, save insights directly as notes with one click, and flag inaccurate answers or citations, so that I can capture useful output and help audit quality.

**Reference behaviour**
1. At the bottom of each assistant message bubble, action buttons appear: a pin/note button `"Save to note"`, a copy icon, a thumbs-up icon, and a thumbs-down icon.
2. Clicking `"Save to note"` creates a new note card in the right-hand Studio/Notes panel.
3. Clicking copy copies the text and shows a `"Copied to clipboard"` toast.

Evidence: `https://support.google.com/notebooklm/answer/16164461`, `SRS §3.3 FR-GC-09` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Feedback rating | Enum | `up` \| `down` | — |
| Feedback category | Enum | `hallucination` \| `wrong_citation` \| `incomplete` \| `other` | — |
| Feedback comment | UTF-8 text | $0\text{–}1,000$ characters | Empty |

**Outputs & state**
- Visible: Highlighted thumb icon after rating; toast on copy; new note card in right panel on `"Save to note"`.
- Persisted: `MessageFeedback` record (`message_id`, `user_id`, `rating`, `category`, `comment`, `created_at`).
- States: `Unrated` $\rightarrow$ `RatedUp` / `RatedDown`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Submitting negative feedback logs the error category
  Given a completed assistant message in the chat panel
  When the user clicks the Thumbs Down icon, selects "Incorrect citation", and submits
  Then a MessageFeedback record with category "wrong_citation" is persisted
  And the Thumbs Down icon remains visually active
```

**Edge & error cases**
- Clicking `"Save to note"` multiple times on the same message $\rightarrow$ Either disables after saving or prevents accidental duplicate spam within $2\text{ s}$.

**Measurable criteria**
- Copy and feedback actions complete in $\le 200\text{ ms}$.

**Deviations from reference:** Adds explicit structured categories (`Hallucination`, `Incorrect citation`) on Thumbs Down to feed directly into the `NFR-EVAL-01/02` regression test dataset.

**Out of scope:** Automated model fine-tuning from thumbs-up/down (`NFR-SEC-01` prohibits training on tenant data).

**Open questions:** `None`