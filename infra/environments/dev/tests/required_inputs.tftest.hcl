# Grill F1 — NFR-SEC-01, D4. Mocked plans only: no credentials, provider calls or infrastructure changes.
mock_provider "google" {
  mock_resource "google_service_account" {
    defaults = {
      email = "runtime@everlast-test.iam.gserviceaccount.com"
      name  = "projects/everlast-test/serviceAccounts/runtime@everlast-test.iam.gserviceaccount.com"
    }
  }
}
mock_provider "google-beta" {}

# F1 / NFR-SEC-01 / D4: dev plans need the real tfvars; the Cloud Run hello placeholder is never deployable.
variables {
  project_id              = "everlast-test"
  api_image               = "europe-west4-docker.pkg.dev/everlast-test/everlast/everlast:test"
  worker_image            = "europe-west4-docker.pkg.dev/everlast-test/everlast/everlast:test"
  mount_secrets           = true
  authorized_domains      = ["everlast-test.web.app"]
  cors_allowed_origins    = ["https://everlast-test.web.app"]
  enable_project_services = false
}

run "real_inputs_plan" {
  command = plan
}

run "placeholder_api_image_is_rejected" {
  command = plan
  variables { api_image = "us-docker.pkg.dev/cloudrun/container/hello" }
  expect_failures = [var.api_image]
}

run "placeholder_worker_image_is_rejected" {
  command = plan
  variables { worker_image = "us-docker.pkg.dev/cloudrun/container/hello:latest" }
  expect_failures = [var.worker_image]
}

# Final review I1: a verbatim copy of opentofu.auto.tfvars.example must not plan.
run "example_placeholder_image_is_rejected" {
  command = plan
  variables { api_image = "europe-west4-docker.pkg.dev/<project>/everlast/everlast:<tag>" }
  expect_failures = [var.api_image]
}

run "live_style_image_is_accepted" {
  command = plan
  variables {
    api_image    = "europe-west4-docker.pkg.dev/lukas-gcloud-playground/everlast-dev-containers/everlast:51f78ab"
    worker_image = "europe-west4-docker.pkg.dev/lukas-gcloud-playground/everlast-dev-containers/everlast@sha256:0000000000000000000000000000000000000000000000000000000000000000"
  }
}
