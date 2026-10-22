# Package 4.2 — Studio: Visuals & Presentations

- **Release:** v4.0
- **Goal:** Provide Studio generators (`Contract C-03`) for structured Slide Decks (with speaker notes and PPTX/PDF export) and visual Infographics (SVG/PNG export) grounded in active sources.
- **FRs:** FR-ST-16, FR-ST-17
- **Gate criteria (release gates):** Gate v4.0 #3 — slide deck export produces PPTX and PDF files that open without errors.
- **Out of scope:** Narrated video rendering from slides (`v5.0` — `FR-ST-05` builds on this engine); Google Slides export (deferred: deviation log `DEV-02`, architecture decision D8).

**Cross-package rules:** [Binding scope, roles, lifecycle, quotas and validation](../README.md#binding-cross-package-rules).

---

### FR-ST-16 — Studio: Slide Decks with PPTX & PDF Export

| Field | Value |
| :- | :- |
| Release / Package | v4.0 / 4.2 |
| Priority (within package) | P1 |
| Actors | Owner (generate, view, export); Editor (generate), Viewer (view/export) from v6.0 |
| Depends on | FR-SI-03, C-02, C-03 |
| Reference provenance (unverified) | 2026-10-15, Enterprise SRS §3.5.6 |

**Requirement (EARS)**
- *Event:* When the Owner/Editor clicks the `"Slide Deck"` (`"Präsentation"`) tile in the Studio panel (optionally specifying slide count, target audience, or focus prompt), the `Slide & Infographic Agent` shall synthesize $S_{\text{aktiv}}$ into a structured presentation deck where each slide has a layout template (`Title`, `Two-Column`, `Key Metric Callout`, `Comparison Table`, `Diagram/Chart`), headline, concise bullet points, source citations `[n]`, and detailed speaker notes (`Sprechernotizen`).
- *Event:* When the user clicks `"Export PPTX"` or `"Export PDF"` in the Slide Deck Viewer, the system shall render and download a valid PowerPoint (`.pptx` including editable text boxes and speaker notes) or `.pdf` presentation file.

**User story:** As a consultant or manager, I want to generate a structured slide deck with speaker notes directly from my notebook sources and export it as a PowerPoint (`.pptx`) or `.pdf` file, so that I can go from research to executive presentation in minutes.

**Reference behaviour**
1. User clicks `Slide Deck` in the Studio panel.
2. Once generated, opening the artifact in the Right Panel shows a 16:9 slide carousel viewer with slide thumbnails, a toggle for `Speaker Notes` below the active slide, and inline citations `[n]`.
3. Clicking `Export PPTX` downloads a native `.pptx` file with slides and speaker notes; clicking `Export PDF` downloads a 16:9 `.pdf` deck.

Evidence: `SRS §3.5.6 FR-ST-16`, `Release gates: Gate v4.0 #3`

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Slide count | Integer | $5\text{–}20$ slides | $10$ slides |
| Custom focus prompt | UTF-8 text (optional) | $0\text{–}2,000$ characters | Executive overview of $S_{\text{aktiv}}$ |
| Export formats | Binary download | `.pptx` (OOXML PresentationML) \| `.pdf` | — |

**Outputs & state**
- Visible: 16:9 Slide Deck preview player in Studio viewer with speaker notes drawer and `.pptx`/`.pdf` export buttons.
- Persisted: `StudioArtifact` (`plugin_type: 'slide_deck'`, `payload_json: { slides: [{ slide_number, layout, title, bullets, visual_spec, speaker_notes, source_chunk_ids }] }`).
- States: `Queued` $\rightarrow$ `Running` $\rightarrow$ `Completed` (or `Failed`).

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Slide Deck exports valid, non-corrupted PPTX and PDF files (Gate v4.0 #3)
  Given a notebook with 2 active sources
  When the owner generates a "Slide Deck" of 8 slides
  Then the completed artifact contains 8 slides, each with title, content, speaker notes, and source citations
  When the user clicks "Export PPTX" and "Export PDF"
  Then the downloaded .pptx file converts without errors in a headless LibreOffice run and contains all 8 slides and speaker notes
  And the downloaded .pdf file contains 8 valid pages

Scenario: Failed slide deck generation can be retried
  Given a notebook with 2 active sources
  When slide deck generation fails
  Then the artifact shows state "Failed" with an error message and a "Retry" action
  And no partial .pptx or .pdf export is offered
```

**Edge & error cases**
- Slide bullet text overflow $\rightarrow$ Layout engine caps bullets at $\le 5$ per slide ($\le 15$ words per bullet) and pushes verbose detail into the `speaker_notes` field so slide visuals never clip.

**Measurable criteria**
- $100\%$ of exported `.pptx` and `.pdf` files pass structural validation (`Gate v4.0 #3`).
- $10$-slide deck generation completes in $\le 25.0\text{ s}$ (P95).

**Deviations from reference:** Structured JSON slide intermediate representation is designed so that `Paket 5.2` (`FR-ST-05` Narrated Slideshow Video) can feed it directly into TTS + video muxing without re-architecting.

**Out of scope:** Google Slides export via OAuth push (deferred: deviation log `DEV-02`, architecture decision D8; file download `.pptx`/`.pdf` works universally across enterprise environments).

**Open questions:** `None`

---

### FR-ST-17 — Studio: Visual Infographics

| Field | Value |
| :- | :- |
| Release / Package | v4.0 / 4.2 |
| Priority (within package) | P2 |
| Actors | Owner (generate, view, export); Editor (generate), Viewer (view/export) from v6.0 |
| Depends on | FR-SI-03, C-02, C-03 |
| Reference provenance (unverified) | 2026-10-15, Enterprise SRS §3.5.6 |

**Requirement (EARS)**
- *Event:* When the Owner/Editor clicks the `"Infographic"` (`"Infografik"`) tile in the Studio panel (optionally choosing layout style `auto`, `process_flow`, `comparison`, `metrics_summary`, or `architecture_diagram`), the `Slide & Infographic Agent` shall synthesize key takeaways, metrics, and workflows from $S_{\text{aktiv}}$ into a structured visual poster/infographic rendered as crisp vector graphics (`.svg`) with `.png` export.

**User story:** As a communicator, I want to turn dense technical or business sources into a single visual infographic poster showing key numbers and process steps, so that stakeholders can digest the essentials at a glance.

**Reference behaviour**
1. User clicks `Infographic` in the Studio panel.
2. Once generated, clicking the artifact opens a high-resolution visual infographic canvas showing a header, key stat callouts, process flow blocks, and cited sources at the footer, with buttons to download `.svg` or `.png`.

Evidence: `SRS §3.5.6 FR-ST-17`

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Infographic style | Enum | `auto` \| `process_flow` \| `comparison` \| `metrics_summary` \| `architecture_diagram` | `auto` |
| Focus prompt | UTF-8 string (optional) | $0\text{–}1,000$ characters | — |

**Outputs & state**
- Visible: Interactive zoomable Infographic poster in the Studio viewer; `.svg` and `.png` download buttons.
- Persisted: `StudioArtifact` (`plugin_type: 'infographic'`, `payload_json: { structured_blocks, rendered_svg, source_chunk_ids }`).
- States: `Queued` $\rightarrow$ `Running` $\rightarrow$ `Completed` (or `Failed`).

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Generate Infographic grounded in active sources and export as SVG/PNG
  Given a notebook with an active source describing a 4-stage incident response workflow
  When the owner generates an Infographic with style "process_flow"
  Then the generated SVG displays all 4 stages accurately and exports cleanly as SVG and PNG

Scenario: Failed infographic generation can be retried
  Given a notebook with 1 active source
  When infographic generation fails
  Then the artifact shows state "Failed" with an error message and a "Retry" action
  And no partial SVG or PNG export is offered
```

**Edge & error cases**
- Long labels inside infographic boxes $\rightarrow$ Deterministic SVG layout engine wraps text and adjusts box height dynamically to prevent overlapping text.

**Measurable criteria**
- Infographic generation completes in $\le 20.0\text{ s}$ (P95) with zero text-clipping defects.

**Deviations from reference:** Uses deterministic structured-layout-to-SVG rendering rather than raster diffusion models so that text and numbers inside the infographic are $100\%$ legible and free of garbled AI spelling artifacts (architecture decision D9).

**Out of scope:** Freehand vector illustration editing.

**Open questions:** `None`
