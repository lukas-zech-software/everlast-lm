-- Migration 0013: Package 4.1 Studio Active Learning Suite (FR-ST-12, FR-ST-13, FR-ST-14, FR-ST-15, C-03, NFR-SEC-02).
-- specs/014-studio-active-learning-suite. Additive only: 0001-0012 remain untouched; widens studio_artifacts
-- plugin/subtype CHECK constraints for flashcards, quiz, and learning_overview and adds per-user learning_progress.

ALTER TABLE studio_artifacts DROP CONSTRAINT IF EXISTS studio_artifacts_plugin_type_check;
ALTER TABLE studio_artifacts DROP CONSTRAINT IF EXISTS studio_artifacts_kind_subtype_check;

ALTER TABLE studio_artifacts ADD CONSTRAINT studio_artifacts_plugin_type_check
    CHECK (plugin_type IN ('report', 'mindmap', 'data_table', 'flashcards', 'quiz', 'learning_overview'));

ALTER TABLE studio_artifacts ADD CONSTRAINT studio_artifacts_kind_subtype_check
    CHECK (
        (plugin_type = 'report' AND subtype IN ('briefing_doc', 'study_guide', 'faq', 'timeline', 'dynamic', 'custom'))
        OR (plugin_type IN ('mindmap', 'data_table', 'flashcards', 'quiz', 'learning_overview') AND subtype = 'default')
    );

CREATE TABLE IF NOT EXISTS learning_progress (
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    artifact_id UUID NOT NULL REFERENCES studio_artifacts (id) ON DELETE CASCADE,
    notebook_id UUID NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
    item_states_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, artifact_id)
);

CREATE INDEX IF NOT EXISTS learning_progress_notebook_idx
    ON learning_progress (notebook_id, user_id);
