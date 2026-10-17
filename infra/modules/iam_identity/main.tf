# Traceability: Constitution Principle VI, D3, D6, NFR-SEC-01, NFR-SEC-02, FR-WM-04, FR-SI-01 (Subset A)
locals {
  name_prefix = "everlast-${var.environment}"
}

# 1. Dedicated Least-Privilege Service Accounts (docs/solution-architecture.md §5.1)
resource "google_service_account" "api" {
  project      = var.project_id
  account_id   = "${local.name_prefix}-api-sa"
  display_name = "Everlast LM API & Chat Agent Service Account (${var.environment})"
  description  = "Runtime identity for everlast-api Cloud Run service (C1, C2, C3, C5)."
}

resource "google_service_account" "worker" {
  project      = var.project_id
  account_id   = "${local.name_prefix}-worker-sa"
  display_name = "Everlast LM Ingestion & Studio Worker Service Account (${var.environment})"
  description  = "Runtime identity for everlast-worker Cloud Run service (C4, C7, C10)."
}

resource "google_service_account" "tasks_invoker" {
  project      = var.project_id
  account_id   = "${local.name_prefix}-tasks-sa"
  display_name = "Everlast LM Cloud Tasks OIDC Invoker (${var.environment})"
  description  = "Dedicated identity used by Cloud Tasks to push OIDC-authenticated requests to everlast-worker."
}

resource "google_service_account" "ci_deployer" {
  project      = var.project_id
  account_id   = "${local.name_prefix}-ci-sa"
  display_name = "Everlast LM CI/CD Deployer (${var.environment})"
  description  = "Keyless CI/CD identity assumed via Workload Identity Federation."
}

# 2. Project-level Least-Privilege IAM Bindings for everlast-api
locals {
  api_project_roles = toset(concat([
    "roles/aiplatform.user",       # Gemini & Embeddings on Agent Platform (NFR-SEC-01)
    "roles/cloudsql.client",       # Cloud SQL connector access (D1, D4)
    "roles/cloudsql.instanceUser", # IAM database authentication
    "roles/cloudtasks.enqueuer",   # Enqueue ingestion & Studio tasks (FR-SI-01, C-03)
    "roles/logging.logWriter",     # Structured JSON logs (§5.3)
    "roles/cloudtrace.agent",      # OpenTelemetry trace export (§5.3)
    "roles/monitoring.metricWriter",
  ], var.enable_model_armor ? ["roles/modelarmor.user"] : []))

  worker_project_roles = toset(concat([
    "roles/aiplatform.user",       # Gemini, Embeddings & TTS on Agent Platform (NFR-SEC-01)
    "roles/documentai.apiUser",    # Document AI Layout Parser for scanned/tabular PDFs (FR-SI-01 Subset A)
    "roles/cloudsql.client",       # Cloud SQL connector access (D1, D4)
    "roles/cloudsql.instanceUser", # IAM database authentication
    "roles/logging.logWriter",     # Structured JSON logs (§5.3)
    "roles/cloudtrace.agent",      # OpenTelemetry trace export (§5.3)
    "roles/monitoring.metricWriter",
  ], var.enable_model_armor ? ["roles/modelarmor.user"] : []))
}

resource "google_project_iam_member" "api_roles" {
  for_each = local.api_project_roles

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "worker_roles" {
  for_each = local.worker_project_roles

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.worker.email}"
}

# Allow everlast-api to attach the tasks_invoker OIDC service account when enqueueing Cloud Tasks
resource "google_service_account_iam_member" "api_act_as_tasks_invoker" {
  service_account_id = google_service_account.tasks_invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.api.email}"
}

# Allow everlast-api to sign short-lived GCS upload/download URLs (FR-WM-07, FR-SI-01)
resource "google_service_account_iam_member" "api_self_token_creator" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.api.email}"
}

# 3. Identity Platform Configuration (D6, NFR-SEC-02: Generic OIDC/SAML ready)
resource "google_identity_platform_config" "auth" {
  count   = var.enable_identity_platform ? 1 : 0
  project = var.project_id

  autodelete_anonymous_users = true

  sign_in {
    allow_duplicate_emails = false

    anonymous {
      enabled = false
    }

    email {
      enabled           = false
      password_required = false
    }
  }

  authorized_domains = var.authorized_domains
}

# 4. Keyless GitHub Actions Workload Identity Federation (Constitution Principle VI)
resource "google_iam_workload_identity_pool" "github" {
  count                     = var.enable_github_wif ? 1 : 0
  project                   = var.project_id
  workload_identity_pool_id = "${local.name_prefix}-gh-pool"
  display_name              = "GitHub Actions Pool (${var.environment})"
  description               = "Keyless OIDC federation pool for GitHub Actions CI/CD."
}

resource "google_iam_workload_identity_pool_provider" "github" {
  count                              = var.enable_github_wif ? 1 : 0
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github[0].workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub Actions OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.actor"      = "assertion.actor"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  attribute_condition = "assertion.repository == '${var.github_repository}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "github_wif_binding" {
  count              = var.enable_github_wif ? 1 : 0
  service_account_id = google_service_account.ci_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github[0].name}/attribute.repository/${var.github_repository}"
}
