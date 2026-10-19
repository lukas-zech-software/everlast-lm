-- Package 2.4 (FR-ST-10, FR-ST-11, C-03): unified Studio artifact/job table.
-- Lifecycle Queued -> Running -> Completed | Failed | Cancelled; payload only when Completed.

CREATE TABLE IF NOT EXISTS studio_artifacts (
    id UUID PRIMARY KEY,
    notebook_id UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL,
    plugin_type TEXT NOT NULL CHECK (plugin_type IN ('report')),
    subtype TEXT NOT NULL CHECK (subtype IN ('briefing_doc', 'study_guide', 'faq', 'timeline', 'dynamic', 'custom')),
    status TEXT NOT NULL CHECK (status IN ('Queued', 'Running', 'Completed', 'Failed', 'Cancelled')),
    title TEXT NOT NULL CHECK (char_length(title) >= 1),
    params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload_json JSONB,
    active_source_ids_snapshot JSONB NOT NULL,
    output_language TEXT,
    progress_json JSONB,
    failure_json JSONB,
    attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
    retry_of UUID REFERENCES studio_artifacts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT studio_artifacts_payload_iff_completed CHECK ((status = 'Completed') = (payload_json IS NOT NULL)),
    CONSTRAINT studio_artifacts_snapshot_nonempty CHECK (jsonb_array_length(active_source_ids_snapshot) >= 1)
);

CREATE INDEX IF NOT EXISTS idx_studio_artifacts_notebook ON studio_artifacts(notebook_id, created_at DESC);
