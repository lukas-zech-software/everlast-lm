-- Migration 0007: Package 2.3 notes in PostgreSQL (FR-NM-01, FR-NM-02, FR-NM-03, FR-NM-04, FR-GC-09).
-- From the former v3-draft/notes.sql; specs/013-v2-persistence-postgres (DEV-04 closed, D16).
-- Note-sources and their provenance are v1 sources (0004_note_sources.sql) and are unchanged.
-- source_message_id and origin_note_id have no foreign key on purpose: a saved note outlives a cleared chat and
-- an editable copy outlives its original, as before.

CREATE TABLE IF NOT EXISTS notes (
    id UUID PRIMARY KEY,
    notebook_id UUID NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (char_length(title) >= 1),
    content_md TEXT NOT NULL DEFAULT '',
    origin_type TEXT NOT NULL DEFAULT 'manual' CHECK (origin_type IN ('manual', 'saved_response')),
    source_message_id UUID,
    citations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    origin_note_id UUID,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    display_order INTEGER NOT NULL CHECK (display_order >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT notes_saved_response_key UNIQUE (notebook_id, owner_id, source_message_id)
);

CREATE INDEX IF NOT EXISTS notes_notebook_order_idx ON notes (notebook_id, owner_id, display_order);
