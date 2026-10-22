# [OBSOLETE] System Requirements Specification (SRS): Enterprise-Plattform nach dem Vorbild von „Gemini Notebook“

> [!WARNING]
> **OBSOLETE — archived 2026-10-22.** This document is no longer maintained and is not a source of truth.
> The release → FR card mapping now lives in [`spec/System_Requirements_Specification_Gemeni_Notebook.md`](../../spec/System_Requirements_Specification_Gemeni_Notebook.md);
> requirement detail lives in the [FR cards](../../spec/requirements/README.md). Contracts (§5.1), release gates (§5.4),
> the deviation log (§5.5) and the card clarifications (§5.6) moved to
> [`spec/requirements/README.md`](../../spec/requirements/README.md). Kept for history only.

**Dokumentstatus:** Obsolet (archiviert 2026-10-22); zuvor Entwurf (Baseline für Spec-Driven Agentic Development; Konsistenzklärung 2026-10-16)<br>
**Zielsystem:** Firmeninterne, quellenbasierte KI-Recherche-, Analyse- und Wissenssynthese-Plattform  
**Referenzsystem:** Google Gemini Notebook (bis Juli 2026 bekannt als *Google NotebookLM*)  
**Verwandte Dokumente:** [Lösungsarchitektur](../solution-architecture.md) (Umsetzungsentscheidungen D1–Dn; bindend für das *Wie*, diese SRS bleibt bindend für das *Was*) · [FR-Karten](../../spec/requirements/README.md) · [Constitution](../../.specify/memory/constitution.md)

---

## 1. Formales Problem-Statement & Allgemeiner Use-Case

> **Formale Definition (Problem-Statement & Use-Case):**  
> Wissensarbeitende stehen vor dem Problem, aus umfangreichen, heterogenen und unstrukturierten Datenbeständen (Dokumente, Audio, Video, Webseiten) schnell verlässliche Erkenntnisse zu gewinnen, wobei klassische Large Language Models (LLMs) durch Halluzinationen, fehlende Quellenbelege und mangelnde Abgrenzung des Kontexts ein hohes Compliance- und Qualitätsrisiko darstellen. **Gemini Notebook** löst dieses Problem durch Bereitstellung einer isolierten, strikt quellenbasierten (*source-grounded*) KI-Arbeitsumgebung, die ausschließlich nutzerdefinierte Informationsquellen heranzieht, um über ein großes Kontextfenster hinweg komplexe Fragen mit exakt verlinkten Inline-Zitaten zu beantworten sowie die Quelldaten automatisiert in multimodale Wissens- und Lernartefakte (Berichte, Audio-Diskussionen, Videos, Mindmaps, Tabellen und Lernmodule) zu transformieren.

---

## 2. Systemüberblick & Modulare Gesamtarchitektur

Um sicherzustellen, dass die Summe aller Einzelanforderungen exakt der vollständigen Anwendung entspricht und durch Entwicklungs-Agenten modular implementiert sowie validiert werden kann, gliedert sich das System in **sechs funktionale Kernbereiche (Domänen)** sowie **übergreifende nicht-funktionale Systemanforderungen**:

$$\text{Gesamtsystem} = \text{Workspace} \cup \text{Ingestion} \cup \text{Grounded Chat} \cup \text{Notes} \cup \text{Studio} \cup \text{Ecosystem/NFR}$$

1. **Workspace & Notebook-Management:** Mandantenfähige Projekt-, Metadaten- und Zugriffsverwaltung.
2. **Multimodale Quellen-Ingestion & Discovery:** Import, Parsing, Indexierung und agentische Quellensuche.
3. **Source-Grounded Chat & Citation Engine:** Strikte RAG-/Long-Context-Dialogsteuerung mit klickbaren Inline-Zitaten und Code-Sandbox.
4. **Notizen- & Pinboard-Management:** Persistente Wissenssammlung und bidirektionale Umwandlung zwischen Notiz und Quelle.
5. **Generative Studio Engine:** Multimodale Synthese-Agenten (Audio, Video, Mindmaps, Berichte, Lernkarten, Quizze, Präsentationen, Tabellen).
6. **Ökosystem-Integration & Plattform-Governance:** Schnittstellen zu externen KI-Assistenten, UI-Layout-Spezifikation und Sicherheitsarchitektur.

---

## 3. Vollständige Requirements-Analyse (Funktionale Anforderungen)

Jede Anforderung besitzt eine eindeutige Kennung (`FR-XXX`), um im Rahmen eines *Spec-Driven Development* direkt mit automatisierten Akzeptanztests und Agenten-Tasks verknüpft zu werden.

### 3.1 Modul 1: Workspace- & Notebook-Management (WM)

Ein „Notebook“ bildet den logisch isolierten Daten- und Kontext-Container für ein spezifisches Projekt oder Thema.

