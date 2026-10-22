# Package 5.2 — Studio: Video Overviews

- **Release:** v5.0
- **Goal:** Provide the three generative Video Overview modes in the Studio (`Contract C-03`): Standard Narrated Slideshow Videos, compact 60-second Short Video Overviews, and style-selectable Cinematic Video Overviews with synchronized narration and MP4/WebM export.
- **FRs:** FR-ST-05, FR-ST-06, FR-ST-07
- **Gate criteria (release gates):** Gate v5.0 #3 — Video-Rendering-Pipeline erzeugt synchronisierte MP4/WebM-Streams für alle drei Modi (`FR-ST-05` bis `07`).
- **Out of scope:** Live real-time 3D avatar webcam calls.

**Cross-package rules:** [Binding scope, roles, lifecycle, quotas and validation](../README.md#binding-cross-package-rules).

---

### FR-ST-05 — Narrated Slideshow / Standard Video Overview

| Field | Value |
| :- | :- |
| Release / Package | v5.0 / 5.2 |
| Priority (within package) | P1 |
| Actors | Owner/Editor (generate), Viewer (watch/download) |
| Depends on | FR-ST-16, FR-ST-01, C-02, C-03 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the Owner/Editor clicks `"Video Overview"` (`"Video-Zusammenfassung"`) in the Studio panel in `Standard (Narrated Slideshow)` mode, the `Video Rendering Pipeline` shall generate a structured slide storyboard (`FR-ST-16` engine: visual diagrams, key quotes, charts, and bullet animations) synchronized frame-accurately with an AI narrator voiceover track and mux them into a playable `.mp4` / `.webm` video artifact (`Contract C-03`).
- *Ubiquitous:* The integrated Video Player shall support play/pause, timeline chapter markers per slide, closed captions/subtitles (`.vtt`), playback speed ($0.5\times\text{–}2.0\times$), fullscreen toggle, and `.mp4` download.

**User story:** As a visual learner, I want to generate a narrated explainer video that walks through slides, diagrams, and quotes from my sources with a clear voiceover, so that I can watch a structured presentation of my material.

**Reference behaviour**
1. User clicks `Video Overview` in the Studio panel.
2. Background job generates the visual slides, voiceover narration, and synchronized video stream.
3. Clicking the finished artifact opens a 16:9 video player inside the Studio panel (with fullscreen and download controls) where visual callouts and slides transition in sync with the narrator's voice.

Evidence: `https://blog.google/technology/ai/notebooklm-audio-video-overviews-reports-2025/`, `SRS §3.5.2 FR-ST-05` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Video mode | Enum | `narrated_slideshow` (`FR-ST-05`) | Default mode |
| Output language | BCP-47 tag | Matches notebook `output_language` (`FR-UI-02`) | `de-DE` / user locale |
| Focus prompt | UTF-8 string (optional) | $0\text{–}2,000$ characters | — |

**Outputs & state**
- Visible: 16:9 Video Player with chapter markers, `.vtt` subtitles, and `.mp4` download button.
- Persisted: `StudioArtifact` (`plugin_type: 'video_overview'`, `subtype: 'narrated_slideshow'`, `payload_json: { video_url, vtt_url, duration_ms, chapters: [...], source_chunk_ids }`).
- States: `Queued` $\rightarrow$ `Storyboarding` $\rightarrow$ `SynthesizingVoiceAndSlides` $\rightarrow$ `MuxingVideo` $\rightarrow$ `Completed`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Narrated Slideshow Video Overview produces synchronized MP4/WebM stream with subtitles (Gate v5.0 #3)
  Given a notebook with 2 active sources
  When the owner generates a Standard "Video Overview"
  Then the completed artifact provides a valid MP4/WebM video stream with matching audio and video track durations (drift < 100 ms)
  And every slide chapter transition aligns with its corresponding narration segment and VTT subtitle track
```

**Edge & error cases**
- Browser cannot play the chosen encoding $\rightarrow$ Offer the alternate H.264/AAC MP4 or VP9/Opus WebM rendition; show an unsupported-playback message with an authorized download if neither is playable. Both formats are validated for all three video modes.

**Measurable criteria**
- Audio-video synchronization drift $< 100\text{ ms}$ across the entire video duration (`Gate v5.0 #3`).

**Deviations from reference:** Reuses the deterministic `FR-ST-16` slide layout engine so on-screen text and numbers are $100\%$ sharp and free of diffusion text-garbling.

**Out of scope:** Manual non-linear video timeline editing (premiere-style cutting).

**Open questions:** `None`

---

### FR-ST-06 — Short Video Overviews ($\approx 60\text{ s}$)

| Field | Value |
| :- | :- |
| Release / Package | v5.0 / 5.2 |
| Priority (within package) | P2 |
| Actors | Owner/Editor (generate), Viewer (watch/download) |
| Depends on | FR-ST-05, C-02, C-03 |
| Reference provenance (unverified) | 2026-10-15, Enterprise SRS §3.5.2 |

**Requirement (EARS)**
- *Event:* When the Owner/Editor selects `"Short Video"` (`"Kurzvideo ~60 s"`) in the `Video Overview` customization modal, the `Video Rendering Pipeline` shall condense the top $3\text{–}5$ core insights of $S_{\text{aktiv}}$ into a compact, fast-paced $\approx 60\text{-second}$ ($45\text{–}75\text{ s}$) educational animation with kinetic typography, animated diagrams, and voiceover narration.

**User story:** As a busy team member, I want a 60-second animated video summary of a notebook's key takeaways, so that I can review the core message in one minute before a meeting.

**Reference behaviour**
1. In the `Video Overview` modal, the user selects format `Short (~60s)`.
2. The generated video delivers a concise, high-impact 60-second explainer with animated visual transitions and synchronized captions.

Evidence: `SRS §3.5.2 FR-ST-06`, `Release gates: Gate v5.0 #3`

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Target duration | Seconds | $45\text{ s} \le d \le 75\text{ s}$ (target $60\text{ s}$) | $60\text{ s}$ |
| Aspect ratio | Enum | `16:9` (Desktop) or `9:16` (Mobile/Vertical option) | `16:9` |

**Outputs & state**
- Visible: Playable $\approx 60\text{ s}$ video artifact in the Studio list with download button.
- Persisted: `StudioArtifact` (`plugin_type: 'video_overview'`, `subtype: 'short_video'`).
- States: `Queued` $\rightarrow$ `Running` $\rightarrow$ `Completed`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Short Video Overview renders a synchronized 45-to-75-second video (Gate v5.0 #3)
  Given a notebook with 3 active sources
  When the owner generates a "Short Video Overview"
  Then the completed MP4/WebM video has a total duration between 45 and 75 seconds
  And all spoken and on-screen facts are grounded in the active sources
```

**Edge & error cases**
- Script draft exceeds $160$ words (which would overrun $75\text{ s}$ at natural speaking pace) $\rightarrow$ Storyboard compressor automatically trims secondary points before TTS synthesis so the video never gets abruptly cut off at $60\text{ s}$.

**Measurable criteria**
- $100\%$ of `Short Video` artifacts complete cleanly with a final duration in $[45\text{ s}, 75\text{ s}]$ (`Gate v5.0 #3`).

**Deviations from reference:** None.

**Out of scope:** Direct publishing to external social media platforms (TikTok/YouTube Shorts).

**Open questions:** `None`

---

### FR-ST-07 — Cinematic Video Overviews with Selectable Visual Styles

| Field | Value |
| :- | :- |
| Release / Package | v5.0 / 5.2 |
| Priority (within package) | P2 |
| Actors | Owner/Editor (generate), Viewer (watch/download) |
| Depends on | FR-ST-05, C-02, C-03 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web & SRS §3.5.2 |

**Requirement (EARS)**
- *Event:* When the Owner/Editor selects `"Cinematic Video"` (`"Cinematic Video Overview"`) in the `Video Overview` modal and chooses a visual direction style from:
  1. `Scientific` (`Wissenschaftlich`)
  2. `Professional` (`Professionell / Corporate`)
  3. `Editorial` (`Redaktionell / Documentary`)
  4. `Sketch Note` (`Sketchnote / Handgezeichnet`)
  the `Video Rendering Pipeline` shall generate scene-by-scene visual animations/B-roll matching the chosen aesthetic style, composite crisp data overlays, and synchronize them with the narrated script into a playable `.mp4`/`.webm` stream (`Contract C-03`).

**User story:** As an enablement or communications lead, I want to generate cinematic knowledge videos in a consistent visual style (such as Sketch Note or Scientific), so that training materials look engaging and tailored to our audience.

**Reference behaviour**
1. User opens `Video Overview` customize options, chooses `Cinematic`, and selects one of the visual style cards (`Scientific`, `Professional`, `Editorial`, `Sketch Note`).
2. Pipeline generates each scene's visual sequence in the selected style palette and renders the final `.mp4` video.

Evidence: `SRS §3.5.2 FR-ST-07`, `Release gates: Gate v5.0 #3`

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Visual style | Enum | `scientific` \| `professional` \| `editorial` \| `sketch_note` | `professional` |
| Resolution | Pixels | $1920 \times 1080$ (`1080p` @ $30\text{ fps}$) | `1080p` |

**Outputs & state**
- Visible: Style-consistent 1080p video in Studio player with `.vtt` subtitles and `.mp4` download.
- Persisted: `StudioArtifact` (`plugin_type: 'video_overview'`, `subtype: 'cinematic'`, `params_json: { visual_style }`).
- States: `Queued` $\rightarrow$ `SceneGeneration` $\rightarrow$ `Compositing` $\rightarrow$ `Completed`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Cinematic Video Overview renders valid MP4 stream in chosen style (Gate v5.0 #3)
  Given a notebook with active sources
  When the owner triggers a Cinematic Video Overview with style "sketch_note"
  Then the pipeline generates a playable 1080p MP4/WebM stream with synchronized narration and subtitles
  And the artifact metadata records visual_style = "sketch_note"

Scenario: Cinematic failure is not silently replaced by a slideshow
  Given a cinematic scene worker fails after bounded retries
  When the pipeline finalizes the job
  Then the Cinematic artifact is Failed
  And no slideshow fallback is labelled a successful Cinematic artifact
```

**Edge & error cases**
- Generative scene worker times out $\rightarrow$ Retry under the bounded job policy, then mark the Cinematic job Failed; do not silently substitute a slideshow and claim Cinematic success. A separately requested narrated slideshow remains available.

**Measurable criteria**
- $100\%$ of all three video modes (`FR-ST-05`, `FR-ST-06`, `FR-ST-07`) produce valid, playable, audio-synchronized `.mp4`/`.webm` streams (`Gate v5.0 #3`).

**Deviations from reference:** Hybrid compositing keeps factual numbers/labels on a sharp vector overlay layer above the generative visual background so text is never distorted.

**Out of scope:** Uploading custom live-action actor footage.

**Open questions:** `None`
