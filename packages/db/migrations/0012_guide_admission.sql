-- [008-studio-text-reports] T073: FR-SI-02, FR-ST-11, NFR-SEC-02.
-- Metadata only. Source deletion must not erase a start from the rolling-hour population.
CREATE TABLE guide_admissions (
  id UUID PRIMARY KEY,
  notebook_id UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  source_id UUID NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  output_language TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX guide_admissions_active_identity ON guide_admissions(notebook_id, source_id, revision, output_language) WHERE finished_at IS NULL;
CREATE INDEX guide_admissions_window ON guide_admissions(notebook_id, started_at);

-- Freeze the original primary language per Ready revision; mutable preferences cannot bypass admission.
CREATE TABLE guide_primary_languages (
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  notebook_id UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  output_language TEXT NOT NULL,
  PRIMARY KEY(source_id, revision)
);
