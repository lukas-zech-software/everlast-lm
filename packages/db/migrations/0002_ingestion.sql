-- Migration 0002: Ingestion, C-01 chunk persistence and hybrid retrieval index (FR-SI-01, FR-SI-04, C-01, C-02, D1).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS source_revisions (
    notebook_id UUID NOT NULL,
    source_id UUID NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    byte_size BIGINT NOT NULL CHECK (byte_size >= 0 AND byte_size <= 200000000),
    word_count INTEGER NOT NULL CHECK (word_count >= 0 AND word_count <= 500000),
    page_count INTEGER CHECK (page_count >= 0),
    embedding_model TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (notebook_id, source_id, revision),
    FOREIGN KEY (notebook_id, source_id) REFERENCES sources (notebook_id, id) ON DELETE CASCADE
);

-- Canonical extracted text per page (viewer representation). Chunk locators index these code points.
CREATE TABLE IF NOT EXISTS source_pages (
    notebook_id UUID NOT NULL,
    source_id UUID NOT NULL,
    revision INTEGER NOT NULL,
    page_number INTEGER NOT NULL CHECK (page_number > 0),
    physical_page INTEGER CHECK (physical_page > 0),
    text TEXT NOT NULL,
    PRIMARY KEY (notebook_id, source_id, revision, page_number),
    FOREIGN KEY (notebook_id, source_id, revision) REFERENCES source_revisions (notebook_id, source_id, revision) ON DELETE CASCADE
);

-- One chunks table: C-01 projection (chunk_id, source_id, revision, locator, token_count, text) plus
-- database-only columns (notebook_id, sequence, embedding, tsv) that are never exposed as C-01 fields.
CREATE TABLE IF NOT EXISTS chunks (
    chunk_id UUID PRIMARY KEY,
    notebook_id UUID NOT NULL,
    source_id UUID NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    text TEXT NOT NULL CHECK (char_length(text) > 0),
    token_count INTEGER NOT NULL CHECK (token_count >= 0),
    locator JSONB NOT NULL,
    embedding vector(768) NOT NULL,
    tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED,
    FOREIGN KEY (notebook_id, source_id, revision) REFERENCES source_revisions (notebook_id, source_id, revision) ON DELETE CASCADE,
    CONSTRAINT chunks_sequence_unique UNIQUE (notebook_id, source_id, revision, sequence)
);

CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING gin (tsv);
