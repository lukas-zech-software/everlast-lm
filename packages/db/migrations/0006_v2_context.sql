-- Migration 0006: Package 2.2 data in PostgreSQL (FR-SI-02, FR-GC-04, FR-GC-05, FR-GC-07, FR-GC-09).
-- specs/013-v2-persistence-postgres (DEV-04 closed, D16). Each `record` holds the contract object and is parsed
-- with its Zod schema on write and read. Cascades keep no v2 record beyond its notebook or source (CC-04).

-- Source Guides per (source, revision, output language); record = SourceGuideSchema.
CREATE TABLE IF NOT EXISTS source_guides (
    source_id UUID NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    output_language TEXT NOT NULL,
    notebook_id UUID NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('GuidePending', 'GuideReady', 'GuideFailed')),
    record JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source_id, revision, output_language)
);
CREATE INDEX IF NOT EXISTS source_guides_notebook_idx ON source_guides (notebook_id);
CREATE INDEX IF NOT EXISTS source_guides_pending_idx ON source_guides (updated_at) WHERE status = 'GuidePending';

-- Notebook overviews per cache identity; record = NotebookOverviewSchema.
CREATE TABLE IF NOT EXISTS notebook_overviews (
    cache_key TEXT PRIMARY KEY,
    notebook_id UUID NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
    authorization_key TEXT NOT NULL,
    record JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notebook_overviews_notebook_idx ON notebook_overviews (notebook_id);

-- Chat configuration per notebook and user; record = ChatConfigurationSchema.
CREATE TABLE IF NOT EXISTS chat_configurations (
    notebook_id UUID NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    record JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (notebook_id, user_id)
);

-- Feedback per assistant message; record = MessageFeedbackSchema. message_id has no foreign key: the route
-- validates the message against the caller's visible chat history before every write; clearing the chat deletes
-- the thread's feedback and follow-ups in the same transaction (clearThread).
CREATE TABLE IF NOT EXISTS message_feedback (
    notebook_id UUID NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    message_id UUID NOT NULL,
    record JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (notebook_id, user_id, message_id)
);

-- Follow-ups per assistant message and output language; record = PersistedMessageFollowUpsSchema.
CREATE TABLE IF NOT EXISTS message_followups (
    notebook_id UUID NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    message_id UUID NOT NULL,
    output_language TEXT NOT NULL,
    record JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (notebook_id, user_id, message_id, output_language)
);
