# Traceability: D4, C-01, C-03, FR-SI-01 (Subset A: simultaneous upload of 20 PDFs), §4.1 & §5.2
locals {
  name_prefix = "everlast-${var.environment}"
}

resource "google_cloud_tasks_queue" "ingestion" {
  project  = var.project_id
  name     = "${local.name_prefix}-ingestion-queue"
  location = var.region

  rate_limits {
    max_dispatches_per_second = var.max_dispatches_per_second
    max_concurrent_dispatches = var.max_concurrent_dispatches
  }

  retry_config {
    max_attempts       = 5
    min_backoff        = "2s"
    max_backoff        = "60s"
    max_doublings      = 4
    max_retry_duration = "600s"
  }

  stackdriver_logging_config {
    sampling_ratio = 1.0
  }
}

resource "google_cloud_tasks_queue" "studio" {
  project  = var.project_id
  name     = "${local.name_prefix}-studio-queue"
  location = var.region

  rate_limits {
    max_dispatches_per_second = var.max_dispatches_per_second
    max_concurrent_dispatches = var.max_concurrent_dispatches
  }

  retry_config {
    max_attempts       = 3
    min_backoff        = "5s"
    max_backoff        = "120s"
    max_doublings      = 3
    max_retry_duration = "900s"
  }

  stackdriver_logging_config {
    sampling_ratio = 1.0
  }
}
