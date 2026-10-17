# Data Model: Text/PDF Ingestion & Inspector

Trace: FR-SI-01, FR-SI-03, FR-SI-04, C-01, C-02. No migrations are executed by this document.

| Entity | Invariants / ownership |
| :--- | :--- |
| Source | Existing 1.1 identity/admission row; media_type pdf/txt/markdown/copied_text, title, status, byte_size, word_count, immutable revision_id and attempt_id. Uploading → Processing → Ready or Failed. Both inclusive limits hold for every type. |
| SourceRevision | Notebook/source FK, immutable revision, canonical text/object generation, page/section boundaries, tokenization and extraction metadata. Ready publication is atomic with chunks/indexes. |
| Chunk persistence | C-01 projection plus private notebook_id/revision_id/sequence/embedding/tsv; UUIDv7 chunk IDs. Composite parent FK prevents cross-notebook linkage. No extra fields in exported C-01. |
| Selection | Local to user/browser session/notebook; set of Ready IDs, All/Partial/None UI state. Never a shared server default. |
| Inspector state | Source/revision, optional highlighted chunk, scroll position, return-to-list state; singleton read scope leaves selection/chat unchanged. |

## FR-SI-01 (Subset A) — Text, Markdown, PDF & Copied Text Ingestion

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| File upload | `.pdf`, `.txt`, `.md` | Max $200\text{ MB}$, max $500,000$ words per source (`FR-WM-07`) | — |
| Copied text | UTF-8 string | $1\text{ char}$ to $500,000$ words | Source title: `"Pasted text"` |
| `UnifiedDocumentChunk` | `Contract C-01` JSON | `source_id`, `chunk_id`, `text`, `token_count`, `locator` (`page_span`; text-only sources omit the physical page) | — |

- Visible: Source item in left sidebar with format icon, title, and status indicator.
- Persisted: `Source` record (`id`, `notebook_id`, `title`, `media_type`, `status`, `word_count`) and $1..N$ `UnifiedDocumentChunk` records.
- States: `Uploading` $\rightarrow$ `Processing` $\rightarrow$ `Ready` (or `Failed`).

Defaults are qualified by owner-only release phasing and explicit-scope rules; All Ready is only an initial UI choice.

## FR-SI-03 — Granular Source Selection / Scoping

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| `active_source_ids` ($S_{\text{aktiv}}$) | Array of UUIDs | $0 \le \lvert S_{\text{aktiv}}\rvert \le N_{\text{max}}$, each source must be in state `Ready` | All `Ready` sources in the notebook |

- Visible: Individual checkboxes, master checkbox (checked / indeterminate / unchecked), and `"<n> sources"` indicator in the chat input bar.
- Persisted: Active selection state in session/client state and sent explicitly with every chat/Studio request payload to `ScopedContextProvider`.
- States: `AllSelected` $\leftrightarrow$ `PartialSelected` $\leftrightarrow$ `NoneSelected`.

Defaults are qualified by owner-only release phasing and explicit-scope rules; All Ready is only an initial UI choice.

## FR-SI-04 — Integrated Source Inspector (Source Viewer)

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| `source_id` | UUID | Must exist in current `notebook_id` | — |
| `highlight_chunk_id` (optional) | Chunk UUID (`Contract C-01`; locator is resolved server-side) | Valid `chunk_id` belonging to `source_id` | `null` (scroll to top) |

- Visible: Expanded left panel with document header, scrollable full-text container (`data-chunk-id` anchors), and highlighted passage when triggered from a citation.
- Persisted: Read-only view of persisted `UnifiedDocumentChunk` records ordered by sequence/offset.
- States: `Closed (List View)` $\leftrightarrow$ `Open (Document View)` $\leftrightarrow$ `Open & Highlighted (Chunk Focused)`.

Defaults are qualified by owner-only release phasing and explicit-scope rules; All Ready is only an initial UI choice.

## Consistency boundaries (C-01/C-02, FR-WM-04)

All persistent children carry notebook identity and parent constraints. Database revision/embedding/epoch data never expands C-01's five-field projection. Keep long-running extraction/model/network operations outside row locks, then recheck parent authorization and captured revision under the shared publication fence before atomic success. A canceled/deleted parent or stale revision cannot be recreated by retries. Use immutable attempt/request IDs and deterministic idempotency. Cascading parent deletion invalidates content, cached snippets and in-flight jobs; no retained copy leaks through search/export/view state.
