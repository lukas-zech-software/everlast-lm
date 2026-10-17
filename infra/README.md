# Everlast LM — OpenTofu Infrastructure (`infra/`)

This directory contains the declarative Google Cloud Platform (GCP) infrastructure-as-code (IaC) for **Everlast LM** managed with **OpenTofu (`tofu`)**, governed by [`.specify/memory/constitution.md`](../.specify/memory/constitution.md) (Principle VI), [`spec/System_Requirements_Specification_Gemeni_Notebook.md`](../spec/System_Requirements_Specification_Gemeni_Notebook.md) (SRS), and [`docs/solution-architecture.md`](../docs/solution-architecture.md) (Decisions `D1`–`D14`).

---

## 1. Directory & Module Structure

The OpenTofu codebase follows a 3-layer composition pattern (**Domain Modules → Release Stack → Environment Roots**) so that release resources (`v1_foundation`) are defined once and instantiated identically across `dev`, `staging`, and `prod`:

```text
infra/
├── README.md                                  # Detailed operational & deployment guide (this file)
├── sql/
│   └── 001_v1_extensions.sql                  # Post-provisioning Cloud SQL bootstrap (pgvector, pgcrypto, IAM grants)
├── modules/
│   ├── project_services/                      # Gated GCP API activation (enable_project_services = false by default)
│   │   ├── main.tf
│   │   ├── outputs.tf
│   │   ├── variables.tf
│   │   └── versions.tf
│   ├── iam_identity/                          # Service Accounts, least-privilege IAM, Identity Platform, GitHub WIF
│   │   ├── main.tf
│   │   ├── outputs.tf
│   │   ├── variables.tf
│   │   └── versions.tf
│   ├── storage_secrets/                       # EU GCS Bucket, Docker Artifact Registry, Secret Manager, Document AI
│   │   ├── main.tf
│   │   ├── outputs.tf
│   │   ├── variables.tf
│   │   └── versions.tf
│   ├── database/                              # Cloud SQL for PostgreSQL 16 (Enterprise, HNSW-ready, IAM DB Auth)
│   │   ├── main.tf
│   │   ├── outputs.tf
│   │   ├── variables.tf
│   │   └── versions.tf
│   ├── async_tasks/                           # Cloud Tasks queues (ingestion-queue, studio-queue) in europe-west4
│   │   ├── main.tf
│   │   ├── outputs.tf
│   │   ├── variables.tf
│   │   └── versions.tf
│   └── compute/                               # Cloud Run v2 services (everlast-api public, everlast-worker internal)
│       ├── main.tf
│       ├── outputs.tf
│       ├── variables.tf
│       └── versions.tf
├── stacks/
│   └── v1_foundation/                         # Composite stack wiring all v1.0 resources and cross-module IAM
│       ├── main.tf
│       ├── outputs.tf
│       ├── variables.tf
│       └── versions.tf
└── environments/
    ├── dev/                                   # Development / Demo environment root
    │   ├── .terraform.lock.hcl                # Pinned OpenTofu provider checksums (hashicorp/google & google-beta v6.50.0)
    │   ├── backend.hcl.example                # Remote GCS state backend configuration template
    │   ├── main.tf
    │   ├── opentofu.auto.tfvars.example       # Environment variable template (copy to gitignored opentofu.auto.tfvars)
    │   ├── outputs.tf
    │   ├── variables.tf
    │   └── versions.tf
    ├── staging/                               # Pre-production validation environment root
    │   ├── .terraform.lock.hcl
    │   ├── backend.hcl.example
    │   ├── main.tf
    │   ├── opentofu.auto.tfvars.example
    │   ├── outputs.tf
    │   ├── variables.tf
    │   └── versions.tf
    └── prod/                                  # Production environment root (REGIONAL HA Cloud SQL + deletion protection)
        ├── .terraform.lock.hcl
        ├── backend.hcl.example
        ├── main.tf
        ├── opentofu.auto.tfvars.example
        ├── outputs.tf
        ├── variables.tf
        └── versions.tf
```

---

## 2. Version 1.0 Resource Inventory & Requirements Traceability

Every resource provisioned by `infra/stacks/v1_foundation` maps directly to an SRS requirement (`FR-*`, `NFR-*`) or binding Architecture Decision (`D1`–`D14`):

