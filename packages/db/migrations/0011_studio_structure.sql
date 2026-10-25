-- Migration 0011: Package 3.3 Studio Structure & Data Extraction (FR-ST-08, FR-ST-09, FR-ST-18, C-03, D16).
-- specs/011-studio-mindmaps-data-tables. Additive only: 0001–0010 are untouched, existing report rows and checks
-- remain valid, and widened CHECK constraints admit mindmap/default and data_table/default alongside durable
-- execution leases and identifier-only outbox jobs (`jobs.kind = 'studio'`).

ALTER TABLE studio_artifacts DROP CONSTRAINT IF EXISTS studio_artifacts_plugin_type_check;
ALTER TABLE studio_artifacts DROP CONSTRAINT IF EXISTS studio_artifacts_subtype_check;
ALTER TABLE studio_artifacts DROP CONSTRAINT IF EXISTS studio_artifacts_kind_subtype_check;

ALTER TABLE studio_artifacts ADD CONSTRAINT studio_artifacts_plugin_type_check
    CHECK (plugin_type IN ('report', 'mindmap', 'data_table'));

ALTER TABLE studio_artifacts ADD CONSTRAINT studio_artifacts_subtype_check
    CHECK (subtype IN ('briefing_doc', 'study_guide', 'faq', 'timeline', 'dynamic', 'custom', 'default'));

ALTER TABLE studio_artifacts ADD CONSTRAINT studio_artifacts_kind_subtype_check
    CHECK (
        (plugin_type = 'report' AND subtype IN ('briefing_doc', 'study_guide', 'faq', 'timeline', 'dynamic', 'custom'))
        OR (plugin_type IN ('mindmap', 'data_table') AND subtype = 'default')
    );

ALTER TABLE studio_artifacts ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE studio_artifacts ADD COLUMN IF NOT EXISTS lease_token UUID;
ALTER TABLE studio_artifacts ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS studio_artifacts_lease_idx
    ON studio_artifacts (lease_expires_at) WHERE status IN ('Queued', 'Running');

-- Outbox kinds: durable Studio jobs for mindmap/data_table ride the existing jobs outbox (identifier-only payload).
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('ingest', 'cleanup', 'sync', 'studio'));
