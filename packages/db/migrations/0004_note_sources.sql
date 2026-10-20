-- Migration 0004: Note-sources are v1 sources (FR-NM-03, FR-NM-04, FR-WM-07, C-01, C-02).
-- Owner decision 2026-10-20 (D16 amendment, SRS §5.5 DEV-04): sources made from notes are normal PostgreSQL
-- sources that share the notebook's source limit with uploads; the notes themselves stay in API memory.
-- Backward-compatible: widens one CHECK and adds one table; existing rows and queries are unchanged.

ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_media_type_check;
ALTER TABLE sources ADD CONSTRAINT sources_media_type_check
    CHECK (media_type IN ('application/pdf', 'text/plain', 'text/markdown', 'copied_text', 'note_markdown'));

-- Provenance of a note-source: origin notes with the revisions that were converted (displayed order), the
-- FR-NM-04 reuse key (sorted "note_id:revision" set) and the citations copied from saved responses. Citations
-- here are provenance only; answers cite the note-source's own chunks. Deleting the source removes the row.
CREATE TABLE IF NOT EXISTS note_source_provenance (
    source_id UUID PRIMARY KEY,
    notebook_id UUID NOT NULL,
    origin_key TEXT NOT NULL CHECK (char_length(origin_key) > 0),
    origin_notes JSONB NOT NULL CHECK (jsonb_typeof(origin_notes) = 'array' AND jsonb_array_length(origin_notes) > 0),
    origin_citations JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(origin_citations) = 'array'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (notebook_id, source_id) REFERENCES sources (notebook_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS note_source_provenance_origin_idx ON note_source_provenance (notebook_id, origin_key);