| Module | OpenTofu Resource(s) | Purpose & Configuration | SRS / Decision Traceability |
| :--- | :--- | :--- | :--- |
| `project_services` | `google_project_service.v1_apis` | Activates required v1.0 GCP APIs (`run`, `cloudbuild`, `artifactregistry`, `storage`, `cloudtrace`, `logging`, `monitoring`, `aiplatform`, `sqladmin`, `cloudtasks`, `secretmanager`, `identitytoolkit`, `documentai`, `iam`, `iamcredentials`) only when `enable_project_services = true`. | `D3`, `D14`, Constitution Principle VI |
| `iam_identity` | `google_service_account.{api,worker,tasks_invoker,ci_deployer}`, `google_project_iam_member.*` | Dedicated least-privilege runtime identities for `everlast-api`, `everlast-worker`, Cloud Tasks OIDC invocation, and keyless GitHub Actions deployment. | `D3`, `D6`, `NFR-SEC-01`, `NFR-SEC-02` |
| `iam_identity` | `google_identity_platform_config.auth` | Configures Google Cloud Identity Platform in the target project with authorized OIDC callback domains. | `D6`, `FR-WM-01`, `NFR-SEC-02` |
| `iam_identity` | `google_iam_workload_identity_pool.github`, `google_iam_workload_identity_pool_provider.github_oidc` | Keyless OIDC federation for GitHub Actions CI/CD restricted to `var.github_repository`. | `D3`, `NFR-SEC-01` |
| `storage_secrets` | `google_storage_bucket.workspace` | Regional (`EUROPE-WEST4`) bucket with uniform bucket-level access, enforced public access prevention, object versioning, CORS for direct browser signed-URL uploads (`200 MB = 200,000,000 bytes`), and `tmp/uploads/` cleanup lifecycle rule. | `D3`, `FR-WM-04`, `FR-SI-01`, `FR-SI-05`, `NFR-SEC-01`, `NFR-SEC-03` |
| `storage_secrets` | `google_artifact_registry_repository.containers` | Regional (`europe-west4`) Docker repository for `everlast-api` and `everlast-worker` images. | `D3` |
| `storage_secrets` | `google_secret_manager_regional_secret.{app_session_secret,oidc_client_config}` | Regional (`europe-west4`) Secret Manager secrets with least-privilege `secretAccessor` bindings for `everlast-api`. | `D3`, `NFR-SEC-01` |
| `storage_secrets` | `google_document_ai_processor.layout_parser` | EU (`location = "eu"`) Document AI `LAYOUT_PARSER_PROCESSOR` for PDF text, structure, and bounding-box extraction (`C-01`). | `D3`, `FR-SI-01` (Subset A), `FR-SI-08`, `C-01` |
| `database` | `google_sql_database_instance.postgres`, `google_sql_database.everlast`, `google_sql_user.{api_iam,worker_iam}` | Single Cloud SQL for PostgreSQL 16 (`ENTERPRISE`, `db-custom-1-3840` dedicated-core minimum for `pgvector` HNSW indexes) in `europe-west4` with `cloudsql.iam_authentication = on`, `ENCRYPTED_ONLY` SSL, PITR backups, and IAM Service Account users. | `D1`, `D3`, `D4`, `FR-WM-01..07`, `FR-SI-09`, `FR-GC-01..07`, `NFR-PERF-01`, `NFR-SEC-01..03` |
| `async_tasks` | `google_cloud_tasks_queue.{ingestion,studio}` | Regional (`europe-west4`) Cloud Tasks queues (`everlast-<env>-ingestion-queue` and `everlast-<env>-studio-queue`) with exponential retry backoff and OIDC push task Enqueuer IAM bindings. | `D3`, `FR-SI-07`, `NFR-PERF-03` |
| `compute` | `google_cloud_run_v2_service.worker`, `google_cloud_run_v2_service_iam_member.*` | Internal-only (`INGRESS_TRAFFIC_INTERNAL_ONLY`), scale-to-zero (`min_instance_count = 0`) async worker service mounted to Cloud SQL and invocable exclusively via OIDC tokens from `tasks_invoker` and `api` SAs. | `D3`, `D4`, `FR-SI-01`, `FR-SI-07`, `FR-SI-08`, `FR-SI-09` |
| `compute` | `google_cloud_run_v2_service.api`, `google_cloud_run_v2_service_iam_member.api_public_invoker` | Public (`INGRESS_TRAFFIC_ALL`), scale-to-zero (`min_instance_count = 0` by default) BFF + SPA + ADK Grounded Chat service with `cpu_idle = false` for SSE streaming and v1 quota env vars (`200,000,000` bytes, `500,000` words, `50` sources/notebook). | `D2`, `D3`, `D4`, `FR-WM-01..07`, `FR-SI-05..07`, `FR-GC-01..07`, `FR-UI-01..04`, `NFR-PERF-01..02` |

