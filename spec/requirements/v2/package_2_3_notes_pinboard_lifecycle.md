# Package 2.3 — Notes & Pinboard Lifecycle

- **Release:** v2.0
- **Goal:** Provide a persistent notes pinboard in the Right Panel supporting manual rich-text/Markdown notes, saving chat responses as notes, one-click conversion of notes into citable sources, and contextual AI actions across selected notes.
- **FRs:** FR-NM-01, FR-NM-02, FR-NM-03, FR-NM-04
- **Gate criteria (SRS §5.4):** Gate v2.0 #2 — Rundreise-Test bestanden: *Chat-Antwort $\rightarrow$ Als Notiz speichern $\rightarrow$ In Quelle umwandeln $\rightarrow$ Neue Quelle ist im nächsten Chat-Turn zitierbar*.
- **Out of scope:** Real-time multi-cursor collaborative editing inside a single note (`v6.0` supports notebook-level sharing).

---

### FR-NM-01 — Manual Note Creation & Editing

| Field | Value |
| :- | :- |
| Release / Package | v2.0 / 2.3 |
| Priority (within package) | P1 |
| Actors | Owner/Editor, Viewer (read-only) |
| Depends on | FR-WM-01, FR-UI-01 |
| Observed | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the Owner/Editor clicks `"+ Add note"` (`"+ Notiz hinzufügen"`) in the Right Panel (`Studio / Notes`), the system shall create a new editable note record, open the Note Editor view inside the Right Panel, and focus the content area.
- *Ubiquitous:* The Note Editor shall support an editable title and rich-text/Markdown formatting (headings, bold, italic, bulleted/numbered lists, links) with automatic debounced persistence (`Auto-Save`).
- *Event:* When the Owner/Editor clicks the delete icon inside a note or selects `"Delete"` from the note card menu and confirms, the system shall permanently remove the note from the notebook.

**User story:** As a researcher, I want to write, format, and organize my own notes alongside my sources and chat, so that I can capture hypotheses and synthesis in one workspace.

**Reference behaviour**
1. In the Right Panel (`Studio`), under the Notes / Artifacts list, the user clicks `+ Add note`.
2. The Right Panel opens a focused Note Editor with a title input (`"New note"`) and a rich-text formatting toolbar (H1, H2, Bold, Italic, Lists).
3. Changes save automatically as the user types.
4. Closing the editor returns to the list where the note card appears with a note icon and title.

Evidence: `https://support.google.com/notebooklm/answer/16164461`, `SRS §3.4 FR-NM-01` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Note title | UTF-8 string | $1\text{–}200$ characters | `"New note"` (`"Neue Notiz"`) |
| Note body | Markdown / sanitized HTML | $0\text{–}100,000$ words | Empty |

**Outputs & state**
- Visible: Note item in the Right Panel list; full Note Editor view when opened.
- Persisted: `Note` entity (`id`, `notebook_id`, `title`, `content_md`, `origin_type: 'manual' | 'saved_response'`, `created_at`, `updated_at`).
- States: `Drafting` $\rightarrow$ `Saved` $\rightarrow$ `Deleted`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Create and auto-save a manual note
  Given an open notebook
  When the owner clicks "+ Add note" in the Right Panel
  And enters title "Key Audit Findings" and body "## Risk 1\nMissing mTLS on port 8080"
  And closes the note editor
  Then the note "Key Audit Findings" is listed in the Right Panel
  And reopening the note displays the saved Markdown content
