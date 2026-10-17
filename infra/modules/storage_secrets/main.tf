# Traceability: D3, D4, FR-WM-01, FR-WM-07, FR-SI-01 (Subset A), NFR-SEC-01, Constitution Principle VI
locals {
  name_prefix = "everlast-${var.environment}"
}

# 1. Single Cloud Storage Bucket per Environment (docs/solution-architecture.md §4.1 & §5.2)
resource "google_storage_bucket" "workspace" {
  project                     = var.project_id
  name                        = "${var.project_id}-${local.name_prefix}-workspace"
  location                    = upper(var.region)
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = var.force_destroy_bucket
  labels                      = var.labels

  versioning {
    enabled = true
  }

  # Purge incomplete multipart uploads and noncurrent object versions after 7 days (FR-WM-07, §5.2)
  lifecycle_rule {
    condition {
      age = 1
    }
    action {
      type = "AbortIncompleteMultipartUpload"
    }
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 3
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  # Allow browser direct uploads via size-constrained signed URLs (FR-WM-07: <= 200,000,000 bytes)
  cors {
    origin          = var.cors_allowed_origins
    method          = ["GET", "HEAD", "PUT", "POST", "OPTIONS"]
    response_header = ["Content-Type", "Content-Length", "ETag", "x-goog-resumable"]
    max_age_seconds = 3600
  }
}

# Bucket-scoped Least-Privilege IAM (docs/solution-architecture.md §5.1)
resource "google_storage_bucket_iam_member" "api_object_user" {
  bucket = google_storage_bucket.workspace.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${var.api_service_account_email}"
}

resource "google_storage_bucket_iam_member" "worker_object_user" {
  bucket = google_storage_bucket.workspace.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${var.worker_service_account_email}"
}

# 2. Artifact Registry for Cloud Run Container Images (europe-west4)
resource "google_artifact_registry_repository" "containers" {
  project       = var.project_id
  location      = var.region
  repository_id = "${local.name_prefix}-containers"
  description   = "Container images for Everlast LM Cloud Run services (${var.environment})"
  format        = "DOCKER"
  labels        = var.labels

  cleanup_policies {
    id     = "keep-recent-10"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }
}

resource "google_artifact_registry_repository_iam_member" "ci_writer" {
  project    = var.project_id
  location   = google_artifact_registry_repository.containers.location
  repository = google_artifact_registry_repository.containers.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${var.ci_deployer_service_account_email}"
}

# 3. Secret Manager Secrets (Regional EU replication per D3 & Constitution Principle VI)
locals {
  managed_secrets = {
    app_session_secret = "HMAC signing secret for Everlast LM session cookies and answer-bound citation tokens"
    oidc_client_config = "JSON configuration for generic OIDC/SAML corporate identity provider (D6)"
  }
}

resource "google_secret_manager_secret" "secrets" {
  for_each = local.managed_secrets

  project   = var.project_id
  secret_id = "${local.name_prefix}-${replace(each.key, "_", "-")}"
  labels    = var.labels

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

resource "google_secret_manager_secret_iam_member" "api_secret_accessor" {
  for_each = google_secret_manager_secret.secrets

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.api_service_account_email}"
}

resource "google_secret_manager_secret_iam_member" "worker_secret_accessor" {
  for_each = google_secret_manager_secret.secrets

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.worker_service_account_email}"
}

# 4. Document AI Layout Parser Processor for Scanned/Tabular PDFs (FR-SI-01 Subset A, Gate v1.0 #1)
locals {
  # Document AI uses multi-regional "eu" location for European data residency
  documentai_location = startswith(var.region, "europe-") ? "eu" : "us"
}

resource "google_document_ai_processor" "layout_parser" {
  project      = var.project_id
  location     = local.documentai_location
  display_name = "${local.name_prefix}-layout-parser"
  type         = "LAYOUT_PARSER_PROCESSOR"
}