---

## 3. Prerequisites & Offline Validation

### Required Tooling
1. **OpenTofu CLI (`tofu`)** `>= 1.6.0` (CI uses `1.10.0`; local `1.13.1+` is supported)
2. **Google Cloud SDK (`gcloud`)** for authentication and one-time state bucket / secret payload bootstrap
3. **Node.js & npm/pnpm** for running repository-level convenience scripts

### Installing Provider Dependencies & Validating Locally (No GCP Credentials Required)

Provider lockfiles (`.terraform.lock.hcl`) for `registry.opentofu.org/hashicorp/google` (`v6.50.0`) and `registry.opentofu.org/hashicorp/google-beta` (`v6.50.0`) are committed in `infra/environments/{dev,staging,prod}`.

From the repository root, run:

```bash
# 1. Download OpenTofu provider binaries into .terraform/ for dev, staging, and prod (backend disabled)
npm run infra:init:local

# 2. Check canonical HCL formatting across all modules, stacks, and environments
npm run infra:fmt:check

# 3. Validate provider schemas, resource graphs, and variable constraints across all 3 environments
npm run infra:validate

# 4. Verify specification and Markdown link integrity
npm run check:specs
```

To auto-format any modified `.tf` files using OpenTofu:

```bash
npm run infra:fmt
```

---

## 4. One-Time Google Cloud Bootstrap (`gcloud` 4-Step Verified Procedures)

Before running `tofu init` with the remote GCS backend or mounting secrets in Cloud Run, a project owner must:
1. Verify or enable prerequisite APIs in the target GCP project.
2. Create the remote OpenTofu state GCS bucket (`everlast-lm-<env>-tfstate`) in `europe-west4` with object versioning enabled.
3. After the initial `tofu apply`, populate Secret Manager secret versions (`app-session-secret` and `oidc-client-config`).

All `gcloud` commands below have been verified against `gcloud help <leaf_command>` and follow the safety-critical 4-step execution protocol.

### 4.1 Check Currently Enabled Project APIs (Read-Only)

- **Step 1: Help & Syntax Discovery**
  Verified via `gcloud help services list`.
- **Step 2: Parameter Verification & Dry-Run Check**
  - Target project: `--project=<PROJECT_ID>` (e.g., `everlast-lm-dev`)
  - Data reduction flags: `--enabled`, `--filter`, `--format="table(config.name,config.title)"`, `--limit=50`
  - Dry-run status: Read-only command; no `--dry-run` flag exists or is needed.
- **Step 3: Dry-Run Execution**
  N/A (read-only list operation).
- **Step 4: Single-Command Execution**
  ```bash
  gcloud services list \
    --project=everlast-lm-dev \
    --enabled \
    --filter="config.name:(run.googleapis.com OR sqladmin.googleapis.com OR storage.googleapis.com OR aiplatform.googleapis.com OR documentai.googleapis.com OR cloudtasks.googleapis.com OR secretmanager.googleapis.com OR identitytoolkit.googleapis.com)" \
    --format="table(config.name,config.title)" \
    --limit=50 \
    --quiet
  ```

### 4.2 Create the Remote OpenTofu State Bucket in `europe-west4`

- **Step 1: Help & Syntax Discovery**
  Verified via `gcloud help storage buckets create`.
- **Step 2: Parameter Verification & Dry-Run Check**
  - Bucket URI: `gs://everlast-lm-dev-tfstate` (replace `dev` with `staging` or `prod` per environment)
  - Project: `--project=everlast-lm-dev`
  - Location: `--location=europe-west4` (`D3` EU data residency)
  - Security flags: `--uniform-bucket-level-access` and `--public-access-prevention`
  - Dry-run status: `gcloud storage buckets create` does not support `--dry-run` or `--validate-only`.
