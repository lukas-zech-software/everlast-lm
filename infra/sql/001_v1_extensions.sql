-- =============================================================================
-- Everlast LM v1.0 — Cloud SQL for PostgreSQL 16 Extension & Role Bootstrap
-- Traceability: D1, D3, D4, FR-WM-01..07, FR-SI-01..10, FR-GC-01..07, NFR-SEC-01..03
-- =============================================================================
-- Execute this script once per database (`everlast`) after OpenTofu provisions
-- the Cloud SQL instance and IAM service account users (`everlast-api-<env>`,
-- `everlast-worker-<env>`). Application tables and HNSW/GIN indexes are managed
-- by Drizzle ORM migrations in `packages/db`.

-- 1. Enable pgvector for 768-dim text-embedding-005 HNSW cosine similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Enable pgcrypto / uuid-ossp for deterministic and random UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 3. Grant schema and default privileges to Cloud Run IAM database service accounts
-- Replace `<PROJECT_ID>` and `<ENV>` (`dev`, `staging`, `prod`) when executing, or
-- run via the Drizzle migration runner under the database owner role.
DO $$
DECLARE
  sa_role TEXT;
BEGIN
  FOR sa_role IN
    SELECT rolname
    FROM pg_roles
    WHERE rolname LIKE 'everlast-api-%'
       OR rolname LIKE 'everlast-worker-%'
  LOOP
    EXECUTE format('GRANT CONNECT ON DATABASE everlast TO %I', sa_role);
    EXECUTE format('GRANT USAGE, CREATE ON SCHEMA public TO %I', sa_role);
    EXECUTE format('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO %I', sa_role);
    EXECUTE format('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO %I', sa_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO %I', sa_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO %I', sa_role);
  END LOOP;
END
$$;
