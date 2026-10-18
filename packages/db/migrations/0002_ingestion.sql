-- Migration: 0002_ingestion.sql
-- Package 1.2: Text/PDF Ingestion & Inspector Persistence
-- SRS IDs: FR-SI-01, FR-SI-03, FR-SI-04, C-01, C-02, FR-WM-04, Gate v1.0

-- 1. Ingestion Attempts (Idempotency, Replay & Cancellation Fence)
CREATE TABLE IF NOT EXISTS ingestion_attempts (
    attempt_id UUID PRIMARY KEY,
    notebook_id UUID NOT NULL,
    source_id UUID NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Processing',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (notebook_id, source_id) REFERENCES sources (notebook_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attempts_source ON ingestion_attempts (notebook_id, source_id);

-- 2. Source Revisions (Immutable source content snapshots)
CREATE TABLE IF NOT EXISTS source_revisions (
    notebook_id UUID NOT NULL,
    source_id UUID NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
    word_count INTEGER NOT NULL CHECK (word_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (notebook_id, source_id, revision),
    FOREIGN KEY (notebook_id, source_id) REFERENCES sources (notebook_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_revisions_source ON source_revisions (notebook_id, source_id);

-- 3. Document Chunks (Contract C-01 UnifiedDocumentChunk persistence & private keys)
CREATE TABLE IF NOT EXISTS document_chunks (
    chunk_id UUID PRIMARY KEY,
    notebook_id UUID NOT NULL,
    source_id UUID NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    token_count INTEGER NOT NULL CHECK (token_count >= 0),
    text TEXT NOT NULL,
    locator JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (notebook_id, source_id, revision) REFERENCES source_revisions (notebook_id, source_id, revision) ON DELETE CASCADE
);

-- Fast retrieval index for C-02 ScopedContextProvider queries
CREATE INDEX IF NOT EXISTS idx_chunks_scope ON document_chunks (notebook_id, source_id, revision);

-- Fast singleton index for Source Inspector passage lookups (FR-SI-04)
CREATE INDEX IF NOT EXISTS idx_chunks_inspector ON document_chunks (notebook_id, chunk_id);
