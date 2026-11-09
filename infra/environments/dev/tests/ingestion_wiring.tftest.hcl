# [009-multimodal-ingestion-sync] T062 — FR-SI-01/05, NFR-SEC-01/02, D3/D11.
# Mocked plans only: no credentials, provider calls, infrastructure creation or API enablement.
mock_provider "google" {
  mock_resource "google_service_account" {
    defaults = {
      email = "runtime@everlast-test.iam.gserviceaccount.com"
      name  = "projects/everlast-test/serviceAccounts/runtime@everlast-test.iam.gserviceaccount.com"
    }
  }
}
mock_provider "google-beta" {}

variables {
  project_id = "everlast-test"
}

run "disabled_defaults" {
  command = plan

  assert {
    condition     = !contains(output.required_apis, "speech.googleapis.com") && !contains(output.required_apis, "modelarmor.googleapis.com")
    error_message = "Ingestion APIs must not be selected without the owner-approved flag."
  }
}

run "approved_ingestion_settings" {
  command = plan

  variables {
    enable_project_services = true
    enable_v3_ingestion     = true
    render_image            = "europe-west4-docker.pkg.dev/everlast-test/runtime/render:fixture"
    model_armor_template_id = "ingestion-screening"
    google_oauth_client_id  = "fixture.apps.googleusercontent.com"
    google_picker_api_key   = "public-picker-fixture"
    google_picker_app_id    = "123456789012"
    drive_webhook_address   = "https://app.example.test/webhooks/google-drive"
  }

  assert {
    condition     = alltrue([for service in ["speech.googleapis.com", "drive.googleapis.com", "youtube.googleapis.com", "compute.googleapis.com", "modelarmor.googleapis.com"] : contains(output.required_apis, service)])
    error_message = "Approved v3 ingestion must reach the full project's API selection through the dev wrapper."
  }
}

run "managed_prompt_injection_template" {
  command = plan

  variables {
    enable_project_services     = true
    enable_v3_ingestion         = true
    create_model_armor_template = true
  }
}

run "managed_and_existing_are_mutually_exclusive" {
  command = plan
  module {
    source = "../../modules/ingestion_screening"
  }
  variables {
    environment                 = "dev"
    enable_v3_ingestion         = true
    create_model_armor_template = true
    model_armor_template_id     = "existing-screening"
  }
  expect_failures = [google_model_armor_template.ingestion]
}

run "managed_template_requires_ingestion" {
  command = plan
  module {
    source = "../../modules/ingestion_screening"
  }
  variables {
    environment                 = "dev"
    create_model_armor_template = true
  }
  expect_failures = [google_model_armor_template.ingestion]
}

run "managed_template_stays_in_approved_region" {
  command = plan
  module {
    source = "../../modules/ingestion_screening"
  }
  variables {
    environment                 = "dev"
    region                      = "europe-west1"
    enable_v3_ingestion         = true
    create_model_armor_template = true
  }
  expect_failures = [google_model_armor_template.ingestion]
}

run "full_template_resource_path_is_rejected" {
  command = plan
  module {
    source = "../../modules/ingestion_screening"
  }
  variables {
    environment             = "dev"
    enable_v3_ingestion     = true
    model_armor_template_id = "projects/everlast-test/locations/europe-west4/templates/existing"
  }
  expect_failures = [var.model_armor_template_id]
}
