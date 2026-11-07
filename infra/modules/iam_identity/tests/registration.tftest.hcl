# [001-workspace-foundation] T058 — FR-WM-04, NFR-SEC-02, D21/DEV-06.
mock_provider "google" {
  mock_resource "google_service_account" {
    defaults = {
      name  = "projects/everlast-disposable-test/serviceAccounts/fixture@everlast-disposable-test.iam.gserviceaccount.com"
      email = "fixture@everlast-disposable-test.iam.gserviceaccount.com"
    }
  }
}
variables {
  project_id                    = "everlast-disposable-test"
  environment                   = "dev"
  region                        = "europe-west4"
  enable_identity_platform      = true
  enable_email_password_sign_in = true
}
run "admin_only_preserves_existing_signin" {
  command = plan
  assert {
    condition     = try(google_identity_platform_config.auth[0].client[0].permissions[0].disabled_user_signup == true, false)
    error_message = "Client signup must be denied by Identity Platform, including direct API requests."
  }
  assert {
    condition     = google_identity_platform_config.auth[0].sign_in[0].email[0].enabled && google_identity_platform_config.auth[0].sign_in[0].email[0].password_required
    error_message = "Existing email/password users must retain sign-in."
  }
}
run "disabled_identity_does_not_create_configuration" {
  command = plan
  variables { enable_identity_platform = false }
  assert {
    condition     = length(google_identity_platform_config.auth) == 0
    error_message = "An unmanaged Identity Platform config must stay unmanaged."
  }
}