```

**Edge & error cases**
- Browser tab closes mid-typing $\rightarrow$ Auto-save debounce ($\le 1,000\text{ ms}$) and `beforeunload` flush preserve the latest text.

**Measurable criteria**
- Auto-save persists changes within $\le 1.0\text{ s}$ of typing pause.

**Deviations from reference:** None.

**Out of scope:** Embedding raw binary attachments directly inside a note.

**Open questions:** `None`

---

### FR-NM-02 — Save Chat Response as Note

| Field | Value |
| :- | :- |
| Release / Package | v2.0 / 2.3 |
| Priority (within package) | P1 |
| Actors | Owner/Editor |
| Depends on | FR-GC-09, FR-NM-01 |
| Observed | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the Owner/Editor clicks `"Save to note"` (`"Als Notiz speichern"`) on an assistant chat response (`FR-GC-09`), the system shall create a new `Note` record in the Right Panel containing the full response text, an auto-generated or prompt-derived title, and its preserved inline citations.
- *State:* While viewing a `Saved response` note in the Note Viewer, the system shall preserve working inline citation badges (`[1]`, `[2]`) that open the Source Inspector (`FR-SI-04`) when clicked.

**User story:** As a knowledge worker, I want to save valuable chat answers—including their working source citations—into my notes list with a single click, so that I never lose important findings when the conversation continues or is cleared.

**Reference behaviour**
1. User clicks `"Save to note"` at the bottom of a chat answer.
2. A new item immediately appears in the Right Panel list labeled as a saved response with an auto-generated title.
3. Clicking the saved note opens it in the Right Panel, displaying the formatted answer and its interactive citation badges.
4. Even if the user subsequently clears the Chat history (`FR-GC-06`), the saved note and its citations remain intact.

Evidence: `https://support.google.com/notebooklm/answer/16164461`, `SRS §3.4 FR-NM-02` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| `message_id` | UUID | Must belong to an assistant message in `notebook_id` | — |

**Outputs & state**
- Visible: New note entry in the Right Panel list; toast confirmation `"Saved to notes"`.
- Persisted: `Note` entity (`origin_type: 'saved_response'`, `source_message_id`, `content_md`, `citations_json`).
- States: `SavedReadOnly` (with option to copy or convert to editable note / source).

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Saved chat response survives clearing chat history
  Given an assistant response citing [1] from "Spec.pdf"
  When the owner clicks "Save to note" on that response
  And then clicks "Clear chat" in the Chat panel
  Then the Chat panel is empty
  And the saved note still exists in the Right Panel with a working [1] citation to "Spec.pdf"
```

**Edge & error cases**
- Note saved from a response that had $0$ citations (e.g., general summary) $\rightarrow$ Saved cleanly without citation badges.

**Measurable criteria**
- `"Save to note"` creates and renders the note item in the Right Panel in $\le 300\text{ ms}$.

**Deviations from reference:** In reference Gemini Notebook, saved chat responses are initially read-only (`Saved responses cannot be edited`) to protect citation integrity; we preserve this behaviour and allow `"Convert to editable note"` if the user wishes to modify the text.

**Out of scope:** None.

**Open questions:** `None`

---

### FR-NM-03 — Convert Note(s) to Source (1-Click Roundtrip)

| Field | Value |
| :- | :- |
| Release / Package | v2.0 / 2.3 |
| Priority (within package) | P1 |
| Actors | Owner/Editor |
| Depends on | FR-NM-01, FR-NM-02, FR-SI-01, C-01 |
| Observed | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the Owner/Editor opens a note in the Right Panel and clicks `"Convert to source"` (`"In Quelle umwandeln"`), or selects multiple notes and clicks `"Convert all notes to source"`, the system shall pass the Markdown content of the note(s) to the Markdown Ingestion Parser (`FR-SI-01`), create a new `Source` record in the Left Panel, chunk it into `UnifiedDocumentChunk` records (`Contract C-01`), and mark the new source as `Ready` and selected ($s_{\text{new}} \in S_{\text{aktiv}}$).
- *Ubiquitous:* Converting a note to a source shall keep the original note in the Right Panel unless the user explicitly deletes it.

**User story:** As an analyst, I want to convert my curated notes or saved AI syntheses back into formal notebook sources with one click, so that subsequent chat queries and Studio generators can ground and cite my synthesized findings.

**Reference behaviour**
1. User opens a note in the Right Panel and clicks the bottom button `"Convert to source"` (or clicks the three-dot menu in the Notes section and selects `"Convert all notes to source"`).
2. A new source with a note/text icon and the note's title appears in the Left Panel (`Sources`), transitions to `Ready`, and is checked by default.
3. In the next chat turn, the assistant can cite facts from the newly created note-source via inline badges `[n]`.

Evidence: `https://support.google.com/notebooklm/answer/16164461`, `SRS §3.4 FR-NM-03` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| `note_ids` | Array of $1..M$ UUIDs | Non-empty content; notebook must be under source quota $N_{\text{max}}$ (`FR-WM-07`) | — |

