# Package 5.1 — Studio: Dialogic Audio Overviews & Live-Voice

- **Release:** v5.0
- **Goal:** Provide the signature 2-host dialogic AI Podcast generator ("Audio Overview") with pre-generation customization (focus prompt, length, multilingual output), an integrated audio player with speed/export controls, and the real-time interactive voice mode ("Join-In" / live interrupt).
- **FRs:** FR-ST-01, FR-ST-02, FR-ST-03, FR-ST-04
- **Gate criteria (release gates):** Gate v5.0 #1 — Audio-Synthese liefert 2-Sprecher-Dialog ohne Überlappungsartefakte; Gate v5.0 #2 — Live-Voice-Interrupt (`FR-ST-03`) pausiert den Stream, beantwortet die Zwischenfrage streng *source-grounded* durch einen designierten Host im passenden Stimmenprofil (DEV-01) und setzt den Podcast fort.
- **Out of scope:** Uploading custom user voice samples for voice cloning; audio link sharing is delivered in v6 under D10 and package 6.1.

**Cross-package rules:** [Binding scope, roles, lifecycle, quotas and validation](../README.md#binding-cross-package-rules).

---

### FR-ST-01 — Dialogic 2-Host Audio Synthesis ("Deep Dive Podcast")

| Field | Value |
| :- | :- |
| Release / Package | v5.0 / 5.1 |
| Priority (within package) | P1 |
| Actors | Owner/Editor |
| Depends on | FR-SI-03, C-02, C-03 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the Owner/Editor clicks `"Generate"` (`"Generieren"`) on the `Audio Overview` tile in the Studio panel, the `Audio Podcast Agent` shall synthesize the active sources ($S_{\text{aktiv}}$) into a natural, multi-minute conversational dialogue script between two distinct AI hosts (`Host A` — analytical lead, `Host B` — curious co-host using analogies and follow-up questions) and synthesize the multi-speaker audio track with natural turn-taking, prosody, and zero destructive waveform clipping.
- *Ubiquitous:* Every factual statement made by either host in the generated dialogue script shall be grounded exclusively in $S_{\text{aktiv}}$ (`Contract C-02`), and the timestamped dialogue transcript shall be persisted alongside the audio file inside the `StudioArtifact` (`Contract C-03`).

**User story:** As a busy professional, I want to turn my notebook documents into an engaging two-host podcast discussion that explains complex concepts with analogies and clear takeaways, so that I can listen and learn while commuting or multitasking.

**Reference behaviour**
1. In the Right Panel (`Studio`), the `Audio Overview` card shows a `"Deep Dive conversation — Two hosts"` banner with `"Customize"` and `"Generate"` buttons.
2. Clicking `"Generate"` starts an asynchronous background job (`"Generating conversation... This may take a few minutes"`).
3. Once complete, the card transforms into an audio player with a waveform animation and playable track.

Evidence: `https://support.google.com/notebooklm/answer/16164461`, `SRS §3.5.1 FR-ST-01` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| `active_source_ids` ($S_{\text{aktiv}}$) | Array of UUIDs | $\lvert S_{\text{aktiv}}\rvert \ge 1$ | All `Ready` sources |
| Speaker profiles | 2 distinct neural TTS voices | `Host_A` (Voice 1) & `Host_B` (Voice 2) per target language | Default language pair |

**Outputs & state**
- Visible: Asynchronous generation spinner in Studio; playable Audio Overview artifact upon completion.
- Persisted: `StudioArtifact` (`plugin_type: 'audio_overview'`, `payload_json: { audio_url, duration_ms, transcript_turns: [{ speaker, start_ms, end_ms, text, source_chunk_ids }] }`).
- States: `Queued` $\rightarrow$ `Scripting` $\rightarrow$ `SynthesizingAudio` $\rightarrow$ `Completed` (or `Failed`).

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Audio Overview produces a clean 2-speaker grounded dialogue (Gate v5.0 #1)
  Given a notebook with 2 active sources
  When the owner clicks "Generate" on the Audio Overview tile
  Then the completed artifact contains a valid audio file (MP3/WAV) and a timestamped 2-speaker transcript
  And both Host_A and Host_B speak in alternating turns with zero audio clipping or silent dropouts > 2s
  And all factual claims in the transcript are entailed by the active sources
```

**Edge & error cases**
- User closes browser tab while Audio Overview is generating $\rightarrow$ Job continues asynchronously on the server and is ready when the user returns.

**Measurable criteria**
- $100\%$ of generated audio streams pass automated waveform/diarization checks for 2-speaker separation without overlap/clipping artifacts (`Gate v5.0 #1`).
- Standard $8\text{-minute}$ Audio Overview completes generation in $\le 90\text{ s}$ (P95).

**Deviations from reference:** Also persists the synchronized 2-host transcript so hearing-impaired users (accessibility / WCAG) and compliance auditors can inspect the exact text and source citations of the podcast.

**Out of scope:** Background music beds that obscure speech intelligibility.

**Open questions:** `None`

---

### FR-ST-02 — Audio Overview Pre-Generation Customizing

| Field | Value |
| :- | :- |
| Release / Package | v5.0 / 5.1 |
| Priority (within package) | P1 |
| Actors | Owner/Editor |
| Depends on | FR-ST-01, FR-UI-02 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the Owner/Editor clicks `"Customize"` (`"Anpassen"`) on the `Audio Overview` tile before generation, the system shall open a configuration popover allowing the user to set:
  1. **Target Length (`Länge`):** `Shorter` ($\approx 3\text{–}5\text{ min}$), `Default` ($\approx 8\text{–}12\text{ min}$), or `Longer` ($\approx 15\text{–}20\text{ min}$).
  2. **Output Language (`Ausgabesprache`):** Any supported platform language (independent of the source documents' languages).
  3. **Focus Instructions (`Worauf sollen sich die KI-Hosts konzentrieren?`):** Free-text prompt specifying target audience, specific sections/sources to emphasize, or topics to skip.

**User story:** As a team lead, I want to instruct the podcast hosts to focus on a specific section (e.g., "Focus only on Q4 security risks for a non-technical executive audience") and choose a short 4-minute duration in German, so that the audio fits my exact briefing needs.

**Reference behaviour**
1. User clicks `Customize` on the Audio Overview card.
2. Dialog shows length pills (`Shorter` | `Default` | `Longer`), a language selector, and a text box with placeholder prompts (`"Try: Focus on a specific source"`, `"Target a specific audience"`).
3. Clicking `Generate` passes these parameters into the `Audio Podcast Agent`.

Evidence: `https://blog.google/technology/ai/notebooklm-update-october-2024/`, `SRS §3.5.1 FR-ST-02` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Length preset | Enum | `shorter` \| `default` \| `longer` | `default` |
| Output language | BCP-47 language tag | $\ge 35$ supported TTS languages | Notebook `output_language` (`FR-UI-02`) |
| Focus prompt | UTF-8 string | $0\text{–}2,000$ characters | Empty |

**Outputs & state**
- Visible: Customization modal; generated audio matches requested language, duration bracket, and focus topic.
- Persisted: `params_json: { length, language, focus_prompt }` stored on the `StudioArtifact` record (`FR-ST-01`), allowing multiple customized Audio Overviews per notebook.
- States: `Customizing` $\rightarrow$ `Generating`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Customized German Shorter Audio Overview from English sources
  Given a notebook with English PDF sources
  When the owner opens Audio Overview Customize, selects Length "Shorter", Language "de-DE", enters focus "Focus only on pricing", and clicks Generate
  Then the generated audio dialogue is spoken in German, lasts between 3 and 5 minutes when sufficient source content exists, and focuses on pricing
```

**Edge & error cases**
- Focus prompt asks hosts to discuss a topic not present in $S_{\text{aktiv}}$ $\rightarrow$ Hosts explicitly mention on air that the provided sources do not cover that topic and pivot to the closest available material in $S_{\text{aktiv}}$.

**Measurable criteria**
- Generated duration falls within the selected bracket (Shorter 3–5, Default 8–12, Longer 15–20 minutes) when source volume suffices; explain shorter evidence-limited outputs instead of padding.

**Deviations from reference:** Allows keeping multiple customized Audio Overview artifacts in the Studio library of a single notebook rather than limiting to only one active recording.

**Out of scope:** Selecting custom background sound effects.

**Open questions:** `None`

---

### FR-ST-03 — Interactive Voice Mode ("Join-In" / Live Interrupt)

| Field | Value |
| :- | :- |
| Release / Package | v5.0 / 5.1 |
| Priority (within package) | P1 |
| Actors | Owner/Editor, Viewer |
| Depends on | FR-ST-01, FR-ST-04, FR-GC-01, FR-GC-02, C-02 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the user clicks `"Interactive mode"` (`"Interaktiver Modus"` / `"Beitreten"`) on a playing or ready Audio Overview, the system shall open the interactive voice session player and establish a low-latency bidirectional audio/WebSocket stream.
- *Event:* While the Audio Overview is playing in Interactive Mode, when the user clicks `"Join"` (`"Unterbrechen / Fragen"`) or speaks into the microphone, the system shall immediately pause the pre-rendered podcast playback at the exact current playback timestamp (`t_interrupt`; do not wait for a turn boundary), acknowledge the user in the designated host's voice (e.g., `"Oh, let's bring in our listener—go ahead!"`), transcribe the user's spoken question via streaming ASR, generate a strictly source-grounded response from $S_{\text{aktiv}}$ (`Contract C-02`) synthesized in that designated host's voice profile (`DEV-01`), and then seamlessly resume the podcast discussion from `t_interrupt`.
- *Unwanted:* If the user asks a spoken question whose answer is not in $S_{\text{aktiv}}$, then the designated host shall politely state in voice that the sources don't cover that detail and resume the episode (`FR-GC-01`, `DEV-01`).

**User story:** As an active listener, I want to interrupt the AI podcast hosts mid-episode using my microphone to ask a clarifying question and hear the designated host answer me directly in their voice before continuing the show.

**Reference behaviour**
1. User opens an Audio Overview and clicks `Interactive mode (BETA)`.
2. User clicks Play; as the hosts talk, a prominent `"Join"` button with a microphone icon sits at the bottom of the player.
3. User clicks `"Join"` and asks `"Wait, can you explain what mTLS means in simpler terms?"`.
4. Playback pauses; the designated host welcomes the question, explains mTLS grounded in the notebook's sources using that host's podcast voice profile (`DEV-01`), and then smoothly transitions back into the remaining podcast script where playback resumes.

Evidence: `https://blog.google/technology/ai/notebooklm-redesign-audio-overviews/`, `SRS §3.5.1 FR-ST-03` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Microphone audio stream | WebRTC / WebSocket PCM/Opus | $16\text{ kHz}$ or $24\text{ kHz}$ mono; browser mic permission required | Push-to-talk / click `"Join"` |
| Interrupt position | `t_interrupt_ms` | Timestamp / transcript turn index in `StudioArtifact` | Current playback position |

**Outputs & state**
- Visible: Live voice visualizer (`Listening...` $\rightarrow$ `Host answering...` $\rightarrow$ `Resuming episode...`) and a live transcript with claim-level validated source citations; validate the reply before playing its factual speech.
- Persisted: Live session is ephemeral; show its validated reply transcript and citations during the session. No durable recording is created by default.
- States: `PlayingEpisode` $\rightarrow$ `UserSpeaking` $\rightarrow$ `SynthesizingHostReply` $\rightarrow$ `PlayingHostReply` $\rightarrow$ `PlayingEpisode (Resumed)`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Live-Voice interrupt pauses podcast, answers strictly from sources, and resumes (Gate v5.0 #2, DEV-01)
  Given an Audio Overview is playing in Interactive Mode at timestamp 01:30
  When the user clicks "Join" and asks a spoken question supported by the active sources
  Then podcast playback pauses immediately at 01:30
  And the designated host responds in their podcast voice via synthesized speech grounded strictly in the active sources
  And once the host response finishes, the original podcast playback resumes from 01:30

Scenario: Spoken out-of-scope question during Join-In is refused per FR-GC-01
  Given an Audio Overview playing in Interactive Mode on a cybersecurity notebook
  When the user clicks "Join" and asks "What is the recipe for tiramisu?"
  Then the designated host states that the notebook sources do not contain that information and resumes the episode

Scenario: Invalid live citation is refused before factual speech plays
  Given a live reply draft cites a chunk outside the interrupt request scope
  When the citation validator checks the reply
  Then only the designated host's refusal is played
  And no factual speech from the invalid draft is played
  And podcast playback resumes at the saved interruption timestamp
```

**Edge & error cases**
- Browser microphone permission denied $\rightarrow$ Displays clear prompt `"Microphone access is required for Interactive Mode"` and falls back to standard playback.
- User clicks `"Join"` but remains silent for $> 6\text{ s}$ $\rightarrow$ Designated host says `"Looks like we didn't catch that—let's keep going"` and resumes playback.

**Measurable criteria**
- Voice-to-Voice response latency (end of user speech to start of synthesized host reply) $\le 2.5\text{ s}$ (P95) (`Gate v5.0 #2`).

**Deviations from reference:** **DEV-01 (Accepted 2026-10-16):** Playback pauses on interrupt, and **one designated host** answers live questions in that host's podcast voice via Gemini Live (grounded through `C-02`). Playback resumes from the interruption point. The second host does not join live answers.

**Out of scope:** Multi-human conference call inside the same Join-In stream.

**Open questions:** `None`

---

### FR-ST-04 — Audio Player Controls, Background Playback & Export

| Field | Value |
| :- | :- |
| Release / Package | v5.0 / 5.1 |
| Priority (within package) | P2 |
| Actors | Owner/Editor, Viewer |
| Depends on | FR-ST-01 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Ubiquitous:* The integrated Audio Overview player shall provide play/pause, a scrubbable timeline bar with current/total time (`mm:ss`), $\pm 10\text{ s}$ skip buttons, playback speed control ($0.5\times, 0.75\times, 1.0\times, 1.25\times, 1.5\times, 1.75\times, 2.0\times$), and download as `.mp3` or `.wav`.
- *Event:* From v6 (D10), Copy link produces an authenticated artifact deep-link for existing authorized Owner/Editor/Full Viewers. It grants no new access; v5 provides player and downloads only. Chat-Only and anonymous users cannot retrieve the audio or transcript (FR-WM-05).
- *State:* While an Audio Overview is playing, the user shall be able to collapse the Studio artifact viewer, switch between Chat and Source Inspector, or view notes while the audio continues playing uninterrupted in a persistent mini-player bar.

**User story:** As a power listener, I want to listen at $1.5\times$ speed while reading sources and chatting in the notebook, or download the `.mp3`/`.wav` file to listen offline on my phone.

**Reference behaviour**
1. Player displays play/pause, timeline scrubber, playback speed button (`1x`), three-dot menu (`Download`, `Delete`), and share/link action (in shared notebooks `v6.0`).
2. Navigating to a source in the Left Panel or sending a Chat message does not interrupt audio playback.

Evidence: `https://support.google.com/notebooklm/answer/16164461`, `SRS §3.5.1 FR-ST-04` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Playback speed | Float | $0.5\times$ to $2.0\times$ (pitch-preserved time stretching) | $1.0\times$ |
| Audio download | File stream | `.mp3` ($192\text{ kbps}$) or `.wav` ($24\text{ kHz}$ PCM) | `.mp3` / `.wav` |

**Outputs & state**
- Visible: Docked/mini audio player bar with time, scrubber, speed badge, and download menu.
- Persisted: Last playback position (`last_position_ms`) in `localStorage`.
- States: `Paused` $\leftrightarrow$ `Playing`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Audio continues playing at 1.5x while opening Source Inspector and chatting
  Given a completed Audio Overview is playing at 1.5x speed
  When the user clicks a citation in Chat to open the Source Inspector
  Then audio playback continues without interruption at 1.5x speed
  When the user clicks "Download MP3"
  Then a valid .mp3 file is downloaded
```

**Edge & error cases**
- Deleting the currently playing Audio Overview artifact $\rightarrow$ Stops playback immediately, unmounts player, and deletes the file.

**Measurable criteria**
- Timeline seeking within buffered/range-supported audio completes in $\le 150\text{ ms}$.

**Deviations from reference:** Supports both `.mp3` and `.wav` download formats (`SRS §3.5.1 FR-ST-04`).

**Out of scope:** Pushing directly to public Spotify/Apple Podcasts RSS feeds.

**Open questions:** `None`