- **Step 3: Dry-Run Execution**
  Not supported by `gcloud storage buckets create`; verify bucket name and project ID carefully before executing Step 4.
- **Step 4: Single-Command Execution**
  ```bash
  gcloud storage buckets create gs://everlast-lm-dev-tfstate \
    --project=everlast-lm-dev \
    --location=europe-west4 \
    --default-storage-class=STANDARD \
    --uniform-bucket-level-access \
    --public-access-prevention \
    --quiet
  ```

### 4.3 Enable Object Versioning on the Remote OpenTofu State Bucket

- **Step 1: Help & Syntax Discovery**
  Verified via `gcloud help storage buckets update`.
- **Step 2: Parameter Verification & Dry-Run Check**
  - Bucket URI: `gs://everlast-lm-dev-tfstate`
  - Project: `--project=everlast-lm-dev`
  - Versioning flag: `--versioning`
  - Dry-run status: `gcloud storage buckets update` does not support `--dry-run` or `--validate-only`.
- **Step 3: Dry-Run Execution**
  Not supported by `gcloud storage buckets update`.
- **Step 4: Single-Command Execution**
  ```bash
  gcloud storage buckets update gs://everlast-lm-dev-tfstate \
    --project=everlast-lm-dev \
    --versioning \
    --quiet
  ```

### 4.4 Populate Regional Secret Manager Versions (Post-Initial `tofu apply`)

Because `storage_secrets` creates **regional** secrets (`google_secret_manager_regional_secret` in `europe-west4`), `--location=europe-west4` is mandatory when adding secret versions via `gcloud`.

- **Step 1: Help & Syntax Discovery**
  Verified via `gcloud help secrets versions add`.
- **Step 2: Parameter Verification & Dry-Run Check**
  - Secret IDs: `everlast-dev-app-session-secret` and `everlast-dev-oidc-client-config`
  - Project: `--project=everlast-lm-dev`
  - Location: `--location=europe-west4`
  - Payload input: `--data-file=/path/to/secret.txt`
  - Dry-run status: `gcloud secrets versions add` does not support `--dry-run` or `--validate-only`.
- **Step 3: Dry-Run Execution**
  Not supported by `gcloud secrets versions add`.
- **Step 4: Single-Command Execution**
  ```bash
  gcloud secrets versions add everlast-dev-app-session-secret \
    --project=everlast-lm-dev \
    --location=europe-west4 \
    --data-file=/path/to/app-session-secret.txt \
    --quiet
  ```
  ```bash
  gcloud secrets versions add everlast-dev-oidc-client-config \
    --project=everlast-lm-dev \
    --location=europe-west4 \
    --data-file=/path/to/oidc-client-config.json \
    --quiet
  ```

---

## 5. Step-by-Step Local OpenTofu Deployment Workflow

### Step 1: Configure Backend & Environment Variables

Navigate to the target environment directory (e.g., `infra/environments/dev`) and copy the example configuration files:

```bash
cp infra/environments/dev/backend.hcl.example infra/environments/dev/backend.hcl
cp infra/environments/dev/opentofu.auto.tfvars.example infra/environments/dev/opentofu.auto.tfvars
```

Edit `infra/environments/dev/opentofu.auto.tfvars` (which is gitignored via `infra/**/*.tfvars` so project-specific overrides are never accidentally committed):
- Set `project_id` to your GCP project ID.
- If the project owner has approved enabling billable GCP APIs via OpenTofu, set `enable_project_services = true` for the initial apply.
- Leave `mount_secrets = false` on the very first run until the Secret Manager secret containers are created and populated with their initial version (Section 4.4).

### Step 2: Initialize with Remote GCS Backend

```bash
tofu -chdir=infra/environments/dev init -reconfigure -backend-config=backend.hcl
```

### Step 3: Generate & Review the Execution Plan

```bash
tofu -chdir=infra/environments/dev plan -out=tfplan.binary
```

Verify that:
- All regional resources target `europe-west4` (and `eu` for Document AI).
- Cloud SQL uses `POSTGRES_16` on `db-custom-1-3840` (`ENTERPRISE` edition) with `cloudsql.iam_authentication = "on"`.
- `everlast-worker` is configured with `INGRESS_TRAFFIC_INTERNAL_ONLY`.

