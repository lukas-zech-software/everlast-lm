-- Migration 0003: Grounded Chat & Citation Engine Schema
-- Traceability: FR-GC-01, FR-GC-02, FR-GC-03, FR-GC-06, C-01, C-02, FR-WM-04

-- 1. Chat Threads table (exactly one thread per notebook/user pair in v1.0)
CREATE TABLE IF NOT EXISTS chat_threads (
    id UUID PRIMARY KEY,
    notebook_id UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    generation_epoch INT NOT NULL DEFAULT 0 CHECK (generation_epoch >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_chat_threads_notebook_user UNIQUE (notebook_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_notebook_user ON chat_threads(notebook_id, user_id);

-- 2. Chat Messages table (persisted turns with immutable source/revision provenance & citations)
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY,
    thread_id UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    notebook_id UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    active_source_revisions_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
    citations JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created ON chat_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_notebook_user ON chat_messages(notebook_id, user_id);
