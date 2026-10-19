-- Migration 0003: Grounded chat persistence (FR-GC-01, FR-GC-02, FR-GC-06, C-02, NFR-EVAL-04).

CREATE TABLE IF NOT EXISTS chat_threads (
    id UUID PRIMARY KEY,
    notebook_id UUID NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    generation_epoch INTEGER NOT NULL DEFAULT 0 CHECK (generation_epoch >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chat_threads_notebook_user_key UNIQUE (notebook_id, user_id)
);

-- provenance: complete (source_id, revision) set whose chunks entered the prompt for this turn.
-- citations: [{badge_number, source_id, chunk_id, revision}]; snippets/titles are resolved at read time
-- from authorized current chunks so a deleted or revoked source never leaks through history.
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY,
    seq BIGSERIAL NOT NULL UNIQUE,
    thread_id UUID NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
    notebook_id UUID NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    turn_id UUID NOT NULL,
    request_id UUID NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    kind TEXT NOT NULL CHECK (kind IN ('question', 'answer', 'refusal')),
    content TEXT NOT NULL,
    provenance JSONB NOT NULL DEFAULT '[]'::jsonb,
    citations JSONB NOT NULL DEFAULT '[]'::jsonb,
    generation_epoch INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chat_messages_role_kind CHECK ((role = 'user' AND kind = 'question') OR (role = 'assistant' AND kind IN ('answer', 'refusal'))),
    CONSTRAINT chat_messages_request_role_key UNIQUE (thread_id, request_id, role)
);

CREATE INDEX IF NOT EXISTS chat_messages_thread_seq_idx ON chat_messages (thread_id, seq);
