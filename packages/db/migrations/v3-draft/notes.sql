-- Migration 0007: Notes & Pinboard Lifecycle
-- Traceability: FR-NM-01, FR-NM-02, FR-NM-03, FR-GC-09, C-01, C-02, FR-WM-04

CREATE TABLE IF NOT EXISTS notes (
    id UUID PRIMARY KEY,
    notebook_id UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(800) NOT NULL CHECK (length(title) >= 1),
    content_md TEXT NOT NULL DEFAULT '',
    origin_type VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (origin_type IN ('manual', 'saved_response')),
    source_message_id UUID,
    citations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    origin_note_id UUID,
    revision INT NOT NULL DEFAULT 1 CHECK (revision >= 1),
    display_order INT NOT NULL CHECK (display_order >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_notes_saved_response UNIQUE (notebook_id, owner_id, source_message_id)
);

CREATE INDEX IF NOT EXISTS idx_notes_notebook_order ON notes(notebook_id, owner_id, display_order);

-- Note-source provenance is not part of this draft: note-sources are v1 PostgreSQL sources with their
-- provenance in migration 0004_note_sources.sql (owner decision 2026-10-20, D16).