**Outputs & state**
- Visible: New `Ready` source in Left Panel (`Sources`) with checkbox selected; active source count increments by $1$.
- Persisted: New `Source` (`media_type: 'note_markdown'`) and `UnifiedDocumentChunk` records (`C-01`).
- States: `Note` $\rightarrow$ `IngestingAsSource` $\rightarrow$ `SourceReady`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Full Gate v2.0 roundtrip (Chat -> Note -> Source -> Cited in Chat)
  Given a notebook with 1 source "Raw_Data.pdf"
  When the user asks a question in Chat and clicks "Save to note" on the answer
  And the user adds manual insight "Project codename is TITAN-77" to a note and clicks "Convert to source"
  Then a new source appears in the Left Panel in state "Ready" and is checked
  When the user asks in Chat "What is the project codename?"
  Then the assistant answers "TITAN-77" with a citation [1] pointing to the converted note source
```

**Edge & error cases**
- Notebook is already at $N_{\text{max}}$ sources (`50 / 50`) $\rightarrow$ `"Convert to source"` is disabled with tooltip `"Source limit reached"`.
- Note body is completely empty $\rightarrow$ `"Convert to source"` is disabled.

**Measurable criteria**
- Converting a note ($\le 5,000$ words) into a citable `Ready` source completes in $\le 2.0\text{ s}$ (`Gate v2.0 #2`).

**Deviations from reference:** None.

**Out of scope:** Live two-way synchronization between the note and the converted source after conversion (editing the note later requires re-converting or replacing).

**Open questions:** `None`

---

### FR-NM-04 — Contextual AI Operations on Selected Notes

| Field | Value |
| :- | :- |
| Release / Package | v2.0 / 2.3 |
| Priority (within package) | P2 |
| Actors | Owner/Editor |
| Depends on | FR-NM-01, FR-GC-01, C-02 |
| Observed | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the Owner/Editor selects one or more notes via checkboxes in the Notes view (or opens a single note), the system shall display a contextual action bar with four AI operations:
  1. `"Summarize"` (`"Zusammenfassen"`)
  2. `"Create outline"` (`"Gliederung erstellen"`)
  3. `"Suggest related ideas"` (`"Verwandte Ideen vorschlagen"` — grounded in $S_{\text{aktiv}}$)
  4. `"Critique"` (`"Kritik / Review"`)
- *Event:* When the user clicks one of these actions, the `Note Assistant` agent shall process the selected note contents (alongside $S_{\text{aktiv}}$ for `"Suggest related ideas"` and `"Critique"`) and output the result in the Chat / new Note card.

**User story:** As a writer, I want to select several raw notes and have the AI combine them into an outline, summarize them, critique my arguments, or suggest related ideas from my sources, so that I can turn scattered notes into structured documents.

**Reference behaviour**
1. User selects $3$ notes in the Notes view.
2. Action pills appear (`Summarize`, `Create study guide / outline`, `Suggest related ideas`, `Critique`).
3. Clicking `Create outline` synthesizes a structured outline from the $3$ selected notes and saves/displays the result.

Evidence: `https://support.google.com/notebooklm/answer/16164461`, `SRS §3.4 FR-NM-04` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| `selected_note_ids` | Array of UUIDs | $1 \le k \le 50$ notes | — |
| `action_type` | Enum | `summarize` \| `outline` \| `related_ideas` \| `critique` | — |

**Outputs & state**
- Visible: Streamed synthesis response in Chat / saved as a new synthesized Note card in the Right Panel.
- Persisted: New `Note` or `ChatMessage` containing the output.
- States: `NotesSelected` $\rightarrow$ `Synthesizing` $\rightarrow$ `Completed`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Critique selected note against active notebook sources
  Given a manual note stating "Deployment requires zero downtime"
  And an active source stating "Migration requires a 4-hour maintenance window"
  When the owner selects the note and clicks "Critique"
  Then the AI highlights the discrepancy between the note and the source with a citation
```

**Edge & error cases**
- `"Suggest related ideas"` clicked when $0$ sources are selected in the Left Panel $\rightarrow$ Prompts user to select at least one source or generates suggestions strictly from the selected notes' internal content.

**Measurable criteria**
- Time-to-First-Token for note operations $\le 2.5\text{ s}$.

**Deviations from reference:** In newer Gemini Notebook UI iterations, some note-combining actions moved into Studio Report prompts; we retain the explicit 4-action bar (`FR-NM-04`) so users can act directly on subsets of notes.

**Out of scope:** None.

**Open questions:** `None`