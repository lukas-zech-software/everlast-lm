# Traceability: D1, D4, C-01, C-02, FR-WM-01, FR-WM-04, FR-SI-01, FR-GC-06, NFR-EVAL-04, NFR-PERF-01
locals {
  name_prefix = "everlast-${var.environment}"
  # Cloud SQL IAM service account usernames strip the ".gserviceaccount.com" suffix
  api_iam_user    = trimsuffix(var.api_service_account_email, ".gserviceaccount.com")
  worker_iam_user = trimsuffix(var.worker_service_account_email, ".gserviceaccount.com")
}

resource "google_sql_database_instance" "postgres" {
  project             = var.project_id
  name                = "${local.name_prefix}-pg"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = var.deletion_protection

  settings {
    tier                        = var.tier
    edition                     = "ENTERPRISE"
    availability_type           = var.availability_type
    disk_type                   = "PD_SSD"
    disk_size                   = var.disk_size_gb
    disk_autoresize             = true
    disk_autoresize_limit       = 200
    activation_policy           = var.activation_policy
    deletion_protection_enabled = var.deletion_protection
    user_labels                 = var.labels

    # IAM database authentication (keyless, no password in env vars per §5.1 & Constitution VI)
    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }

    database_flags {
      name  = "max_connections"
      value = "100"
    }

    # Point-in-time recovery covering relational tables + pgvector HNSW index + FTS (§5.2)
    backup_configuration {
      enabled                        = true
      start_time                     = "02:00"
      location                       = var.region
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }

    insights_config {
      query_insights_enabled  = true
      query_plans_per_minute  = 5
      query_string_length     = 1024
      record_application_tags = true
    }

    maintenance_window {
      day          = 7
      hour         = 3
      update_track = "stable"
    }
  }
}

resource "google_sql_database" "everlast" {
  project   = var.project_id
  instance  = google_sql_database_instance.postgres.name
  name      = "everlast"
  charset   = "UTF8"
  collation = "en_US.UTF8"
}

resource "google_sql_user" "api_iam_user" {
  project  = var.project_id
  instance = google_sql_database_instance.postgres.name
  name     = local.api_iam_user
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"
}

resource "google_sql_user" "worker_iam_user" {
  project  = var.project_id
  instance = google_sql_database_instance.postgres.name
  name     = local.worker_iam_user
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"
}
