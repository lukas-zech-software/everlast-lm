-- Migration 0008: Package 2.4 Studio artifacts in PostgreSQL (FR-ST-10, FR-ST-11, C-03).
-- From the former v3-draft/studio_artifacts.sql; specs/013-v2-persistence-postgres (DEV-04 closed, D16).
-- Lifecycle Queued -> Running -> Completed | Failed | Cancelled (Queued -> Cancelled too); payload only when
-- Completed. The API start-up sweep moves Queued/Running rows of a stopped process to Failed (specs/013 R5).
-- `seq` keeps insertion order for listings.

CREATE TABLE IF NOT EXISTS studio_artifacts (
    id UUID PRIMARY KEY,
    seq BIGINT GENERATED ALWAYS AS IDENTITY,
    notebook_id UUID NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    plugin_type TEXT NOT NULL CHECK (plugin_type IN ('report')),
    subtype TEXT NOT NULL CHECK (subtype IN ('briefing_doc', 'study_guide', 'faq', 'timeline', 'dynamic', 'custom')),
    status TEXT NOT NULL CHECK (status IN ('Queued', 'Running', 'Completed', 'Failed', 'Cancelled')),
    title TEXT NOT NULL CHECK (char_length(title) >= 1),
    params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload_json JSONB,
    source_revisions_snapshot JSONB NOT NULL,
    output_language TEXT,
    progress_json JSONB,
    failure_json JSONB,
    attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
    retry_of UUID REFERENCES studio_artifacts (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT studio_artifacts_payload_iff_completed CHECK ((status = 'Completed') = (payload_json IS NOT NULL)),
    CONSTRAINT studio_artifacts_snapshot_nonempty CHECK (jsonb_array_length(source_revisions_snapshot) >= 1)
);

CREATE INDEX IF NOT EXISTS studio_artifacts_notebook_seq_idx ON studio_artifacts (notebook_id, owner_id, seq);
CREATE INDEX IF NOT EXISTS studio_artifacts_open_idx ON studio_artifacts (updated_at) WHERE status IN ('Queued', 'Running');
