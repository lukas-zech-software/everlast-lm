-- Migration 0009: Package 3.1 Multimodal Ingestion & Sync (FR-SI-01 Subset B, FR-SI-05, C-01, C-02, D11, D15).
-- specs/009-multimodal-ingestion-sync. Additive only: existing rows, interfaces and the previous API revision keep
-- working during a MIGRATE_ON_START rollout (new columns are nullable, widened CHECKs accept every old value).
-- 0005–0008 (v2 persistence) are untouched; packages 3.2/3.3 allocate 0010 or later.

-- v3 media types; note_markdown stays trusted-only (FR-NM-03), enforced by the API admission path.
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_media_type_check;
ALTER TABLE sources ADD CONSTRAINT sources_media_type_check CHECK (media_type IN (
    'application/pdf', 'text/plain', 'text/markdown', 'copied_text', 'note_markdown',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'audio/mpeg', 'audio/wav', 'audio/mp4', 'text/html', 'video_url'));

-- Delegated per-user provider access (D11). Only an opaque Secret Manager reference is stored, never a token.
CREATE TABLE IF NOT EXISTS delegated_connections (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('google')),
    secret_ref TEXT NOT NULL CHECK (char_length(secret_ref) > 0),
    scopes TEXT[] NOT NULL,
    account_label TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS delegated_connections_user_idx ON delegated_connections (user_id);

-- Linked-source identity and sync metadata (FR-SI-01/05). `progress` is a substate indicator, never eligibility.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS link_kind TEXT CHECK (link_kind IN ('web', 'video', 'drive'));
ALTER TABLE sources ADD COLUMN IF NOT EXISTS external_url TEXT CHECK (char_length(external_url) <= 2048);
ALTER TABLE sources ADD COLUMN IF NOT EXISTS canonical_url TEXT CHECK (char_length(canonical_url) <= 2048);
ALTER TABLE sources ADD COLUMN IF NOT EXISTS external_document_id TEXT CHECK (char_length(external_document_id) <= 256);
ALTER TABLE sources ADD COLUMN IF NOT EXISTS delegated_connection_id UUID REFERENCES delegated_connections (id) ON DELETE SET NULL;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS progress TEXT CHECK (progress IN ('Fetching', 'Transcribing', 'Parsing', 'Syncing'));
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_link_identity;
ALTER TABLE sources ADD CONSTRAINT sources_link_identity CHECK (
    link_kind IS NULL
    OR (link_kind IN ('web', 'video') AND external_url IS NOT NULL)
    OR (link_kind = 'drive' AND external_document_id IS NOT NULL));

-- Immutable revision manifest (FR-SI-05): hash, viewer kind and media metadata travel with each revision.
ALTER TABLE source_revisions ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE source_revisions ADD COLUMN IF NOT EXISTS viewer_kind TEXT CHECK (viewer_kind IN ('pages', 'article', 'transcript'));
ALTER TABLE source_revisions ADD COLUMN IF NOT EXISTS media_duration_ms INTEGER CHECK (media_duration_ms >= 0);
ALTER TABLE source_revisions ADD COLUMN IF NOT EXISTS media_object_name TEXT;
ALTER TABLE source_revisions ADD COLUMN IF NOT EXISTS media_object_generation TEXT;
ALTER TABLE source_revisions ADD COLUMN IF NOT EXISTS player JSONB;
ALTER TABLE source_revisions ADD COLUMN IF NOT EXISTS canonical_url TEXT;
ALTER TABLE source_revisions ADD COLUMN IF NOT EXISTS upstream_version TEXT;

-- Canonical viewer anchors (D15): article sections carry their sanitized DOM selector, transcript segments their
-- integer millisecond interval. Committed with the chunks in the same publication transaction.
ALTER TABLE source_pages ADD COLUMN IF NOT EXISTS dom_selector TEXT;
ALTER TABLE source_pages ADD COLUMN IF NOT EXISTS start_ms INTEGER CHECK (start_ms >= 0);
ALTER TABLE source_pages ADD COLUMN IF NOT EXISTS end_ms INTEGER CHECK (end_ms >= 0);
ALTER TABLE source_pages DROP CONSTRAINT IF EXISTS source_pages_time_order;
ALTER TABLE source_pages ADD CONSTRAINT source_pages_time_order CHECK (end_ms IS NULL OR start_ms IS NULL OR end_ms >= start_ms);

-- Database-only viewer page of a chunk (time_span / dom_path chunks have no page_number); never a C-01 field.
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS anchor_page INTEGER CHECK (anchor_page > 0);

-- Durable source operations (FR-SI-05): one active operation per source, idempotency per attempt, lease + fencing
-- token so a redelivered or recovered worker resumes the same operation and stale workers cannot publish.
CREATE TABLE IF NOT EXISTS source_operations (
    id UUID PRIMARY KEY,
    notebook_id UUID NOT NULL,
    source_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('import', 'sync')),
    trigger TEXT NOT NULL CHECK (trigger IN ('import', 'manual', 'webhook')),
    initiator_id UUID REFERENCES users (id) ON DELETE SET NULL,
    idempotency_key TEXT,
    request_hash TEXT,
    state TEXT NOT NULL CHECK (state IN ('Queued', 'Running', 'Succeeded', 'Failed', 'Cancelled')),
    progress TEXT CHECK (progress IN ('Fetching', 'Transcribing', 'Parsing', 'Syncing')),
    expected_revision INTEGER CHECK (expected_revision > 0),
    committed_revision INTEGER CHECK (committed_revision > 0),
    fencing_token BIGINT NOT NULL DEFAULT 0,
    lease_expires_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    provider_operation TEXT,
    error_code TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    FOREIGN KEY (notebook_id, source_id) REFERENCES sources (notebook_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS source_operations_one_active_idx ON source_operations (source_id) WHERE state IN ('Queued', 'Running');
CREATE UNIQUE INDEX IF NOT EXISTS source_operations_idempotency_idx ON source_operations (source_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Durable publication events (FR-SI-02/05, D16): a committed import or re-sync schedules Source Guide work for the
-- exact new revision; delivery survives restarts and does not depend on the watcher lookback or a user reopen.
CREATE TABLE IF NOT EXISTS source_publication_events (
    id UUID PRIMARY KEY,
    notebook_id UUID NOT NULL,
    source_id UUID NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    status TEXT NOT NULL CHECK (status IN ('Pending', 'Done')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    FOREIGN KEY (notebook_id, source_id) REFERENCES sources (notebook_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS source_publication_events_pending_idx ON source_publication_events (created_at) WHERE status = 'Pending';

-- Provider push-notification channels mapped to one linked source; only a hash of the channel token is stored.
CREATE TABLE IF NOT EXISTS source_sync_channels (
    channel_id TEXT PRIMARY KEY CHECK (char_length(channel_id) BETWEEN 1 AND 64),
    notebook_id UUID NOT NULL,
    source_id UUID NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (notebook_id, source_id) REFERENCES sources (notebook_id, id) ON DELETE CASCADE
);

-- Outbox kinds: re-sync operations run on the existing jobs outbox (no second queue).
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('ingest', 'cleanup', 'sync'));

-- Pending delegated-OAuth authorizations (D11; security review 2026-10-23): single-use, browser-bound (hash of the
-- HttpOnly nonce cookie), user-bound and expiring; holds the PKCE code verifier server-side.
CREATE TABLE IF NOT EXISTS oauth_states (
    nonce_hash TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code_verifier TEXT NOT NULL,
    return_to TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_states_expiry_idx ON oauth_states (expires_at);
