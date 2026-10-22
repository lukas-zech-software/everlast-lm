# FR Card Template

Copy the card below once per functional requirement into the package file
(`spec/requirements/v<N>/package_<N>_<M>_<short_name>.md`). Write `Unknown` for anything you could not
observe; never guess. See [README.md](README.md) for what to extract and how to hand files over.

All cards inherit the [binding cross-package rules](README.md#binding-cross-package-rules).
Record target choices separately from unverified reference claims. The examples below do not
override the SRS, real cards, release roles, or architecture decisions.

## Card

````markdown
### FR-XX-NN — <Short title>

| Field | Value |
| :- | :- |
| Release / Package | v1.0 / 1.2 |
| Priority (within package) | P1 / P2 / P3 |
| Actors | Owner; from v6: Editor, Viewer Full, Chat-Only as applicable |
| Depends on | FR-…, C-0x |
| Evidence status | Verified capture path/date, or unverified reference; do not invent observation dates |

**Requirement (EARS)**
- *Event:* When <trigger>, the system shall <response>.
- *State:* While <state>, the system shall <response>.
- *Unwanted:* If <condition>, then the system shall <response>.
- *Optional:* Where <feature/variant applies>, the system shall <response>.
- *Ubiquitous:* The system shall <always-true property>.

**User story:** As a <role>, I want <goal>, so that <benefit>.

**Reference behaviour**
1. <step>
2. <step>

Evidence: `spec/evidence/FR-XX-NN/<file>.png`, <help URL>

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| | | | |

**Outputs & state**
- Visible: …
- Persisted: …
- States: a → b → c

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: <name>
  Given <state>
  When <action>
  Then <observable outcome>
```

**Edge & error cases**
- <condition> → <expected behaviour>

**Measurable criteria**
- <metric with number>

**Deviations from reference:** … (reason)

**Out of scope:** …

**Open questions:** …
````

## Package file header

Each package file starts with this header, followed by its FR cards.

````markdown
# Package <N.M> — <Name>

- **Release:** v<N>.0
- **Goal:** <one sentence describing the package's release goal>
- **FRs:** FR-…, FR-…
- **Gate criteria (release gates):** <copy the relevant gate items>
- **Out of scope:** …
````

## Card field → Spec Kit section

| Card field | `spec-template.md` section |
| :- | :- |
| User story, Priority, Reference behaviour | User Scenarios & Testing → User Story (Pn) |
| Gherkin scenarios | Acceptance Scenarios; "Independent Test" |
| Edge & error cases | Edge Cases |
| EARS statements, Inputs & limits, Actors | Functional Requirements (MUST) |
| Outputs & state | Key Entities |
| Measurable criteria | Success Criteria (SC-xxx) |
| Deviations, Out of scope, Depends on | Assumptions |
| Open questions | `[NEEDS CLARIFICATION]` (≤ 3 per spec) or resolved before specifying |

## Examples

> All concrete numbers and UI texts below are **illustrative**, not observed Gemini Notebook
> behaviour. They show the expected level of detail; replace them with what you observe.

### Example A — FR-WM-01 Notebook CRUD (simple)

| Field | Value |
| :- | :- |
| Release / Package | v1.0 / 1.1 |
| Priority | P1 |
| Actors | Owner (v1: owner only) |
| Depends on | FR-WM-04, C-02 |

**Requirement (EARS)**
- When a user selects "New notebook", the system shall create an empty notebook owned by that
  user and open it.
- When the owner renames a notebook, the system shall persist the new title and update the
  change timestamp.
- When the owner confirms deletion, the system shall permanently remove the notebook and all
  its sources, chats, notes and artifacts.
- If a title is empty after trimming, then the system shall reject the rename and keep the
  previous title.

**User story:** As a knowledge worker, I want to create, rename and delete notebooks, so that
each topic has its own isolated workspace.

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Title | text | 1–100 chars after trim | "Untitled notebook" |

**Acceptance criteria**

```gherkin
Scenario: Delete cascades
  Given a notebook with 2 sources, 1 chat and 1 note
  When the owner deletes it and confirms
  Then the notebook no longer appears in the overview
  And none of its sources, chats or notes can be retrieved via the API
```

**Edge & error cases**
- Delete dialog cancelled → nothing changes.
- Notebook deleted in another tab → the open tab shows "Notebook no longer exists" and returns
  to the overview.

**Measurable criteria:** The created notebook is visible in the overview in ≤ 1 s.

**Out of scope:** Restoring deleted notebooks (no trash bin).

**Open questions:** Does the reference ask for typed confirmation on delete?

### Example B — FR-SI-03 Source selection / scoping (core)

| Field | Value |
| :- | :- |
| Release / Package | v1.0 / 1.2 |
| Priority | P1 |
| Actors | Owner; Editor and Viewer Full from v6 (Chat-Only scope is server-resolved) |
| Depends on | FR-SI-01, C-02, NFR-EVAL-04 |

**Requirement (EARS)**
- The system shall show a checkbox per source and a "Select all" toggle.
- When the selection changes, the system shall use only the selected sources for the next chat
  turn or Studio job.
- While a source is still processing, the system shall show it as not selectable.
- If no source is selected, then the system shall disable the chat input and show
  "Select at least one source".

**Acceptance criteria**

```gherkin
Scenario: Deselected source never leaks
  Given sources A and B, where only B contains the fact "X"
  And B is deselected
  When the user asks about "X"
  Then the answer refuses for lack of source support
  And no retrieved chunk belongs to B
```

**Outputs & state:** Counter "n sources selected" in the chat input; selection is held in client session state per user and notebook and sent explicitly on each request.

**Measurable criteria:** Leakage = 0 across the NFR-EVAL-04 suite.

**Open questions:** None in the real FR-SI-03 card: selection is session-local and newly Ready sources are selected for the importing session.

### Example C — FR-GC-03 Citation hover & click (complex UI)

| Field | Value |
| :- | :- |
| Release / Package | v1.0 / 1.3 |
| Priority | P1 |
| Actors | Owner; Editor and Viewer Full from v6; Chat-Only gets answer-bound hover only |
| Depends on | FR-GC-02, FR-SI-04, C-01 |

**Requirement (EARS)**
- When the user hovers over a citation badge `[n]`, the system shall show a tooltip with the
  source title and the cited snippet.
- When the user clicks `[n]`, the system shall open the source viewer, scroll to the cited
  passage and highlight it.
- Where the cited source is audio or video, the system shall seek the player to the cited
  timestamp.
- If the cited source was deleted after the answer was generated, then the system shall show
  the badge as unavailable and not open the viewer.

**Acceptance criteria**

```gherkin
Scenario: Click scrolls to passage on page 7
  Given an answer citing chunk [2] located on page 7 of "report.pdf"
  When the user clicks [2]
  Then the source viewer shows "report.pdf" at page 7
  And the cited passage is highlighted
```

**Measurable criteria:** Tooltip appears ≤ 300 ms after hover; the scroll target is
deterministic (Gate v1.0 #3).

**Deviations from reference:** None.

**Open questions:** None in FR-WM-05: Chat-Only users see authorized answer-bound snippets but cannot open raw sources.