* **FR-WM-01 (Notebook CRUD):** Nutzer müssen Notebooks erstellen, öffnen, umbenennen und endgültig löschen können. → FR-Karte: [FR-WM-01](../../spec/requirements/v1/package_1_1_workspace_foundation.md#fr-wm-01--notebook-crud)
* **FR-WM-02 (Metadaten & Visuelle Organisation):** Jedem Notebook müssen ein Titel, ein individuell wählbares Icon/Emoji, Erstellungs- und Änderungszeitstempel sowie die Anzahl der enthaltenen Quellen zugewiesen werden. → FR-Karte: [FR-WM-02](../../spec/requirements/v2/package_2_1_workspace_ui_comfort.md#fr-wm-02--metadata--visual-organization)
* **FR-WM-03 (Übersicht & Sortierung):** Auf der Startseite müssen Notebooks in einer Raster- oder Listenansicht darstellbar, nach Kriterien (Zuletzt geöffnet, Titel, Erstellungsdatum) sortierbar und anpinnbar (*Pin/Unpin*) sein. → FR-Karte: [FR-WM-03](../../spec/requirements/v2/package_2_1_workspace_ui_comfort.md#fr-wm-03--home-overview-sorting--pinning)
* **FR-WM-04 (Isolierter Wissenskontext):** Standardmäßig darf kein Informationsaustausch zwischen verschiedenen Notebooks stattfinden; jedes Notebook bildet eine strikt isolierte Wissensdomäne. → FR-Karte: [FR-WM-04](../../spec/requirements/v1/package_1_1_workspace_foundation.md#fr-wm-04--isolated-knowledge-context)
* **FR-WM-05 (Kollaboration & Sharing):** Notebooks müssen für andere interne Nutzer oder Gruppen freigegeben werden können. Unterstützte Rollen: → FR-Karte: [FR-WM-05](../../spec/requirements/v6/package_6_1_enterprise_governance_sharing_analytics.md#fr-wm-05--role-based-collaboration--sharing-incl-chat-only-mode)
  * *Owner / Editor:* Darf Quellen hinzufügen/löschen, Notizen bearbeiten und Studio-Artefakte generieren.
  * *Viewer (Vollansicht):* Lesezugriff auf Quellen, generierte Studio-Artefakte und eigene Chat-Interaktion.
  * *Viewer (Chat-Only):* Sieht ausschließlich das Chat-Interface, um Fragen an das Notebook zu stellen, ohne die Rohquellen oder das Studio manipulieren zu können.
* **FR-WM-06 (Notebook-Analytics für Enterprise-Sharing):** Für geteilte Notebooks muss ein Statistik-Dashboard abrufbar sein (Anzahl der zugreifenden Nutzer pro Tag, Anzahl der gestellten Fragen). → FR-Karte: [FR-WM-06](../../spec/requirements/v6/package_6_1_enterprise_governance_sharing_analytics.md#fr-wm-06--notebook-usage-analytics-for-shared-notebooks)
* **FR-WM-07 (Ressourcen-Quotas):** Das System muss konfigurierbare Limits pro Notebook erzwingen (Referenzwert: $N_{\text{max}} \ge 50$ bis $300$ Quellen pro Notebook; max. $500.000$ Wörter bzw. $200\text{ MB}$ pro Einzelquelle). → FR-Karten: [Baseline v1.0](../../spec/requirements/v1/package_1_1_workspace_foundation.md#fr-wm-07--resource-quotas-baseline-v10), [Enterprise Tier](../../spec/requirements/v6/package_6_1_enterprise_governance_sharing_analytics.md#fr-wm-07-enterprise-tier--enterprise-quota--tier-management)

---

### 3.2 Modul 2: Multimodale Quellen-Ingestion & -Verwaltung (SI)

Dieses Modul verantwortet die Aufnahme, Vorverarbeitung und Bereitstellung sämtlicher Referenzdokumente.

* **FR-SI-01 (Unterstützte Quellformate):** Das System muss folgende Eingabeformate nativ verarbeiten und in ein einheitliches internes Dokumentenmodell (inkl. Seiten-, Absatz- oder Zeitstempel-Referenzen) überführen: → FR-Karten: [Subset A](../../spec/requirements/v1/package_1_2_text_pdf_ingestion_inspector.md#fr-si-01-subset-a--text-markdown-pdf--copied-text-ingestion), [Subset B](../../spec/requirements/v3/package_3_1_multimodal_ingestion_sync.md#fr-si-01-subset-b--office-web-video--audio-ingestion)
  * Dokumente: PDF (inkl. OCR für gescannte Seiten und Layout-/Tabellenerkennung), TXT, Markdown (`.md`), DOCX / Google Docs.
  * Präsentationen: PPTX / Google Slides (Extraktion von Folientexten und visuellen Elementen).
  * Web-Ressourcen: Öffentliche und interne Web-URLs (HTML-Scraping und Bereinigung auf den Hauptinhalt).
  * Video-Quellen: Video-URLs (z. B. YouTube oder interne Mediatheken) via Extraktion von Untertiteln/Transkripten inkl. Zeitstempeln.
  * Audio-Dateien: MP3, WAV, M4A etc. via automatischer Spracherkennung (ASR / Speech-to-Text) mit Zeitstempel-Segmentierung.
  * Rohtext: Direktes Einfügen von Text aus der Zwischenablage (*Copied Text*).
* **FR-SI-02 (Automatischer „Source Guide“ / Quellenüberblick):** Unmittelbar nach dem Upload einer Quelle muss ein Hintergrund-Agent automatisch: → FR-Karte: [FR-SI-02](../../spec/requirements/v2/package_2_2_proactive_context_intelligence_chat_control.md#fr-si-02--automatic-source-guide-quellenüberblick)
  1. Eine prägnante Zusammenfassung des Dokuments generieren.
  2. Eine Liste der zentralen Schlüsselthemen (*Key Topics* / Keywords) extrahieren, die als klickbare Filter oder Prompt-Auslöser dienen.
* **FR-SI-03 (Granulare Quellen-Selektion / Scoping):** In der Quellen-Seitenleiste muss jede Quelle eine Checkbox besitzen. Nutzer müssen für jede einzelne Chat-Anfrage oder Studio-Generierung frei wählen können, ob **alle** oder nur eine **spezifische Teilmenge** ($S_{\text{aktiv}} \subseteq S_{\text{gesamt}}$) der Quellen als Kontext genutzt werden. → FR-Karte: [FR-SI-03](../../spec/requirements/v1/package_1_2_text_pdf_ingestion_inspector.md#fr-si-03--granular-source-selection--scoping)
* **FR-SI-04 (Integrierter Quellen-Inspektor / Source Viewer):** Ein Klick auf eine Quelle in der Seitenleiste öffnet diese in einer Leseansicht innerhalb der App (inkl. Anzeige des Source Guides und des formatierten Volltexts bzw. Dokuments), ohne den aktuellen Arbeitsbereich zu verlassen. → FR-Karte: [FR-SI-04](../../spec/requirements/v1/package_1_2_text_pdf_ingestion_inspector.md#fr-si-04--integrated-source-inspector-source-viewer)
* **FR-SI-05 (Quellen-CRUD & Synchronisation):** Quellen müssen einzeln umbenannt, gelöscht oder – im Falle externer Dokumente/Webseiten – manuell oder per Webhook neu synchronisiert (*Re-Sync*) werden können, wenn sich das Originaldokument ändert. → FR-Karte: [FR-SI-05](../../spec/requirements/v3/package_3_1_multimodal_ingestion_sync.md#fr-si-05--source-crud-rename-delete--re-synchronization)
* **FR-SI-06 (Discover Sources Agent):** Der Nutzer kann ein Thema oder eine Forschungsfrage in ein Suchfeld („Quellen entdecken“) eingeben. Ein Recherche-Agent durchsucht daraufhin angebundene Suchindizes (Web oder Unternehmens-Intranet), präsentiert eine kuratierte Liste relevanter Treffer mit Kurzbeschreibung und erlaubt den 1-Klick-Import ausgewählter Treffer als neue Notebook-Quellen. → FR-Karte: [FR-SI-06](../../spec/requirements/v6/package_6_2_autonomous_research_agents_discover_deep_research.md#fr-si-06--discover-sources-agent-quellen-entdecken)
* **FR-SI-07 (Deep Research Agent):** Erweiterter agentischer Modus, der zu einer komplexen Fragestellung selbstständig mehrstufige Suchen durchführt, Fakten verifiziert, einen strukturierten Forschungsbericht generiert und sowohl den Bericht als auch die gefundenen Primärquellen direkt in das Notebook einspeist. → FR-Karte: [FR-SI-07](../../spec/requirements/v6/package_6_2_autonomous_research_agents_discover_deep_research.md#fr-si-07--multi-step-deep-research-agent)

---

### 3.3 Modul 3: Source-Grounded Chat & Citation Engine (GC)

Das Herzstück der Interaktion: Ein streng auf die ausgewählten Quellen beschränkter Konversations- und Analyse-Agent.

* **FR-GC-01 (Strikte Grounding-Policy):** Der Chat-Agent darf Antworten ausschließlich auf Basis der aktuell aktivierten Quellen ($S_{\text{aktiv}}$) und des bisherigen Gesprächsverlaufs formulieren. Ist eine Information nicht in den Quellen enthalten, muss das System dies explizit mitteilen und darf nicht auf allgemeines Weltwissen des vortrainierten Modells zurückgreifen (außer der Nutzer fordert explizit eine externe Web-/Intranet-Aktion an). → FR-Karte: [FR-GC-01](../../spec/requirements/v1/package_1_3_grounded_chat_citation_engine.md#fr-gc-01--strict-grounding-policy)
* **FR-GC-02 (Präzise Inline-Zitationen):** Jede inhaltliche Aussage in einer KI-Antwort muss mit mindestens einem nummerierten Zitat-Badge (z. B. `[1]`, `[2]`) versehen sein. → FR-Karte: [FR-GC-02](../../spec/requirements/v1/package_1_3_grounded_chat_citation_engine.md#fr-gc-02--precise-inline-citations)
* **FR-GC-03 (Interaktive Zitat-Verifikation):** → FR-Karte: [FR-GC-03](../../spec/requirements/v1/package_1_3_grounded_chat_citation_engine.md#fr-gc-03--interactive-citation-verification-hover--click)
  * *Hover:* Bewegt der Nutzer den Mauszeiger über ein Zitat-Badge `[n]`, erscheint ein Tooltip mit dem exakten Textausschnitt (*Snippet*) und dem Namen der Quelle.
  * *Klick:* Ein Klick auf `[n]` öffnet den Quellen-Inspektor (`FR-SI-04`), scrollt automatisch zur exakten Fundstelle im Originaldokument und hebt die referenzierte Textpassage farblich hervor.
* **FR-GC-04 (Notebook-Überblick & Starter-Prompts):** Beim Öffnen eines Notebooks mit geladenen Quellen zeigt der Chat-Bereich automatisch eine Gesamtzusammenfassung der aktuell ausgewählten, autorisierten Quellen sowie $3$ bis $5$ kontextbezogene Beispielfragen an. → FR-Karte: [FR-GC-04](../../spec/requirements/v2/package_2_2_proactive_context_intelligence_chat_control.md#fr-gc-04--notebook-overview--starter-prompts)
* **FR-GC-05 (Dynamische Follow-up-Vorschläge):** Nach jeder KI-Antwort generiert das System automatisch weiterführende Fragevorschläge (*Suggested Chips*), die das Thema vertiefen. → FR-Karte: [FR-GC-05](../../spec/requirements/v2/package_2_2_proactive_context_intelligence_chat_control.md#fr-gc-05--dynamic-follow-up-suggestions)
* **FR-GC-06 (Persistente Konversationshistorie):** Chat-Verläufe müssen sitzungsübergreifend gespeichert werden. Nutzer müssen vergangene Konversationen fortsetzen, durchsuchen oder den Chat-Verlauf bei Bedarf zurücksetzen/löschen können. → FR-Karte: [FR-GC-06](../../spec/requirements/v1/package_1_3_grounded_chat_citation_engine.md#fr-gc-06--persistent-conversation-history)
* **FR-GC-07 (Konfigurierbare Personas, Ziele & Antwortstile):** Über die Chateinstellungen des Notebooks muss der Nutzer das Antwortverhalten anpassen können: → FR-Karte: [FR-GC-07](../../spec/requirements/v2/package_2_2_proactive_context_intelligence_chat_control.md#fr-gc-07--configurable-personas-goals--response-styles)
  * *Antwortlänge:* Standard, Länger, Kürzer.
  * *Stil / Rolle:* Standard, Lern-Tutor (*Learning Guide* – stellt Rückfragen statt nur Lösungen zu präsentieren), Analytiker oder **Benutzerdefinierter System-Prompt** (bis zu $5.000$ Zeichen für spezifische Instruktionen, Tonalität und Rollenvorgaben).
* **FR-GC-08 (Sichere Code-Ausführungs-Sandbox / Cloud Computer):** Für quantitative Analysen, Datenbereinigungen oder komplexe Berechnungen auf hochgeladenen Datenquellen muss der Chat-Agent in einer isolierten Sandbox Programmcode (z. B. Python) schreiben, ausführen und die Ergebnisse (Werte, Diagramme, Dateien) in die Antwort einbetten können. → FR-Karte: [FR-GC-08](../../spec/requirements/v3/package_3_2_code_execution_sandbox.md#fr-gc-08--secure-code-execution-sandbox-cloud-computer)
* **FR-GC-09 (Antwort-Aktionen & Feedback):** Jede Antwort bietet Aktionen zum Kopieren (inkl. oder exkl. Quellenverweise), zum Speichern als Notiz (*Save to Note*) sowie zur Qualitätsbewertung (Daumen hoch/runter mit Fehlerkategorisierung wie „Halluzination“, „Falsches Zitat“, „Unvollständig“). → FR-Karte: [FR-GC-09](../../spec/requirements/v2/package_2_2_proactive_context_intelligence_chat_control.md#fr-gc-09--response-actions--quality-feedback)

---

### 3.4 Modul 4: Notizen- & Pinboard-Management (NM)

Dient der Kuratierung von Arbeitsergebnissen, eigenen Gedanken und gespeicherten KI-Erkenntnissen.

* **FR-NM-01 (Manuelle Notizerstellung):** Nutzer können jederzeit eigene Notizen mit einem Rich-Text-/Markdown-Editor innerhalb des Notebooks anlegen, bearbeiten und löschen. → FR-Karte: [FR-NM-01](../../spec/requirements/v2/package_2_3_notes_pinboard_lifecycle.md#fr-nm-01--manual-note-creation--editing)
* **FR-NM-02 (Speichern von Chat-Antworten als Notiz):** Mit einem Klick auf „Als Notiz speichern“ wird eine Chat-Antwort (inkl. ihrer Zitate) als schreibgeschützte oder editierbare Notiz im Studio-/Notizbereich abgelegt. → FR-Karte: [FR-NM-02](../../spec/requirements/v2/package_2_3_notes_pinboard_lifecycle.md#fr-nm-02--save-chat-response-as-note)
* **FR-NM-03 (Konvertierung: Notiz zu Quelle):** Einzelne Notizen oder alle Notizen eines Notebooks müssen per 1-Klick-Aktion („In Quelle umwandeln“) in eine formale Quelle im Quellen-Index (`Modul 2`) überführt werden können, sodass sie fortan für das Grounding und die Zitation zur Verfügung stehen. → FR-Karte: [FR-NM-03](../../spec/requirements/v2/package_2_3_notes_pinboard_lifecycle.md#fr-nm-03--convert-notes-to-source-1-click-roundtrip)
* **FR-NM-04 (KI-Operationen auf ausgewählten Notizen):** Wählt der Nutzer eine oder mehrere Notizen aus, stehen kontextsensitive KI-Aktionen bereit: → FR-Karte: [FR-NM-04](../../spec/requirements/v2/package_2_3_notes_pinboard_lifecycle.md#fr-nm-04--contextual-ai-operations-on-selected-notes)
  * *Zusammenfassen* der ausgewählten Notizen.
  * *Gliederung erstellen* (*Create Outline*).
  * *Verwandte Ideen vorschlagen* (auf Basis der Notebook-Quellen).
  * *Kritik / Review* des Notizinhalts.

---

### 3.5 Modul 5: Das „Studio“ – Multimodale Artefakt-Generierung (ST)

Das Studio ist eine dedizierte Werkzeugleiste zur asynchronen Generierung komplexer, multimodaler Wissensartefakte aus den aktuell ausgewählten Quellen ($S_{\text{aktiv}}$). Alle generierten Artefakte werden in einer Studio-Bibliothek des Notebooks gespeichert.

#### 3.5.1 Audio Overviews (KI-Podcast & Interaktiver Sprachmodus)
* **FR-ST-01 (Dialogische Audio-Synthese):** Generierung einer natürlich klingenden, mehrminütigen Audio-Diskussion („Deep Dive Podcast“) zwischen zwei KI-Moderierenden (Hosts), die den Inhalt der Quellen zusammenfassen, Metaphern nutzen und Zusammenhänge diskutieren. → FR-Karte: [FR-ST-01](../../spec/requirements/v5/package_5_1_studio_dialogic_audio_overviews_live_voice.md#fr-st-01--dialogic-2-host-audio-synthesis-deep-dive-podcast)
* **FR-ST-02 (Pre-Generation Customizing):** Vor der Generierung kann der Nutzer Parameter festlegen: → FR-Karte: [FR-ST-02](../../spec/requirements/v5/package_5_1_studio_dialogic_audio_overviews_live_voice.md#fr-st-02--audio-overview-pre-generation-customizing)
  * *Fokus-Instruktion:* Freitext-Prompt (z. B. „Fokussiere dich nur auf die Sicherheitsrisiken in Abschnitt 3“ oder „Richte das Gespräch an Einsteiger“).
  * *Format/Länge:* Kurzüberblick vs. ausführlicher Deep Dive.
  * *Ausgabesprache:* Mehrsprachige Generierung (unabhängig von der Sprache der Quelldokumente).
* **FR-ST-03 (Interaktiver Modus / „Join-In“):** Während des Abspielens des Audio Overviews kann der Nutzer in den interaktiven Modus wechseln und per Mikrofon („Beitreten“ / *Interrupt*) live Fragen stellen oder das Gespräch in eine andere Richtung lenken. Die KI-Hosts antworten unmittelbar im selben Stimmenprofil auf Basis der Notebook-Quellen und setzen anschließend die Diskussion fort. → FR-Karte: [FR-ST-03](../../spec/requirements/v5/package_5_1_studio_dialogic_audio_overviews_live_voice.md#fr-st-03--interactive-voice-mode-join-in--live-interrupt)
  * *Spezifikationsabweichung (DEV-01, 2026-10-16):* Bei Unterbrechung (Interrupt) pausiert die Wiedergabe. **Ein designierter Host** beantwortet die Live-Zwischenfrage in seiner Host-Stimme (über Gemini Live, quellenbasiert über `C-02`), woraufhin die Wiedergabe an der Unterbrechungsstelle fortgesetzt wird. Der zweite Host nimmt nicht an der Live-Beantwortung teil (siehe auch §5.4 `Gate v5.0` und §5.5).
* **FR-ST-04 (Audio-Player & Export):** Integrierter Player mit Geschwindigkeitsregelung ($0.5\times$ bis $2.0\times$), Hintergrundwiedergabe, Download als Audiodatei (`.mp3`/`.wav`) und Link-Sharing. → FR-Karte: [FR-ST-04](../../spec/requirements/v5/package_5_1_studio_dialogic_audio_overviews_live_voice.md#fr-st-04--audio-player-controls-background-playback--export)
  * *Release-Zuordnung (D10, 2026-10-16):* Player, Hintergrundwiedergabe und `.mp3`/`.wav`-Download werden mit v5.0 ausgeliefert. Das Link-Sharing folgt mit v6.0, da seine Zugriffsregeln auf den Freigaberollen aus `FR-WM-05` beruhen (siehe [D10](../solution-architecture.md#decisions)).

#### 3.5.2 Video Overviews
* **FR-ST-05 (Narrated Slideshow / Standard Video Overview):** Automatische Generierung eines Erklärvideos bestehend aus visuell gestalteten Präsentationsfolien (inkl. Diagrammen, Zitaten und Schlüsselbegriffen aus den Quellen) kombiniert mit einer synchronisierten KI-Sprecherstimme. → FR-Karte: [FR-ST-05](../../spec/requirements/v5/package_5_2_studio_video_overviews.md#fr-st-05--narrated-slideshow--standard-video-overview)
* **FR-ST-06 (Short Video Overviews):** Generierung kompakter Kurzvideos ($\approx 60\text{ s}$) mit edukativen Animationen für eine schnelle mobile Wiederholung. → FR-Karte: [FR-ST-06](../../spec/requirements/v5/package_5_2_studio_video_overviews.md)
* **FR-ST-07 (Cinematic Video Overviews):** Generierung voll animierter, filmischer Wissensvideos in wählbaren visuellen Stilen (z. B. *Scientific*, *Professional*, *Editorial*, *Sketch Note*) unter Einsatz generativer Bild-/Videomodelle. → FR-Karte: [FR-ST-07](../../spec/requirements/v5/package_5_2_studio_video_overviews.md#fr-st-07--cinematic-video-overviews-with-selectable-visual-styles)

#### 3.5.3 Visuelle Wissensgraphen (Mindmaps)
* **FR-ST-08 (Automatische Mindmap-Generierung):** Synthese der aktiven Quellen in einen hierarchischen, interaktiven Knoten-Kanten-Graphen (Zentralthema $\rightarrow$ Hauptkategorien $\rightarrow$ Unterthemen $\rightarrow$ Detailfakten). → FR-Karte: [FR-ST-08](../../spec/requirements/v3/package_3_3_studio_structure_data_extraction_mindmaps_tables.md#fr-st-08--automatic-mindmap-generation)
* **FR-ST-09 (Mindmap-Interaktivität):** → FR-Karte: [FR-ST-09](../../spec/requirements/v3/package_3_3_studio_structure_data_extraction_mindmaps_tables.md#fr-st-09--mindmap-interactivity-chat-drilldown--export)
  * Auf- und Zuklappen (*Expand/Collapse*) von Knotenebenen, Zoomen und Verschieben (*Pan/Zoom*).
  * Ein Klick auf einen spezifischen Knoten öffnet im Chat-Bereich automatisch eine detaillierte Erklärung und Quellensuche genau zu diesem Teilthema.
  * Export der Mindmap als Bilddatei (PNG/SVG).

#### 3.5.4 Berichte & Text-Synthese (Reports)
* **FR-ST-10 (Standard-Berichtsvorlagen):** 1-Klick-Generierung strukturierter Fachdokumente: → FR-Karte: [FR-ST-10](../../spec/requirements/v2/package_2_4_studio_text_synthesis_reports.md#fr-st-10--standard-report-templates-briefing-doc-study-guide-faq-timeline)
  * *Briefing Doc:* Management Summary mit Kernaussagen, wichtigen Fakten und Zitaten.
  * *Study Guide (Studienleitfaden):* Überblick, Glossar zentraler Begriffe, Kurzfragen mit Antworten und Essay-Themen.
  * *FAQ:* Häufig gestellte Fragen und fundierte Antworten aus dem Material.
  * *Timeline (Zeitleiste):* Chronologische Auflistung aller in den Quellen genannten Ereignisse inkl. einer Liste der Hauptakteure (*Cast of Characters*).
* **FR-ST-11 (Dynamische & Benutzerdefinierte Berichte):** Das System analysiert den Inhalt der Quellen und schlägt kontextspezifische Berichtsformate vor (z. B. „Marktanalyse“, „Methodik-Vergleich“, „Widerspruchs-Bericht“, „Blogpost“). Zudem kann der Nutzer eigene Berichtsstrukturen per Prompt definieren. → FR-Karte: [FR-ST-11](../../spec/requirements/v2/package_2_4_studio_text_synthesis_reports.md#fr-st-11--dynamic--custom-prompted-reports)
* **FR-ST-12 (Interactive Learning Overviews):** Kombinierte Berichte, die Zusammenfassungen, generierte Infografiken, Lernkarten und Quizze zu einem zusammenhängenden interaktiven Dokument verweben. → FR-Karte: [FR-ST-12](../../spec/requirements/v4/package_4_1_studio_active_learning_suite.md#fr-st-12--interactive-learning-overviews)

#### 3.5.5 Aktives Lernen (Flashcards & Quizzes)
* **FR-ST-13 (Interaktive Lernkarten / Flashcards):** Generierung von Frage-Antwort-Karten aus den Quellen. Jede Karte verfügt über eine Umdreh-Funktion (*Flip*) sowie einen **„Erklären“-Button (*Explain*)**, der im Chat eine ausführliche Herleitung mit direkten Quellenverweisen generiert. → FR-Karte: [FR-ST-13](../../spec/requirements/v4/package_4_1_studio_active_learning_suite.md#fr-st-13--interactive-flashcards-with-chat-explain-trigger)
* **FR-ST-14 (Interaktive Quizze):** Generierung von Wissensüberprüfungen mit unterschiedlichen Aufgabentypen: → FR-Karte: [FR-ST-14](../../spec/requirements/v4/package_4_1_studio_active_learning_suite.md#fr-st-14--interactive-quizzes-with-semantic-grading)
  * *Multiple Choice* (Einfachauswahl) & *Multiple Select* (Mehrfachauswahl).
  * *Fill-in-the-blank* (Lückentext) & *Short Answer* (Freitextantwort mit semantischer KI-Bewertung).
  * Sofortiges Feedback bei richtiger/falscher Antwort inkl. quellenbasierter Begründung.
* **FR-ST-15 (Lernfortschritts-Tracking):** Das System speichert pro Nutzer, welche Lernkarten und Quizfragen gewusst oder verfehlt wurden, um gezielte Wiederholungsrunden (*Spaced Repetition* / Fokus auf falsch beantwortete Fragen) zu ermöglichen. → FR-Karte: [FR-ST-15](../../spec/requirements/v4/package_4_1_studio_active_learning_suite.md#fr-st-15--per-user-learning-progress-tracking--targeted-review)

#### 3.5.6 Präsentationen, Infografiken & Datentabellen
* **FR-ST-16 (Slide Decks):** Generierung strukturierter Präsentationsfolien (Titel, Bullet-Points, visuelle Layouts, Sprechernotizen) mit Exportmöglichkeit (PPTX / PDF; Google Slides ist gemäß D8/DEV-02 zurückgestellt). → FR-Karte: [FR-ST-16](../../spec/requirements/v4/package_4_2_studio_visuals_presentations.md#fr-st-16--studio-slide-decks-with-pptx--pdf-export)
* **FR-ST-17 (Infografiken):** Generierung visueller Übersichten und Prozessgrafiken zu Kernaussagen der Quellen. → FR-Karte: [FR-ST-17](../../spec/requirements/v4/package_4_2_studio_visuals_presentations.md#fr-st-17--studio-visual-infographics)
* **FR-ST-18 (Data Tables):** Gezielte Extraktion strukturierter Daten, Vergleiche und Metriken über mehrere Dokumente hinweg in ein interaktives Tabellenformat (inkl. CSV-/Excel-Export). → FR-Karte: [FR-ST-18](../../spec/requirements/v3/package_3_3_studio_structure_data_extraction_mindmaps_tables.md#fr-st-18--studio-structured-data-tables--csvxlsx-export)

---

### 3.6 Modul 6: Ökosystem-Integration & Benutzeroberfläche (UI/INT)

* **FR-INT-01 (Integration in den zentralen Enterprise-Chat):** **Zurückgestellt ohne Zielrelease (D5, DEV-03); folgende Beschreibung bleibt für eine spätere Wiederaufnahme erhalten.** Analog zur `@Gemini Notebook`-Erweiterung in der Haupt-Gemini-App müssen Nutzer aus dem allgemeinen Unternehmens-Chatbot heraus: → FR-Karte: [FR-INT-01](../../spec/requirements/v6/package_6_3_ecosystem_integration_notebook_mention.md#fr-int-01--central-enterprise-chat-integration-notebook-mention--thread-export)
  * Auf bestehende Notebooks per `@Notebook`-Mention zugreifen und Fragen stellen können.
  * Einen laufenden allgemeinen Chat-Thread direkt als neues Notebook oder als Quelle in ein bestehendes Notebook exportieren können.
  * *Spezifikationsabweichung (DEV-03, 2026-10-16):* `FR-INT-01` ist zurückgestellt ([D5](../solution-architecture.md#decisions)) und nicht Teil des v6.0-Abnahmeumfangs. Die Architektur bleibt A2A-fähig, damit die Integration später ohne Umbau ergänzt werden kann.
* **FR-UI-01 (Adaptives 3-Spalten-Arbeitsplatz-Layout):** Die Web-Applikation muss als reaktive Single-Page-Application (SPA) mit drei klaren Funktionsbereichen aufgebaut sein: → FR-Karte: [FR-UI-01](../../spec/requirements/v1/package_1_4_ui_skeleton_quality_gates.md#fr-ui-01--adaptive-3-column-workspace-layout)
  1. **Linkes Panel (Quellen):** Quellenliste, Checkbox-Auswahl, Upload-Dialog, Discover-Sources-Suche und eingebetteter Source-Viewer (klappbar).
  2. **Mittleres Panel (Chat & Interaktion):** Konversationsverlauf, Zitat-Anzeige, Eingabeleiste mit Quellen-Zähler (`x Quellen ausgewählt`) und Prompt-Vorschläge.
  3. **Rechtes Panel (Studio & Notizen):** Kacheln zur Auslösung von Studio-Generierungen (Audio, Video, Mindmap, Reports, Flashcards, Quiz, Tables) sowie die Liste aller generierten Artefakte und gespeicherten Notizen.
* **FR-UI-02 (Sprach- & Darstellungsoptionen):** Unterstützung für Dark/Light Mode sowie globale und notebook-spezifische Festlegung der Ein- und Ausgabesprache. → FR-Karte: [FR-UI-02](../../spec/requirements/v2/package_2_1_workspace_ui_comfort.md#fr-ui-02--theme--language-configuration)

---

## 4. Nicht-Funktionale & Technische Anforderungen (NFR) für Spec-Driven Validation

Damit die Implementierung durch Entwicklungs-Agenten automatisiert geprüft (*validated*) werden kann, müssen folgende Systemeigenschaften und Metriken eingehalten werden:

### 4.1 Agentische Zielarchitektur (Laufzeit-Agenten der Plattform)
Für eine saubere Aufgabentrennung im Backend soll die Plattform als orchestriertes Multi-Agenten-System entworfen werden:

| Agent / Service | Primäre Verantwortung | Zugeordnete Anforderungen |
| :--- | :--- | :--- |
| **Ingestion & Indexing Agent** | Dokument-Parsing, Layout-Analyse, OCR, ASR, semantisches Chunking mit Positions-Offsets, Generierung des *Source Guides*. | `FR-SI-01` bis `FR-SI-05` |
| **Discovery & Research Agent** | Formulierung von Suchanfragen (Intranet/Web), Relevanzbewertung, Scraping, Multi-Step Deep Research. | `FR-SI-06`, `FR-SI-07` |
| **Grounded Reasoning & Citation Agent** | Hybrides Retrieval / Long-Context-Verarbeitung, strikte Antwortgenerierung mit Fine-Grained Citations, Halluzinationsprüfung (Self-Reflection). | `FR-GC-01` bis `FR-GC-07` |
| **Code Execution Agent** | Generierung und Ausführung von Analyse-Code in einer isolierten Sandbox (z. B. WebAssembly / MicroVM). | `FR-GC-08` |
| **Studio Synthesis Agents** | Spezialisierte Sub-Agenten für Skripterstellung + TTS-Dialog (Audio), Storyboard + Folien/Video-Rendering (Video), Graph-Extraktion (Mindmap), Pädagogik-Generierung (Quiz/Flashcards) und Datenextraktion (Tables). | `FR-ST-01` bis `FR-ST-18` |

### 4.2 Formale Validierungs- und Qualitätsmetriken (Eval-Specs)
* **NFR-EVAL-01 (Grounding Faithfulness):** Jede generierte Antwort $A$ zu einer Quellenmenge $S_{\text{aktiv}}$ muss durch einen automatisierten *LLM-as-a-Judge*- bzw. NLI-Prüfschritt validiert werden können. Die Halluzinationsrate (Aussagen in $A$, die nicht aus $S_{\text{aktiv}}$ ableitbar sind) muss im Benchmark unter einem Schwellenwert von $\epsilon_{\text{hallucination}} < 0{,}05$ ($5\,\%$) liegen. → FR-Karte: [NFR-EVAL-01](../../spec/requirements/v1/package_1_4_ui_skeleton_quality_gates.md#nfr-eval-0104--nfr-sec-01--automated-evaluation--security-gate-suite)
* **NFR-EVAL-02 (Citation Precision & Recall):** Jedes generierte Zitat `[n]` muss auf einen real existierenden Chunk-Identifier $c_n \in S_{\text{aktiv}}$ verweisen (keine „toten“ oder erfundenen Referenzen: $\text{Precision}_{\text{ID}} = 1{,}0$). Der referenzierte Textausschnitt $c_n$ muss die im Satz getroffene Aussage semantisch stützen. → FR-Karte: [NFR-EVAL-02](../../spec/requirements/v1/package_1_4_ui_skeleton_quality_gates.md#nfr-eval-0104--nfr-sec-01--automated-evaluation--security-gate-suite)
* **NFR-EVAL-03 (Negative Rejection Test):** Bei Fragen zu Fakten, die nachweislich **nicht** in $S_{\text{aktiv}}$ enthalten sind (obwohl sie Teil des allgemeinen Weltwissens des Basis-LLMs sind), muss das System in $\ge 99\,\%$ der Testfälle die Beantwortung unter Hinweis auf die fehlende Quellengrundlage ablehnen. → FR-Karte: [NFR-EVAL-03](../../spec/requirements/v1/package_1_4_ui_skeleton_quality_gates.md#nfr-eval-0104--nfr-sec-01--automated-evaluation--security-gate-suite)
* **NFR-EVAL-04 (Striktes Kontext-Scoping):** Ist eine Quelle $s_i$ im UI abgewählt ($s_i \notin S_{\text{aktiv}}$), darf kein einziger Chunk aus $s_i$ in den Prompt-Kontext oder das Retrieval-Ergebnis gelangen ($\text{Leakage} = 0$). → FR-Karte: [NFR-EVAL-04](../../spec/requirements/v1/package_1_4_ui_skeleton_quality_gates.md#nfr-eval-0104--nfr-sec-01--automated-evaluation--security-gate-suite)

### 4.3 Enterprise Security, Datenschutz & Performance
* **NFR-SEC-01 (Zero Data Training & Isolation):** Hochgeladene Unternehmensdaten, Prompts und generierte Artefakte dürfen unter keinen Umständen zum Training von Basismodellen verwendet werden. → FR-Karte: [NFR-SEC-01](../../spec/requirements/v1/package_1_4_ui_skeleton_quality_gates.md#nfr-eval-0104--nfr-sec-01--automated-evaluation--security-gate-suite)
* **NFR-SEC-02 (Rollenspezifische Zugriffskontrolle / ACLs):** Die Plattform muss an das zentrale Identity & Access Management (SSO / OIDC / SAML) angebunden sein. Bei angebundenen Unternehmensquellen (z. B. Intranet-Suche im *Discover Sources*-Modus) müssen bestehende Dokumenten-Berechtigungen (ACLs) des jeweiligen Nutzers strikt respektiert werden. → FR-Karte: [NFR-SEC-02](../../spec/requirements/v6/package_6_1_enterprise_governance_sharing_analytics.md#nfr-sec-02--enterprise-sso-oidcsaml--document-level-acl-enforcement)
* **NFR-PERF-01 (Kontextfenster & Retrieval-Latenz):** Das System muss ein effektives Kontextfenster von mindestens $1 \times 10^6$ Tokens (oder eine äquivalente verlustfreie Kombination aus Long-Context-LLM und hochpräzisem Hybrid-RAG) unterstützen. Die Time-to-First-Token (TTFT) im Chat sollte bei Standardabfragen $\le 2{,}5\text{ s}$ betragen. → FR-Karte: [NFR-PERF-01](../../spec/requirements/v3/package_3_4_long_context_latency_scaling.md)

---

## 5. Inkrementelle Release-Roadmap & Versionspakete (Spec-Driven Milestones)

Um eine konfliktfreie, agentische Entwicklung zu gewährleisten, wird das Gesamtsystem in **sechs aufeinander aufbauende Releases ($V_{1.0}$ bis $V_{6.0}$)** unterteilt. Jede Version erweitert das System um fachlich und technisch kohärente Funktionspakete, stellt einen **vollständig lauffähigen, produktiv nutzbaren Anwendungsstand** dar und bildet die geplante Gesamtmenge der aktiven Anforderungen; FR-SI-01 und FR-WM-07 werden in gestuften Teilmengen geliefert, FR-INT-01 bleibt gemäß D5 außerhalb dieser Releases:

$$\text{Gesamtsystem} = V_{1.0\text{ (MVP)}} \cup V_{2.0} \cup V_{3.0} \cup V_{4.0} \cup V_{5.0} \cup V_{6.0}$$

### 5.1 Architektonische Entkopplungs-Verträge (Vermeidung von Abhängigkeitskonflikten)

Damit spätere Releases niemals zu Breaking Changes oder Refactoring-Konflikten in bereits abgenommenen Modulen führen, werden bereits in $V_{1.0}$ und $V_{2.0}$ drei unveränderliche Kern-Schnittstellen (*Architectural Contracts*) definiert:

1. **Contract C-01 (`UnifiedDocumentChunk`-Schema):** Jeder Ingestion-Parser (egal ob PDF in $V_{1.0}$, Audio/Video in $V_{3.0}$ oder Deep-Research in $V_{6.0}$) überführt Quelldaten in dasselbe normierte Datenobjekt:
   $$\text{Chunk} = (\texttt{source\_id}, \texttt{chunk\_id}, \texttt{text}, \texttt{token\_count}, \texttt{locator})$$
   wobei $\texttt{locator}$ polymorph als Seiten-/Absatz-Offset (`page_span`; physische Seite optional für reine Textquellen, mit deterministischen Text-/Absatz-Offsets), Zeitstempel-Intervall (`time_span`) oder DOM-Pfad (`dom_path`) ausgeprägt ist. Folien nutzen `page_span` im normalisierten Viewer; `char_span` und `slide_number` sind keine zusätzlichen Locator-Varianten. Die Citation Engine und alle Studio-Agenten arbeiten ausschließlich gegen dieses Schema.
2. **Contract C-02 (`ScopedContextProvider`-Schnittstelle):** Kein Agent (weder Chat noch Studio) greift direkt auf Datenbanktabellen zu. Alle Konsumenten rufen ausschließlich `getScopedContext(notebook_id, active_source_ids)` auf. Dadurch ist `NFR-EVAL-04` ($\text{Leakage} = 0$) zentral an einer einzigen Stelle garantiert.
3. **Contract C-03 (`StudioPluginRegistry` & Asynchrones Job-Pattern):** Jedes Studio-Feature implementiert ein einheitliches Interface `StudioGeneratorPlugin` (`triggerJob(scoped_context, params) -> artifact_id`) und legt sein Ergebnis als typisiertes JSON-/Media-Payload in derselben `StudioArtifact`-Tabelle ab. Neue Studio-Kacheln in $V_{3.0}$, $V_{4.0}$ und $V_{5.0}$ werden als unabhängige Plugins registriert, ohne bestehenden Code zu modifizieren (*Open-Closed Principle*).

---

### 5.2 Übersicht der Release-Meilensteine

| Version | Release-Name | Fokus & Nutzbarer Mehrwert | Neue Agenten / Services |
| :--- | :--- | :--- | :--- |
| **v1.0 (MVP)** | **Core Grounded Workspace** | Lauffähige Basis-App: Notebooks anlegen, Text/PDF-Quellen hochladen, Quellen an-/abwählen, strikt quellenbasierter Chat mit klickbaren Inline-Zitaten und Dokumenten-Inspektor. | *Ingestion Agent (Text/PDF)*, *Grounded Reasoning & Citation Agent* |
| **v2.0** | **Knowledge Curation & Text Studio** | Produktiver Wissensarbeitsplatz: Automatischer Source Guide, Starter-Prompts, Persona-Steuerung, komplettes Notiz-Pinboard (inkl. Notiz $\rightarrow$ Quelle) sowie Studio-Textberichte. | *Source Guide Worker*, *Note Assistant*, *Report Synthesis Agent* |
| **v3.0** | **Multimodal Ingestion & Data Analytics** | Tiefe Medien- und Datenanalyse: Import von Audio, Video, Web, DOCX/PPTX; Re-Sync; interaktive Mindmaps, Datentabellen-Extraktion und Python-Code-Sandbox. | *ASR/Video/Web/Office Parsers*, *Code Execution Agent*, *Graph & Table Agents* |
| **v4.0** | **Active Learning & Visual Studio** | Didaktik & Präsentation: Interaktive Lernkarten, Quiz-Engine mit Fortschritts-Tracking, Learning Overviews, Folien-Generator (Slide Decks) und Infografiken. | *Pedagogy Agent (Quiz/Flashcards)*, *Slide & Infographic Agent* |
| **v5.0** | **Generative Broadcast Studio (Audio & Video)** | High-End Medien-Synthese: Dialogischer 2-Host-KI-Podcast (Audio Overview), Echtzeit-Sprachinteraktion („Join-In“) sowie Narrated, Short und Cinematic Video Overviews. | *Audio Podcast & Live-Voice Agent*, *Video Rendering Pipeline* |
| **v6.0** | **Enterprise Scale, Collaboration & Autonomous Research** | Unternehmensweite Skalierung: Rollenbasiertes Sharing, Analytics, SSO/ACL-Durchsetzung, autonome Recherche-Agenten (Discover & Deep Research). `@Notebook` bleibt zurückgestellt (D5/DEV-03). | *Discovery & Deep Research Agent*, *Enterprise ACL* (Ecosystem Gateway zurückgestellt) |

---

### 5.3 Detaillierte Spezifikation der Versionspakete

#### Version 1.0 (MVP): Core Grounded Workspace („Walking Skeleton“)
* **Lauffähiger Zustand:** Ein Nutzer kann sich anmelden, ein isoliertes Notebook erstellen, PDF-, TXT- oder Markdown-Dokumente hochladen sowie Rohtext einfügen. Im 3-Spalten-Grundlayout (links: Quellen, Mitte: Chat, rechts: vorbereiteter Container) kann er Quellen per Checkbox aktivieren/deaktivieren und im Chat Fragen stellen. Jede Antwort ist streng auf die aktiven Quellen beschränkt und enthält klickbare Zitat-Badges `[n]`, die beim Hovern den Textausschnitt zeigen und beim Klicken im linken Quellen-Inspektor exakt zur hervorgehobenen Textstelle springen.
* **Zugeordnete Funktionspakete:**
  * *Paket 1.1 – Workspace Foundation:* `FR-WM-01` (Notebook CRUD), `FR-WM-04` (Isolierter Wissenskontext), Basis-Quotas aus `FR-WM-07`.
  * *Paket 1.2 – Text/PDF Ingestion & Inspector:* `FR-SI-01` (*Teilpaket A: PDF inkl. OCR, TXT, Markdown, Rohtext*), `FR-SI-03` (Granulare Quellen-Selektion $S_{\text{aktiv}} \subseteq S_{\text{gesamt}}$), `FR-SI-04` (Integrierter Quellen-Inspektor mit Highlight-Scroll).
  * *Paket 1.3 – Grounded Chat & Citation Engine:* `FR-GC-01` (Strikte Grounding-Policy), `FR-GC-02` (Inline-Zitationen), `FR-GC-03` (Hover-Tooltip & Klick-Sprung), `FR-GC-06` (Persistente Konversationshistorie).
  * *Paket 1.4 – UI-Grundgerüst & Qualitäts-Gates:* `FR-UI-01` (Adaptives Layout-Grundgerüst), `NFR-SEC-01` (Zero Data Training), `NFR-EVAL-01` bis `NFR-EVAL-04` (Automatisierte Test-Suite für Grounding, Citations, Negative Rejection und Scoping).
* **Technische Unabhängigkeit:** Legt das Datenbankschema, den `UnifiedDocumentChunk`-Vertrag (`C-01`) und den `ScopedContextProvider` (`C-02`) final an. Keine Abhängigkeit zu asynchronen Hintergrund-Medienpipelines.

---

#### Version 2.0: Knowledge Curation, Pinboard & Text Studio
* **Lauffähiger Zustand:** Baut direkt auf $V_{1.0}$ auf und macht das Notebook vom reinen Frage-Antwort-Tool zum vollständigen Text-Arbeitsplatz. Hochgeladene Quellen erhalten sofort einen *Source Guide* (Zusammenfassung + Themen-Chips). Der leere Chat begrüßt den Nutzer mit einer Gesamtzusammenfassung und Starter-Fragen. Antworten liefern Follow-up-Vorschläge, lassen sich über Personas/System-Prompts steuern und per Klick als Notiz im rechten Panel sichern. Eigene und gespeicherte Notizen können bearbeitet, durch KI-Aktionen verdichtet oder per 1-Klick wieder in vollwertige Notebook-Quellen umgewandelt werden. Zudem schaltet das rechte Studio-Panel die ersten 1-Klick-Generatoren für strukturierte Textberichte frei.
* **Zugeordnete Funktionspakete:**
  * *Paket 2.1 – Workspace & UI Komfort:* `FR-WM-02` (Icons, Zeitstempel, Quellenzähler), `FR-WM-03` (Raster-/Listenansicht, Sortierung, Pinning), `FR-UI-02` (Dark/Light Mode, Sprachwahl).
  * *Paket 2.2 – Proaktive Kontext-Intelligenz & Chat-Steuerung:* `FR-SI-02` (Automatischer Source Guide), `FR-GC-04` (Notebook-Überblick & Starter-Prompts), `FR-GC-05` (Follow-up-Chips), `FR-GC-07` (Personas, Antwortlängen & System-Prompt), `FR-GC-09` (Kopieren, Save-to-Note, Qualitäts-Feedback).
  * *Paket 2.3 – Notizen- & Pinboard-Kreislauf:* `FR-NM-01` (Manuelle Rich-Text/Markdown-Notizen), `FR-NM-02` (Chat-Antwort als Notiz speichern), `FR-NM-03` (1-Klick-Konvertierung: Notiz $\rightarrow$ Quelle), `FR-NM-04` (KI-Operationen auf Notizen).
  * *Paket 2.4 – Studio: Text-Synthese (Reports):* `FR-ST-10` (Briefing Doc, Study Guide, FAQ, Timeline), `FR-ST-11` (Dynamische & benutzerdefinierte Berichte).
* **Technische Unabhängigkeit:** Führt im rechten Panel die `StudioPluginRegistry` (`C-03`) ein. Die Funktion „Notiz zu Quelle“ (`FR-NM-03`) übergibt den Markdown-Text der Notiz einfach an den bereits in $V_{1.0}$ gebauten Markdown-Ingestion-Parser – null Duplizierung oder Konflikt.

---

#### Version 3.0: Multimodal Ingestion, Visual Graphs & Data Analytics
* **Lauffähiger Zustand:** Das System verarbeitet nun neben PDFs/Texten auch Office-Dateien (DOCX, PPTX), Webseiten (URLs), Videos (inkl. Zeitstempel-Transkripten) und Audiodateien (via ASR) und kann geänderte Quellen neu synchronisieren. Im Chat steht eine isolierte Python-Sandbox für exakte Datenberechnungen und Diagramme bereit. Im Studio können Nutzer aus ihren Quellen interaktive Mindmaps (inkl. Klick-Drilldown in den Chat) sowie strukturierte Datentabellen (mit CSV/Excel-Export) generieren.
* **Zugeordnete Funktionspakete:**
  * *Paket 3.1 – Multimodale Ingestion & Sync:* `FR-SI-01` (*Teilpaket B: DOCX, PPTX, Web-URLs, Video-URLs, Audio-Dateien via ASR*), `FR-SI-05` (Quellen-Umbenennung, Löschung & Re-Sync).
  * *Paket 3.2 – Quantitative Code-Sandbox:* `FR-GC-08` (Isolierte Python-Code-Ausführung im Chat für Berechnungen und Plots).
  * *Paket 3.3 – Studio: Struktur- & Daten-Extraktion:* `FR-ST-08` (Automatische Mindmap-Generierung), `FR-ST-09` (Mindmap-Interaktivität & Chat-Verknüpfung), `FR-ST-18` (Data Tables inkl. CSV/Excel-Export).
  * *Paket 3.4 – Long-Context & Latenz-Skalierung:* `NFR-PERF-01` ($10^6$ Tokens effektives Kontextfenster, Hybrid-RAG-Optimierung auf $\text{TTFT} \le 2{,}5\text{ s}$).
* **Technische Unabhängigkeit:** Die neuen Audio-, Video-, Web- und Office-Parser sind reine *Adapter*, die am Ausgang exakt `Contract C-01` (`UnifiedDocumentChunk`) bedienen. Der Source-Viewer (`FR-SI-04`) erhält lediglich einen Media-/Timestamp-Player-Aufsatz, während Citation Engine und Studio unverändert weiterlaufen.

---

#### Version 4.0: Active Learning & Visual Presentation Studio
* **Lauffähiger Zustand:** Das Notebook wird zur interaktiven Lern- und Präsentationsplattform. Nutzer können aus ihren aktiven Quellen per Klick interaktive Karteikarten (mit Umdreh-Funktion und „Erklären“-Button im Chat), vielseitige Quizze (Multiple Choice, Lückentext, KI-bewertete Freitextantworten) inkl. Spaced-Repetition-Fortschritt sowie kombinierte *Interactive Learning Overviews* erzeugen. Für Meetings generiert das Studio komplette Präsentationsfolien (Slide Decks) und visuelle Infografiken.
* **Zugeordnete Funktionspakete:**
  * *Paket 4.1 – Studio: Active Learning Suite:* `FR-ST-13` (Interaktive Flashcards mit Chat-Explain-Trigger), `FR-ST-14` (Interaktive Quizze mit semantischer Bewertung), `FR-ST-15` (Lernfortschritts-Tracking pro Nutzer), `FR-ST-12` (Interactive Learning Overviews).
  * *Paket 4.2 – Studio: Visuals & Presentations:* `FR-ST-16` (Slide Decks mit PPTX/PDF-Export), `FR-ST-17` (Generierte Infografiken).
* **Technische Unabhängigkeit:** Alle neuen Generatoren klinken sich als unabhängige Plugins in die `StudioPluginRegistry` (`C-03`) ein. Der „Erklären“-Button einer Lernkarte (`FR-ST-13`) und eines Mindmap-Knotens (`FR-ST-09`) nutzt dieselbe scope-geprüfte Übergabe an den Chat wie die Topic-/Starter-/Follow-up-Aktionen aus $V_{2.0}$; Inhalte abgewählter Quellen werden dabei nicht erneut in Prompts übernommen (NFR-EVAL-04).

---

#### Version 5.0: Generative Broadcast Studio (Audio & Video Overviews)
* **Lauffähiger Zustand:** Freischaltung der komplexen generativen Audio- und Video-Pipelines im Studio. Nutzer können mehrsprachige, auf Wunsch fokussierte KI-Podcasts (*Audio Overviews*) mit zwei Moderierenden generieren, diese im integrierten Player abspielen und über den **„Join-In“-Modus** live per Mikrofon Fragen stellen, worauf ein designierter Host gemäß DEV-01 in Echtzeit antwortet. Zudem erzeugt das Studio automatisch vertonte Erklärvideos (*Narrated Slideshows*), kompakte $60\text{-s}$-Kurzvideos (*Shorts*) und voll animierte *Cinematic Video Overviews*.
* **Zugeordnete Funktionspakete:**
  * *Paket 5.1 – Studio: Dialogische Audio Overviews & Live-Voice:* `FR-ST-01` (2-Host-Audio-Synthese), `FR-ST-02` (Pre-Generation Customizing: Fokus, Länge, Sprache), `FR-ST-03` (Interaktiver Echtzeit-Sprachmodus / „Join-In“), `FR-ST-04` (Audio-Player mit Speed-Control & MP3/WAV-Export).
  * *Paket 5.2 – Studio: Video Overviews:* `FR-ST-05` (Narrated Slideshow Video), `FR-ST-06` (Short Video Overviews), `FR-ST-07` (Cinematic Video Overviews in wählbaren Stilen).
* **Technische Unabhängigkeit:** `FR-ST-05` (Narrated Slideshow) baut direkt und konfliktfrei auf der in $V_{4.0}$ geschaffenen Slide-Deck-Engine (`FR-ST-16`) und der TTS-Pipeline aus `Paket 5.1` auf. Der interaktive „Join-In“-Modus (`FR-ST-03`) nutzt einen dedizierten WebRTC-/WebSocket-Audio-Stream, der im Backend denselben `ScopedContextProvider` (`C-02`) abfragt wie der Text-Chat.

---

#### Version 6.0: Enterprise Scale, Collaboration & Autonomous Research
* **Lauffähiger Zustand:** Ausbau der Einzelplatz-Lösung zur unternehmensweiten Wissensplattform. Notebooks können mit feingranularen Rollen (*Owner/Editor*, *Viewer Vollansicht*, *Viewer Chat-Only*) für Teams freigegeben und über ein Analytics-Dashboard ausgewertet werden. Die Plattform erzwingt über SSO/OIDC sämtliche Dokumenten-ACLs des Unternehmens. Zwei autonome Recherche-Agenten (*Discover Sources* und mehrstufiger *Deep Research Agent*) durchsuchen selbstständig das Unternehmens-Intranet und das Web nach neuen Quellen. Die ursprünglich vorgesehene `@Notebook`-Integration bleibt ohne Zielrelease zurückgestellt (D5/DEV-03).
* **Zugeordnete Funktionspakete:**
  * *Paket 6.1 – Enterprise Governance, Sharing & Analytics:* `FR-WM-05` (Rollenbasiertes Sharing inkl. Chat-Only-Modus), `FR-WM-06` (Notebook-Analytics Dashboard), `FR-WM-07` (Enterprise-Quota-Management), `NFR-SEC-02` (SSO/OIDC/SAML & strikte Durchsetzung von Dokumenten-ACLs).
  * *Paket 6.2 – Autonome Recherche-Agenten:* `FR-SI-06` (Discover Sources Agent für Intranet/Web), `FR-SI-07` (Multi-Step Deep Research Agent inkl. Primärquellen- und Berichts-Import).
  * *Paket 6.3 – Ökosystem-Integration (zurückgestellt, kein Bestandteil von v6.0; D5/DEV-03):* `FR-INT-01` (`@Notebook`-Mention im zentralen Enterprise-Chat & Export von Chat-Threads als Notebook-Quelle).
* **Technische Unabhängigkeit:** Die Recherche-Agenten (`FR-SI-06`, `FR-SI-07`) agieren als vorgeschaltete Such-Orchestratoren, die gefundene Dokumente über die bestehende Ingestion-Pipeline ($V_{1.0}/V_{3.0}$) und Berichte über die Report-Engine ($V_{2.0}$) einspeisen. Der *Chat-Only*-Viewer-Modus (`FR-WM-05`) blendet im Frontend (`FR-UI-01`) das linke und rechte Panel aus und blockiert auch lesende Rohquellen-, Chunk-, Notiz- und Studio-API-Endpunkte serverseitig; ausschließlich antwortgebundene autorisierte Zitatvorschauen bleiben verfügbar.

---

### 5.4 Abnahme- und Validierungs-Matrix (Release Gates für Entwicklungs-Agenten)

Ein Entwicklungs-Agent darf erst dann mit der Implementierung von Version $V_{k+1}$ beginnen, wenn alle automatisierten Spec-Gates von Version $V_k$ erfolgreich durchlaufen wurden ($\text{Gate}(V_k) = \text{PASS}$):

| Release | Verpflichtendes Validierungs-Gate (Automated Acceptance Criteria) |
| :--- | :--- |
| **Gate v1.0** | **1.** End-to-End-Upload (PDF/MD) erzeugt valide `UnifiedDocumentChunk`-Einträge.<br>**2.** `NFR-EVAL-01` bis `04` bestanden ($\epsilon_{\text{hallucination}} < 0{,}05$, $\text{Precision}_{\text{ID}} = 1{,}0$, $\text{Rejection} \ge 99\,\%$, $\text{Leakage} = 0$).<br>**3.** Klick auf Zitat `[n]` scrollt im UI-Test deterministisch zum richtigen DOM-Element im Source-Viewer. |
| **Gate v2.0** | **1.** Jeder erfolgreich ingestierte Upload triggert asynchron `FR-SI-02` (Source Guide $< 10\text{ s}$ P95 ab `Ready`; Fehler dürfen das Quellenlesen nicht blockieren).<br>**2.** Rundreise-Test bestanden: *Chat-Antwort $\rightarrow$ Als Notiz speichern $\rightarrow$ In Quelle umwandeln $\rightarrow$ Neue Quelle ist im nächsten Chat-Turn zitierbar*.<br>**3.** Alle 4 Standard-Berichtsvorlagen (`FR-ST-10`) generieren valide, quellenbelegte Dokumente. |
| **Gate v3.0** | **1.** Audio-/Video-Uploads erzeugen Chunks mit klickbaren Zeitstempel-Locators (`mm:ss`).<br>**2.** Python-Sandbox (`FR-GC-08`) ist netzwerkisoliert und gibt korrekte Rechenergebnisse/Plots zurück.<br>**3.** Mindmap-JSON ist azyklisch/hierarchisch; Tabellen-Export liefert valides CSV/XLSX; Kontextfenster skaliert bis $10^6$ Tokens (`NFR-PERF-01`). |
| **Gate v4.0** | **1.** Lernkarten- und Quiz-Generatoren decken nur aktive Quellen $S_{\text{aktiv}}$ ab.<br>**2.** Lernfortschritts-State (`FR-ST-15`) persistiert falsch beantwortete Fragen für gezielte Wiederholung.<br>**3.** Slide-Deck-Export liefert fehlerfrei öffnende PPTX-/PDF-Dateien. |
| **Gate v5.0** | **1.** Audio-Synthese liefert 2-Sprecher-Dialog ohne Überlappungsartefakte.<br>**2.** Live-Voice-Interrupt (`FR-ST-03`) pausiert den Stream, beantwortet die Zwischenfrage streng *source-grounded* durch einen designierten Host im passenden Stimmenprofil (DEV-01) und setzt den Podcast fort.<br>**3.** Video-Rendering-Pipeline erzeugt synchronisierte MP4/WebM-Streams für alle drei Modi (`FR-ST-05` bis `07`). |
| **Gate v6.0** | **1.** Penetration-/RBAC-Test: Ein *Chat-Only*-Nutzer kann weder über UI noch via direktem API-Call Rohquellen oder Studio-Endpunkte abrufen.<br>**2.** ACL-Test (`NFR-SEC-02`): *Discover Sources* findet niemals Intranet-Dokumente, für die dem anfragenden Nutzer die Leseberechtigung fehlt.<br>**3.** *(Zurückgestellt, DEV-03 / D5)* `@Notebook`-Aufruf im externen Enterprise-Chat liefert identisch fundierte Antworten wie der interne Notebook-Chat. Kein Bestandteil der v6.0-Abnahme, bis D5 neu bewertet wird. |

---

### 5.5 Dokumentierte Spezifikationsabweichungen (Spec Deviation Log)

Zur Wahrung des Prinzips der Spezifikation als Single Source of Truth für Entwicklungs- und Test-Agenten werden architektonische und betriebliche Abweichungen vom ursprünglichen Referenzverhalten hier explizit festgehalten. Abweichungen, die eine Architekturentscheidung erfordern, verweisen auf deren ID (Dn) in der [Lösungsarchitektur](../solution-architecture.md#decisions):

| ID | Anforderung / Gate | Ursprüngliche Anforderung | Akzeptiertes Verhalten (Architecture Decision) | Datum & Beschluss |
| :--- | :--- | :--- | :--- | :--- |
| **DEV-01** | `FR-ST-03` (Join-In), `Gate v5.0` #2 | Beide KI-Hosts antworten unmittelbar im selben Stimmenprofil auf Zwischenfragen und setzen anschließend die Diskussion fort. | Playback pausiert. **Ein designierter Host** beantwortet die Live-Frage in seiner Host-Podcast-Stimme über Gemini Live (grounded über `C-02`). Playback wird anschließend an der Unterbrechungsstelle fortgesetzt. Der zweite Host nimmt nicht an der Live-Antwort teil. | 2026-10-16, Project Owner ([D7](../solution-architecture.md#decisions)) |
| **DEV-02** | `FR-ST-16` (Slide Decks) | Export als PPTX / PDF / Google Slides. | Export ausschließlich als `.pptx` und `.pdf`. Der Google-Slides-Export ist zurückgestellt, da er eine OAuth-Autorisierung pro Nutzer erfordert. | 2026-10-16, Project Owner ([D8](../solution-architecture.md#decisions)) |
| **DEV-03** | `FR-INT-01` (`@Notebook`), Paket 6.3, `Gate v6.0` #3 | `@Notebook`-Mention im zentralen Enterprise-Chat und Export von Chat-Threads als Notebook oder Quelle in v6.0. | Zurückgestellt. Paket 6.3 wird nicht spezifiziert; Gate v6.0 #3 ist nicht Teil der v6.0-Abnahme. Der Chat-Agent bleibt zustandslos hinter `C-02` und A2A-fähig. | 2026-10-16, Project Owner ([D5](../solution-architecture.md#decisions)) |
| **DEV-04** | v2.0-Pakete 2.1–2.4 (`FR-WM-02/03`, `FR-UI-02`, `FR-SI-02`, `FR-GC-04/05/07/09`, `FR-NM-01..04`, `FR-ST-10/11`), `Gate v2.0` | Persistente Speicherung aller v2-Daten (Präferenzen, Icons, Pins, Source Guides, Übersichten, Chat-Konfiguration, Feedback, Notizen, Studio-Artefakte). | **Proof of Concept:** v2-Daten liegen bis v3 im Prozessspeicher einer einzelnen API-Instanz und gehen bei Neustart oder Redeploy verloren. Zugriffskontrolle, Quellen und Chat bleiben unverändert in PostgreSQL (v1). Ausnahme: Aus Notizen erzeugte Quellen (Notiz-Quellen, `FR-NM-03/04`) sind normale v1-Quellen in PostgreSQL (`media_type: note_markdown`) mit gemeinsamem Quellen-Limit; die Notizen selbst bleiben im Prozessspeicher. Die Umstellung auf PostgreSQL ist bewusst nach v3 verschoben. **Aufgehoben 2026-10-21 (specs/013):** Alle v2-Daten liegen in PostgreSQL (Migrationen `0005`–`0008`) und überstehen Neustart und Redeploy. Weiterhin gilt: eine API-Instanz, v2-Hintergrundarbeit läuft im API-Prozess; beim Start werden unterbrochene Studio-Berichte als fehlgeschlagen markiert (Retry möglich) und unterbrochene Source Guides neu erzeugt ([D16](../solution-architecture.md#decisions)). | 2026-10-19, Project Owner; Ausnahme Notiz-Quellen 2026-10-20 ([D16](../solution-architecture.md#decisions)); aufgehoben 2026-10-21, Project Owner (specs/013) |

### 5.6 Konsistenzklärungen der FR-Karten (2026-10-16)

Diese Klarstellungen lösen Widersprüche innerhalb der bestehenden IDs auf; sie ändern keine
Constitution-Prinzipien und erteilen keine Freigabe zum Aktivieren von Cloud-APIs.

- **v2.0 Proof of Concept (Beschluss Project Owner 2026-10-19, DEV-04/D16):** Die v2-Pakete
  liefen zunächst mit Prozessspeicher statt PostgreSQL, damit früher ein lauffähiger Proof of
  Concept bereitstand. **Umgesetzt 2026-10-21 (specs/013, v3-Voraussetzung):** Die v2-Daten liegen
  in PostgreSQL und überstehen Neustart und Redeploy; Schnittstellen und Verhalten der v2-Pakete
  bleiben unverändert. Es bleibt bei einer API-Instanz (D16).
- **v2.0-Kartenreview (Beschluss Project Owner 2026-10-20):** Notiz-KI-Aktionen (`FR-NM-04`)
  verwenden eine bereits konvertierte Notiz-Quelle wieder, wenn dieselben Notizen in derselben
  Revision vorliegen; nur neue oder geänderte Inhalte belegen einen Quellen-Slot. Eine Zeitleiste
  (`FR-ST-10`) ohne datierte Ereignisse wird mit einem ausdrücklichen Hinweis und den Hauptakteuren
  abgeschlossen, nie mit erfundenen Daten. Source Guides (`FR-SI-02`) entstehen bei `Ready` in der
  effektiven Ausgabesprache des Notebooks und werden je Quelle, Revision und Sprache gespeichert;
  eine andere Sprache wird beim Öffnen nachgeneriert. In v1–v5 legt der Owner die Notebook-Sprache
  fest; persönliche notebookbezogene Überschreibungen gelten ab v6.0 (`FR-UI-02`).
  Notiz-Quellen (`FR-NM-03/04`, Beschluss Project Owner 2026-10-20) werden als normale v1-Quellen in
  PostgreSQL gespeichert: Die Umwandlung reserviert den Slot über die atomare v1-Reservierung (Uploads
  und Notiz-Quellen teilen ein Limit von standardmäßig 50 Quellen), das kombinierte Markdown durchläuft
  die v1-Markdown-Ingestion bis `Ready`, und Ursprungsnotizen, deren Revisionen sowie kopierte Zitate
  werden als Provenienz gespeichert. Inline-Zitatmarker wie `[1]` werden aus dem Quelltext entfernt.
  Seit 2026-10-21 (specs/013) liegen auch die Notizen selbst in PostgreSQL (DEV-04 aufgehoben, D16).
- **NFR-EVAL-01..04, alle Release-Gates (Beschluss Project Owner 2026-10-19):** Deterministische
  Prüfungen (`NFR-EVAL-02` ID-Präzision, `NFR-EVAL-04` Leakage) laufen auf jedem PR. Die
  LLM-bewerteten Prüfungen (`NFR-EVAL-01`, `NFR-EVAL-03`, semantische Zitatstützung) laufen einmal
  je Release-Gate auf einer festen, deterministisch geschichteten Stichprobe von 50 Fällen aus dem
  versionierten Golden-Datensatz; ein bestandener Lauf genügt als Gate-Nachweis. Schwellenwerte
  bleiben unverändert (Constitution v2.0.0).
- **FR-WM-07:** 200 MB = 200.000.000 Bytes und 500.000 Wörter sind unabhängige inklusive
  Obergrenzen. Quellen-Slots werden atomar reserviert und bei fehlgeschlagener Ingestion
  freigegeben. v1: 100 Notebooks je Nutzer und standardmäßig 50 Quellen je Notebook
  (Deployment-Konfiguration bis 300); v6: Tenant-/Rollenrichtlinien bis 500 Notebooks und
  300 Quellen. Die bestehenden täglichen Generierungsquotas aus Karte 6.1 werden präzisiert:
  Standardwerte 500 Chat-Anfragen, 20 Audio- und 20 Video-Generierungen pro Nutzer/UTC-Tag;
  positive, administrativ konfigurierbare Limits. Keine zusätzlichen Billing-Funktionen.
- **FR-GC-07/09, FR-UI-02:** Persona-Limit 5.000 Zeichen, inklusive Analyst-Preset;
  Kopieren mit oder ohne Zitate. Globale und notebookbezogene Eingabe-/Ausgabesprachen
  verwenden die Vorrangregeln der Karten; persönliche Einstellungen ändern keine fremden
  Nutzerpräferenzen.
- **C-01/C-02, FR-SI-01/02/05:** Alle Parser verwenden dieselbe Locator-Union. Der Source
  Guide startet nach erfolgreicher Ingestion mit explizitem Einzelquellen-Scope. Re-Sync
  validiert eine neue Revision vor dem atomaren Austausch; Fehler erhalten den alten Stand.
  Google Docs/Slides-Import gehört weiterhin zu v3 (D11); authentifizierter Import ist nicht
  auf v6-Suche verschoben. Prompt-Injection-Prüfung für Web-Inhalte gilt ab v3.
- **FR-NM-03/04, FR-GC-01/02, NFR-EVAL-04:** Eine Mehrfach-Konvertierung erzeugt eine
  kombinierte Quelle unter den normalen Limits. Notizen sind Nutzereingaben, nicht automatisch
  Quellenbelege; für quellenbasierte Notiz-Synthese werden sie zuerst konvertiert und explizit
  ausgewählt. Die beschriftete Notiz-Aktion autorisiert diese Konvertierung als Teil des
  Vorgangs, sodass Zusammenfassen/Gliedern auch ohne zuvor vorhandene Quelle möglich bleibt.
  Validierte Antworten und Medien müssen Quellen belegen; fehlgeschlagene
  Zitatprüfung ergibt unmittelbar eine Ablehnung. Historie, Caches und Artefakt-zu-Chat-Aktionen
  dürfen den aktuellen Scope nicht umgehen. Statusanzeigen zählen nicht als Antwort-TTFT (D13).
- **FR-WM-05/06, NFR-SEC-02:** Nur Owner verwalten Freigaben; Viewer behalten eigene
  Chats und Lernfortschritte. Chat-Only erhält ausschließlich antwortgebundene Zitatvorschauen,
  keine beliebig adressierbare Chunk-/Quellen-API. Quell-ACLs gelten auch nach dem Import
  für abgeleitete Artefakte. Analytics zählen UTC-Tage inklusive Owner-Zugriffen.
- **FR-ST-04/12/16/17, FR-SI-07:** Audio-Links gewähren keine zusätzlichen Rechte;
  Learning Overviews benötigen auch Infografiken aus Paket 4.2. Deep Research importiert
  Primärquellen vor der belegten Berichtssynthese und speichert Bericht als Artefakt und Quelle.
  Die Berichtquelle benötigt einen eigenen Quota-Slot. Pflichtbestandteile dürfen nicht durch
  stillen Fallback oder unvollständige Erfolgszustände entfallen.
- **NFR-PERF-01:** Die Millionen-Token-Messung umfasst mindestens eine Million aktive
  Tokens, nicht inklusive abgewählter Decoys. Große Studio-Jobs verarbeiten Original-Chunks
  vollständig in Batches; verlustbehaftete Source Guides allein genügen nicht (D12).

Die [paketübergreifenden Regeln](../../spec/requirements/README.md#binding-cross-package-rules) und
[Abhängigkeiten](../../spec/requirements/README.md#package-prerequisites) präzisieren diese bestehenden
Anforderungen für die nachfolgenden Spec-Kit-Stufen.
