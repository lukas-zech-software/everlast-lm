-- Migration 0001: Workspace Foundation Schema
-- Defines users, notebooks, sources (admission ledger), and cleanup_outbox (FR-WM-01, FR-WM-04, FR-WM-07).

-- 1. Users table (stable verified Identity Platform subjects)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    subject VARCHAR(255) UNIQUE NOT NULL,
    issuer VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Notebooks table (owner-scoped, 1–100 Unicode char titles, cascade deletion)
CREATE TABLE IF NOT EXISTS notebooks (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notebooks_owner_id ON notebooks(owner_id);

-- 3. Sources table (admission ledger, composite PK, nonnegative bounds)
CREATE TABLE IF NOT EXISTS sources (
    id UUID NOT NULL,
    notebook_id UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    title VARCHAR(100) NOT NULL,
    media_type VARCHAR(50),
    status VARCHAR(50) NOT NULL,
    byte_size BIGINT NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
    word_count INT NOT NULL DEFAULT 0 CHECK (word_count >= 0),
    revision_id INT NOT NULL DEFAULT 1,
    attempt_id UUID UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (notebook_id, id)
);

CREATE INDEX IF NOT EXISTS idx_sources_notebook_status ON sources(notebook_id, status);

-- 4. Cleanup Outbox table (payload-free deletion fences & durable async dispatch)
CREATE TABLE IF NOT EXISTS cleanup_outbox (
    id UUID PRIMARY KEY,
    operation_id UUID NOT NULL,
    notebook_id UUID NOT NULL,
    owner_id UUID NOT NULL,
    status VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cleanup_outbox_status ON cleanup_outbox(status);
