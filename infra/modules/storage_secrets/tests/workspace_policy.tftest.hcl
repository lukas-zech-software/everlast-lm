# T042 — FR-WM-01 / FR-WM-04 / NFR-SEC-01 workspace storage policy acceptance (offline, mock providers).
# Permanent deletion needs a private, versioned bucket whose noncurrent generations can be hard-deleted:
# soft-delete retention 0, no retention policy or default event-based hold, EU region, and CORS that permits
# size-constrained signed PUT uploads.

mock_provider "google" {}

variables {
  project_id                        = "everlast-test"
  environment                       = "dev"
  region                            = "europe-west4"
  api_service_account_email         = "api@everlast-test.iam.gserviceaccount.com"
  worker_service_account_email      = "worker@everlast-test.iam.gserviceaccount.com"
  ci_deployer_service_account_email = "ci@everlast-test.iam.gserviceaccount.com"
  cors_allowed_origins              = ["https://app.example.test"]
  force_destroy_bucket              = false
  labels                            = { app = "everlast-lm" }
}

run "workspace_bucket_permits_permanent_purge" {
  command = plan

  assert {
    condition     = google_storage_bucket.workspace.versioning[0].enabled == true
    error_message = "Object versioning must stay enabled (architecture)."
  }
  assert {
    condition     = length(google_storage_bucket.workspace.soft_delete_policy) == 1 && google_storage_bucket.workspace.soft_delete_policy[0].retention_duration_seconds == 0
    error_message = "Soft-delete retention must be 0 so purged generations are not recoverable (FR-WM-01)."
  }
  assert {
    condition     = length(google_storage_bucket.workspace.retention_policy) == 0
    error_message = "No bucket retention policy may block permanent deletion (FR-WM-01)."
  }
  assert {
    condition     = google_storage_bucket.workspace.default_event_based_hold != true
    error_message = "Default event-based holds would block purge (FR-WM-01)."
  }
}

run "workspace_bucket_is_private_and_in_region" {
  command = plan

  assert {
    condition     = google_storage_bucket.workspace.public_access_prevention == "enforced" && google_storage_bucket.workspace.uniform_bucket_level_access == true
    error_message = "Application content buckets must be private with uniform access (NFR-SEC-01)."
  }
  assert {
    condition     = google_storage_bucket.workspace.location == "EUROPE-WEST4"
    error_message = "Storage must default to europe-west4 (D3)."
  }
}

run "signed_uploads_are_browser_compatible" {
  command = plan

  assert {
    condition     = contains(google_storage_bucket.workspace.cors[0].method, "PUT")
    error_message = "CORS must allow PUT for signed uploads (FR-SI-01)."
  }
  assert {
    condition     = contains(google_storage_bucket.workspace.cors[0].response_header, "x-goog-content-length-range")
    error_message = "CORS must allow the x-goog-content-length-range header that bounds upload size (FR-WM-07)."
  }
}

run "least_privilege_object_access" {
  command = plan

  assert {
    condition     = google_storage_bucket_iam_member.api_object_user.role == "roles/storage.objectUser" && google_storage_bucket_iam_member.worker_object_user.role == "roles/storage.objectUser"
    error_message = "Only bucket-scoped object roles are granted (NFR-SEC-01)."
  }
}
