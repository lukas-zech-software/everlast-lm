-- Migration 0014: Package 4.2 Studio Visuals & Presentations (FR-ST-16, FR-ST-17, C-03, NFR-SEC-02).
-- specs/015-studio-visuals-presentations. Additive only: 0001-0013 remain untouched; widens studio_artifacts
-- plugin/subtype CHECK constraints for slide_deck and infographic.

ALTER TABLE studio_artifacts DROP CONSTRAINT IF EXISTS studio_artifacts_plugin_type_check;
ALTER TABLE studio_artifacts DROP CONSTRAINT IF EXISTS studio_artifacts_kind_subtype_check;

ALTER TABLE studio_artifacts ADD CONSTRAINT studio_artifacts_plugin_type_check
    CHECK (plugin_type IN ('report', 'mindmap', 'data_table', 'flashcards', 'quiz', 'learning_overview', 'slide_deck', 'infographic'));

ALTER TABLE studio_artifacts ADD CONSTRAINT studio_artifacts_kind_subtype_check
    CHECK (
        (plugin_type = 'report' AND subtype IN ('briefing_doc', 'study_guide', 'faq', 'timeline', 'dynamic', 'custom'))
        OR (plugin_type IN ('mindmap', 'data_table', 'flashcards', 'quiz', 'learning_overview', 'slide_deck', 'infographic') AND subtype = 'default')
    );
