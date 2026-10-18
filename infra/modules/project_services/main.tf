# Traceability: SRS §5.3 v1.0, docs/solution-architecture.md §2.3 & §7, NFR-SEC-01, FR-SI-01 (Subset A)
locals {
  baseline_v1_apis = [
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "storage.googleapis.com",
    "cloudtrace.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "aiplatform.googleapis.com",
    "sqladmin.googleapis.com",
    "cloudtasks.googleapis.com",
    "secretmanager.googleapis.com",
    "identitytoolkit.googleapis.com",
    "documentai.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "cloudresourcemanager.googleapis.com",
  ]

  optional_v1_apis = var.enable_model_armor ? ["modelarmor.googleapis.com"] : []

  required_apis = toset(concat(local.baseline_v1_apis, local.optional_v1_apis))
}

resource "google_project_service" "v1_apis" {
  for_each = var.enable_project_services ? local.required_apis : toset([])

  project                    = var.project_id
  service                    = each.value
  disable_dependent_services = false
  disable_on_destroy         = var.disable_on_destroy
}
