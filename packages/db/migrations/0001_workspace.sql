-- Migration 0001: Workspace foundation (FR-WM-01, FR-WM-04, FR-WM-07, NFR-SEC-01).
-- Owner -> notebook -> source lock order. Occupancy is derived under the parent lock, never a counter.

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    issuer TEXT NOT NULL CHECK (char_length(issuer) > 0),
    subject TEXT NOT NULL CHECK (char_length(subject) > 0),
    email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_issuer_subject_key UNIQUE (issuer, subject)
);

CREATE TABLE IF NOT EXISTS notebooks (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT notebooks_updated_after_created CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS notebooks_owner_idx ON notebooks (owner_id, created_at);

-- Idempotent create requests survive notebook deletion so a replay can never resurrect a notebook.
CREATE TABLE IF NOT EXISTS notebook_create_requests (
    owner_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    idempotency_key UUID NOT NULL,
    notebook_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, idempotency_key)
);

-- Source admission ledger. Uploading/Processing/Ready occupy a slot; Failed is a dismissible error row.
CREATE TABLE IF NOT EXISTS sources (
    id UUID NOT NULL UNIQUE,
    notebook_id UUID NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
    attempt_id UUID NOT NULL UNIQUE,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    media_type TEXT NOT NULL CHECK (media_type IN ('application/pdf', 'text/plain', 'text/markdown', 'copied_text')),
    status TEXT NOT NULL CHECK (status IN ('Uploading', 'Processing', 'Ready', 'Failed')),
    declared_bytes BIGINT NOT NULL CHECK (declared_bytes >= 0 AND declared_bytes <= 200000000),
    actual_bytes BIGINT CHECK (actual_bytes >= 0),
    word_count INTEGER CHECK (word_count >= 0),
    active_revision INTEGER CHECK (active_revision > 0),
    object_name TEXT,
    object_generation TEXT,
    upload_expires_at TIMESTAMPTZ,
    failure_code TEXT,
    failure_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (notebook_id, id),
    CONSTRAINT sources_ready_has_revision CHECK (status <> 'Ready' OR (active_revision IS NOT NULL AND word_count IS NOT NULL AND actual_bytes IS NOT NULL)),
    CONSTRAINT sources_actual_within_limit CHECK (status = 'Failed' OR actual_bytes IS NULL OR actual_bytes <= 200000000),
    CONSTRAINT sources_words_within_limit CHECK (status = 'Failed' OR word_count IS NULL OR word_count <= 500000)
);

CREATE INDEX IF NOT EXISTS sources_notebook_status_idx ON sources (notebook_id, status);

-- Payload-free deletion record: no title, content or object names beyond the notebook namespace prefix.
CREATE TABLE IF NOT EXISTS cleanup_operations (
    id UUID PRIMARY KEY,
    notebook_id UUID NOT NULL,
    owner_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    object_prefix TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('Pending', 'Running', 'Purged')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error_code TEXT,
    quiescent_after TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    purged_at TIMESTAMPTZ,
    CONSTRAINT cleanup_purged_has_timestamp CHECK (status <> 'Purged' OR purged_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS cleanup_operations_notebook_idx ON cleanup_operations (notebook_id);

-- Durable job outbox (ingestion and cleanup). Payload holds identifiers only.
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('ingest', 'cleanup')),
    payload JSONB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('Pending', 'Running', 'Done', 'Dead')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_due_idx ON jobs (status, next_attempt_at);
