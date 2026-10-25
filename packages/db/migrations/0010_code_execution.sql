-- Migration 0010: Package 3.2 Quantitative Code Execution Sandbox (FR-GC-08, FR-GC-06, C-02, NFR-SEC-02, NFR-EVAL-04).
-- specs/010-code-execution-sandbox. Additive only: 0001–0009 are untouched, new columns are nullable and widened
-- CHECKs accept every old value, so the previous API revision keeps working during a MIGRATE_ON_START rollout.
-- Package 3.3 allocates 0011 or later.

-- ChatMessage.code_execution_trace (FR-007): versioned JSON, assistant rows only; NULL for legacy/clarification.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS code_execution_trace JSONB;
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_trace_shape;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_trace_shape CHECK (
    code_execution_trace IS NULL
    OR (role = 'assistant' AND jsonb_typeof(code_execution_trace) = 'object' AND code_execution_trace ->> 'schema_version' = '1'));

-- Typed non-computed clarification turn (FR-014): an assistant question, never a factual answer.
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_kind_check;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_kind_check CHECK (kind IN ('question', 'answer', 'refusal', 'clarification'));
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_role_kind;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_role_kind CHECK (
    (role = 'user' AND kind = 'question') OR (role = 'assistant' AND kind IN ('answer', 'refusal', 'clarification')));

-- Durable execution admission + lease/epoch fence (plan: AbortController map is cancellation only).
-- One active execution per (user, notebook); one execution per (thread, request) ever, so a replayed or
-- duplicated request can never run Python twice. The row (with code/stdout) is deleted by Clear chat.
CREATE TABLE IF NOT EXISTS code_executions (
    id UUID PRIMARY KEY,
    thread_id UUID NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
    notebook_id UUID NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    request_id UUID NOT NULL,
    generation_epoch INTEGER NOT NULL CHECK (generation_epoch >= 0),
    state TEXT NOT NULL CHECK (state IN ('CodeGenerating', 'SandboxRunning', 'Succeeded', 'TimedOut', 'Failed')),
    failure_code TEXT CHECK (failure_code IN ('PythonException', 'ExecutionTimeout', 'MemoryLimitExceeded', 'TemporaryStorageLimit',
        'SecurityViolation', 'ProviderUnavailable', 'ExecutionOutcomeUnknown', 'ScopeChanged', 'AccessRevoked',
        'GenerationCancelled', 'CitationInvalid', 'InvalidOutput')),
    attempt_ordinal SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_ordinal BETWEEN 0 AND 2),
    source_snapshot JSONB NOT NULL,
    trace JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Restricted operational metadata (runtime/profile versions); never part of a ChatMessage DTO.
    runtime_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    lease_token UUID NOT NULL,
    lease_expires_at TIMESTAMPTZ NOT NULL,
    message_id UUID REFERENCES chat_messages (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    CONSTRAINT code_executions_thread_request_key UNIQUE (thread_id, request_id),
    CONSTRAINT code_executions_terminal_failure CHECK (
        (state = 'Succeeded' AND failure_code IS NULL)
        OR (state IN ('TimedOut', 'Failed') AND failure_code IS NOT NULL)
        OR (state IN ('CodeGenerating', 'SandboxRunning') AND failure_code IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS code_executions_active_fence
    ON code_executions (user_id, notebook_id) WHERE state IN ('CodeGenerating', 'SandboxRunning');
CREATE INDEX IF NOT EXISTS code_executions_lease_idx
    ON code_executions (lease_expires_at) WHERE state IN ('CodeGenerating', 'SandboxRunning');

-- Payload-free provider cleanup ledger (no code, no data). Deliberately no FK to notebooks/executions with
-- cascade: a deleted notebook or cleared chat must not erase the record of a remote sandbox that still needs
-- deletion. Destruction retries are idempotent resource deletion, never a computation retry.
CREATE TABLE IF NOT EXISTS code_execution_sandboxes (
    attempt_id UUID PRIMARY KEY,
    execution_id UUID,
    notebook_id UUID NOT NULL,
    provider_handle TEXT CHECK (char_length(provider_handle) <= 512),
    state TEXT NOT NULL CHECK (state IN ('Creating', 'Active', 'DestroyPending', 'Destroyed')),
    destroy_attempts INTEGER NOT NULL DEFAULT 0 CHECK (destroy_attempts >= 0),
    last_error_code TEXT CHECK (char_length(last_error_code) <= 64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    destroyed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS code_execution_sandboxes_open_idx
    ON code_execution_sandboxes (updated_at) WHERE state <> 'Destroyed';

-- Private chart artifacts (FR-005, NFR-SEC-02). Bytes live in private object storage under the notebook prefix
-- (so notebook deletion purges them); delivery is only through the authorized chart route.
CREATE TABLE IF NOT EXISTS chart_artifacts (
    id UUID PRIMARY KEY,
    execution_id UUID REFERENCES code_executions (id) ON DELETE SET NULL,
    attempt_id UUID NOT NULL,
    notebook_id UUID NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    message_id UUID REFERENCES chat_messages (id) ON DELETE SET NULL,
    object_key TEXT NOT NULL CHECK (char_length(object_key) BETWEEN 1 AND 512),
    object_generation TEXT NOT NULL CHECK (char_length(object_generation) BETWEEN 1 AND 64),
    mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/svg+xml')),
    digest TEXT NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
    byte_size INTEGER NOT NULL CHECK (byte_size > 0),
    source_snapshot JSONB NOT NULL,
    citation_chunk_ids JSONB NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('candidate', 'published', 'invalidated')),
    object_deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chart_artifacts_message_idx ON chart_artifacts (message_id);
CREATE INDEX IF NOT EXISTS chart_artifacts_purge_idx ON chart_artifacts (updated_at) WHERE state <> 'published' AND object_deleted_at IS NULL;
