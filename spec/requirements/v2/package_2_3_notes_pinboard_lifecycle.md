# Package 2.3 — Notes & Pinboard Lifecycle

- **Release:** v2.0
- **Goal:** Provide a persistent notes pinboard in the Right Panel supporting manual rich-text/Markdown notes, saving chat responses as notes, one-click conversion of notes into citable sources, and contextual AI actions across selected notes.
- **FRs:** FR-NM-01, FR-NM-02, FR-NM-03, FR-NM-04
- **Gate criteria (SRS §5.4):** Gate v2.0 #2 — Rundreise-Test bestanden: *Chat-Antwort $\rightarrow$ Als Notiz speichern $\rightarrow$ In Quelle umwandeln $\rightarrow$ Neue Quelle ist im nächsten Chat-Turn zitierbar*.
- **Out of scope:** Real-time multi-cursor collaborative editing inside a single note (`v6.0` supports notebook-level sharing).

**Cross-package rules:** [Binding scope, roles, lifecycle, quotas and validation](../README.md#binding-cross-package-rules).

---

### FR-NM-01 — Manual Note Creation & Editing

| Field | Value |
| :- | :- |
| Release / Package | v2.0 / 2.3 |
| Priority (within package) | P1 |
| Actors | Owner/Editor, Viewer (read-only) |
| Depends on | FR-WM-01, FR-UI-01 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

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
- Closing the editor flushes pending saves before reporting success. Abrupt browser termination/offline state cannot guarantee a network flush: retain a local draft, show pending/error status, and recover it on reopening; never falsely show unsaved edits as saved.

**Measurable criteria**
- Auto-save persists changes within $\le 1.0\text{ s}$ of typing pause.

**Deviations from reference:** None.

**Out of scope:** Embedding raw binary attachments directly inside a note.

**Open questions:** `None`

---

**Shared save-note contract with FR-GC-09 (binding DTO)**: `POST /api/notebooks/{notebook_id}/chat/messages/{message_id}/note` accepts `{ "notebook_id": "<UUID>", "message_id": "<UUID>" }`; user identity comes only from authenticated API context. It returns `{ "note": { "id": "<UUID>", "notebook_id": "<UUID>", "source_message_id": "<UUID>", "title": "<1–200 Unicode code points>", "content_md": "<full response with inline citation markers>", "citations_json": [<Package 1.3 Citation>], "origin_type": "saved_response", "read_only": true, "created_at": "<ISO datetime>" } }`. The operation is idempotent on `(authenticated user_id, source_message_id)` and copies citation metadata so chat deletion does not cascade to the note. Package 2.2 FR-GC-09 MUST consume this same request/response shape.

### FR-NM-02 — Save Chat Response as Note

| Field | Value |
| :- | :- |
| Release / Package | v2.0 / 2.3 |
| Priority (within package) | P1 |
| Actors | Owner/Editor |
| Depends on | FR-GC-02, FR-NM-01; invoked by FR-GC-09 through the shared save-note action |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

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
| `message_id` | UUID | Must belong to the requesting user's assistant message in `notebook_id`; copy text/citation metadata independently so clearing the chat does not cascade-delete the note | — |

**Outputs & state**
- Visible: New note entry in the Right Panel list; toast confirmation `"Saved to notes"`.
- Persisted: `Note` entity (`origin_type: 'saved_response'`, `source_message_id`, `content_md`, `citations_json`).
- States: `SavedReadOnly` (with option to copy or convert to editable note / source). Converting to editable creates a manual copy, preserves origin metadata, and removes verified citation badges from editable prose so edits cannot masquerade as verified claims; the original saved response remains unchanged.

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
- Note saved from a response that had $0$ citations (e.g., a refusal or non-factual conversational message; factual summaries require citations) $\rightarrow$ Saved cleanly without citation badges.

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
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the Owner/Editor opens a note in the Right Panel and clicks `"Convert to source"` (`"In Quelle umwandeln"`), or selects multiple notes and clicks `"Convert selected to source"`, or chooses `"Convert all notes to source"` for all notebook notes, the system shall pass the Markdown content of the note(s) to the Markdown Ingestion Parser (`FR-SI-01`), create one new `Source` record in the Left Panel (multiple notes are concatenated in displayed order under their titles), chunk it into `UnifiedDocumentChunk` records (`Contract C-01`), and mark the new source as `Ready` and selected ($s_{\text{new}} \in S_{\text{aktiv}}$).
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
| `note_ids` | Array of $1..M$ UUIDs | All IDs must belong to the current notebook and be readable; combined content must be non-empty and obey both per-source limits; atomically reserve one source slot (`FR-WM-07`) | — |

**Outputs & state**
- Visible: New `Ready` source in Left Panel (`Sources`) with checkbox selected; active source count increments by $1$.
- Persisted: New `Source` (`media_type: 'note_markdown'`, origin note IDs and revision snapshot; preserved old citations are provenance, while new answers cite the converted source's own C-01 chunks) and `UnifiedDocumentChunk` records (`C-01`).
- States: `Note` $\rightarrow$ `IngestingAsSource` $\rightarrow$ `SourceReady`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Full Gate v2.0 roundtrip (Chat -> Note -> Source -> Cited in Chat)
  Given a notebook with 1 source "Raw_Data.pdf" stating "Project codename is TITAN-77"
  When the user asks for the project codename in Chat and saves the cited answer as a note
  And the user converts that exact saved-response note to a source without editing it
  Then a new source appears in the Left Panel in state "Ready" and is checked
  When the user selects only the converted source and asks in Chat "What is the project codename?"
  Then the assistant answers "TITAN-77" with a citation [1] pointing to the converted note source

Scenario: Multiple notes produce one bounded source
  Given three non-empty notes in the current notebook and one free source slot
  When the owner converts the selected notes whose combined text fits the per-source limits
  Then exactly one source contains all three notes in displayed order under their titles
  And the original notes remain unchanged
  And subsequent edits to a note do not alter the converted source
```

**Edge & error cases**
- Notebook is already at $N_{\text{max}}$ sources (`50 / 50`) $\rightarrow$ `"Convert to source"` is disabled with tooltip `"Source limit reached"`.
- Combined note body is empty/whitespace-only $\rightarrow$ conversion is disabled. A single note retains its title; a multi-note source uses `Combined notes`. Reject combined content over either source limit without consuming a slot; never silently truncate. "Displayed order" means `display_order` ascending; a note title over 100 code points is clamped for the source title (full title kept as first heading); "Convert all notes" has no note-count cap.

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
| Depends on | FR-NM-01, FR-NM-03, FR-GC-01, C-02 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the Owner/Editor selects one or more notes via checkboxes in the Notes view (or opens a single note), the system shall display a contextual action bar with four AI operations:
  1. `"Summarize"` (`"Zusammenfassen"`)
  2. `"Create outline"` (`"Gliederung erstellen"`)
  3. `"Suggest related ideas"` (`"Verwandte Ideen vorschlagen"` — grounded in $S_{\text{aktiv}}$)
  4. `"Critique"` (`"Kritik / Review"`)
- *Event:* When the user clicks one of these actions, the `Note Assistant` agent shall show in the action label/help that it creates a source snapshot from the selected notes. Clicking the action authorizes FR-NM-03 conversion of that exact selection into one source and selects it for this request; await Ready before synthesis. Apply normal source quotas and preserve the notes. Summarize/Outline use that note-source alone; Related ideas/Critique also use the explicitly selected existing sources. All factual output cites the resulting active C-01 chunks through C-02 and distinguishes user-note assertions from other source facts. Display the validated result as a ChatMessage; saving it as a note uses FR-NM-02.

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
- Visible: Citation-validated synthesis response in Chat, with Save to note available.
- Persisted: `ChatMessage` containing the output; a separate `Note` only on Save to note.
- States: `NotesSelected` $\rightarrow$ `Synthesizing` $\rightarrow$ `Completed`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Critique selected note against active notebook sources
  Given a manual note stating "Deployment requires zero downtime"
  And an active source stating "Migration requires a 4-hour maintenance window"
  When the owner selects the note and clicks "Critique"
  Then the AI highlights the discrepancy between the note and the source with a citation

Scenario: Summarize notes without inventing a separate grounding path
  Given a notebook with selected non-empty notes, no selected sources, and one free source slot
  When the owner clicks Summarize labelled as creating a source snapshot
  Then FR-NM-03 creates and selects one source from those notes
  And the model runs only after that source is Ready and obtained through C-02
  And the validated summary cites that source and preserves the original notes
```

**Edge & error cases**
- `"Suggest related ideas"` clicked when $0$ sources are selected in the Left Panel $\rightarrow$ Prompts the user to select an existing comparison source before Related ideas/Critique. Summarize/Outline can start with notes alone because the disclosed conversion supplies a Ready source before generation. Failed conversion or exhausted quota produces an error and no model call.

**Measurable criteria**
- After the note snapshot reaches Ready, validated answer TTFT for a standard note operation is $\le 2.5\text{ s}$; conversion uses the FR-NM-03 timing criterion and is shown as a separate progress phase.

**Deviations from reference:** In newer Gemini Notebook UI iterations, some note-combining actions moved into Studio Report prompts; we retain the explicit 4-action bar (`FR-NM-04`) so users can act directly on subsets of notes.

**Out of scope:** None.

**Open questions:** `None`
