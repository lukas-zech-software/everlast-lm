-- Migration 0005: Package 2.1 workspace comfort data in PostgreSQL (FR-WM-02, FR-WM-03, FR-UI-02).
-- specs/013-v2-persistence-postgres closes SRS §5.5 DEV-04 (D16): v2 data no longer lives in API memory.
-- Additive only: new tables, no change to existing rows or queries.

-- Per-notebook icon state and the note display-order counter. No row = defaults (NotebookMetadataSchema).
-- ready_source_count is derived from `sources`, never stored.
CREATE TABLE IF NOT EXISTS notebook_v2_metadata (
    notebook_id UUID PRIMARY KEY REFERENCES notebooks (id) ON DELETE CASCADE,
    icon_emoji TEXT NOT NULL DEFAULT '📓',
    icon_source TEXT NOT NULL DEFAULT 'default' CHECK (icon_source IN ('default', 'topic', 'custom')),
    topic_selection_attempted BOOLEAN NOT NULL DEFAULT false,
    note_order_counter INTEGER NOT NULL DEFAULT 0 CHECK (note_order_counter >= 0)
);

-- Owner workspace preferences; record = OwnerWorkspacePreferencesSchema (theme, input/output language).
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    record JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Owner per-notebook state; record = OwnerNotebookPreferencesSchema (pin, last opened, notebook languages).
CREATE TABLE IF NOT EXISTS notebook_user_preferences (
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    notebook_id UUID NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
    record JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, notebook_id)
);
CREATE INDEX IF NOT EXISTS notebook_user_preferences_notebook_idx ON notebook_user_preferences (notebook_id);