### Step 4: Apply the Plan

```bash
tofu -chdir=infra/environments/dev apply tfplan.binary
```

### Step 5: Bootstrap Cloud SQL Extensions (`pgvector`) & Enable Secret Mounting

1. Connect to the `everlast` database on the provisioned Cloud SQL instance (using Cloud SQL Auth Proxy or Cloud SQL Studio) and execute [`sql/001_v1_extensions.sql`](./sql/001_v1_extensions.sql) to enable `vector` (`pgvector`) and `pgcrypto`, and grant schema privileges to the IAM database service accounts (`everlast-api-<env>`, `everlast-worker-<env>`).
2. Populate the initial Secret Manager secret versions (Section 4.4), then set `mount_secrets = true` in `opentofu.auto.tfvars` and re-run `tofu plan` / `tofu apply` so `everlast-api` mounts `SESSION_SECRET` and `OIDC_CLIENT_CONFIG`.

---

## 6. CI/CD Deployment Workflow (`.github/workflows/opentofu.yml`)

The GitHub Actions workflow in [`../.github/workflows/opentofu.yml`](../.github/workflows/opentofu.yml) automates validation, planning, and environment-gated deployment using **OpenTofu (`opentofu/setup-opentofu@v1`)** and **keyless Workload Identity Federation (WIF)** (no long-lived service account JSON keys):

1. **Job 1 — `validate` (Always Runs on Every PR & Push):**
   - Runs `tofu fmt -check -recursive` across `infra/`.
   - Runs `tofu init -backend=false` and `tofu validate` across all three environments (`dev`, `staging`, `prod`) in parallel.
   - Requires zero GCP credentials and blocks any malformed HCL or broken module interfaces before merge.

2. **Job 2 — `plan` (Authenticated via Keyless WIF):**
   - Runs when the target GitHub Environment (`dev`, `staging`, or `prod`) has the following GitHub Environment Variables configured:
     - `GCP_PROJECT_ID`: Target GCP project ID (e.g., `everlast-lm-dev`)
     - `GCP_WIF_PROVIDER`: Workload Identity Provider resource name output by `module.iam_identity` (`workload_identity_provider_name`, when `enable_github_wif = true`)
     - `GCP_CI_SERVICE_ACCOUNT`: Email of `everlast-ci-tf-<env>@<project>.iam.gserviceaccount.com`
     - `GCP_TFSTATE_BUCKET`: Name of the GCS state bucket (e.g., `everlast-lm-dev-tfstate`)
   - Produces a deterministic `tfplan.binary` artifact uploaded for inspection and downstream apply.
   - If the GitHub Environment variables are not yet configured, the step emits a clear notice and succeeds cleanly after offline validation.

3. **Job 3 — `apply` (Protected GitHub Environment Gate):**
   - Triggered on merge to `main` (for `dev`) or via manual `workflow_dispatch` (`action = apply`, `environment = dev | staging | prod`).
   - Downloads the exact `tfplan.binary` artifact produced by `plan` and executes `tofu apply -input=false -auto-approve tfplan.binary` inside the protected GitHub Environment (enforcing required reviewers on `staging` and `prod`).

---

## 7. FinOps & Demo Operations (`D4` & Architecture §5.4–§5.5)

- **Scale-to-Zero Compute:** Both `everlast-api` and `everlast-worker` default to `min_instance_count = 0`, incurring `$0` when idle.
- **Pre-Demo Warm-Up (`NFR-PERF-01` / `NFR-PERF-02`):** Before live stakeholder evaluations or latency gate runs, set `api_min_instances = 1` in `opentofu.auto.tfvars` and apply so cold-start latency is eliminated. Revert to `0` immediately afterward.
- **Pausing Cloud SQL Between Demo Phases:** Cloud SQL (`db-custom-1-3840`) is the only fixed-cost baseline resource (`~$50–$65/month` while active). Between active development/demo phases, set `db_activation_policy = "NEVER"` in `opentofu.auto.tfvars` and apply to stop compute billing while preserving SSD storage (`~$3.40/month` for 20 GB). Set back to `"ALWAYS"` before resuming work.
