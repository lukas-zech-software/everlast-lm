# [010-code-execution-sandbox] T053 — FR-GC-08, NFR-SEC-01/02, D18–D20, CC-02/08.
# Mocked plans only: no credentials, cloud API calls, state backend or resource apply.
mock_provider "google" {
  mock_resource "google_service_account" {
    defaults = {
      email = "runtime@everlast-test.iam.gserviceaccount.com"
      name  = "projects/everlast-test/serviceAccounts/runtime@everlast-test.iam.gserviceaccount.com"
    }
  }
  mock_resource "google_vertex_ai_reasoning_engine" {
    defaults = {
      name = "projects/everlast-test/locations/europe-west4/reasoningEngines/9876543210"
    }
  }
}
mock_provider "google-beta" {}

variables {
  project_id = "everlast-test"
}

run "disabled_defaults" {
  command = plan
}

run "existing_runtime" {
  command = plan
  variables {
    enable_v3_code_execution        = true
    code_execution_reasoning_engine = "projects/everlast-test/locations/europe-west4/reasoningEngines/1234567890"
  }
}

run "managed_bare_parent" {
  command = plan
  variables {
    enable_v3_code_execution             = true
    create_code_execution_parent_runtime = true
  }
}

run "managed_and_existing_are_mutually_exclusive" {
  command = plan
  module {
    source = "../../modules/code_execution"
  }
  variables {
    environment               = "dev"
    api_service_account_email = "api@everlast-test.iam.gserviceaccount.com"
    enable                    = true
    create_parent_runtime     = true
    reasoning_engine_name     = "projects/everlast-test/locations/europe-west4/reasoningEngines/1234567890"
  }
  expect_failures = [output.api_env_vars]
}

run "managed_creation_requires_enablement" {
  command = plan
  module {
    source = "../../modules/code_execution"
  }
  variables {
    environment               = "dev"
    api_service_account_email = "api@everlast-test.iam.gserviceaccount.com"
    create_parent_runtime     = true
  }
  expect_failures = [output.api_env_vars]
}

run "managed_parent_stays_in_approved_region" {
  command = plan
  module {
    source = "../../modules/code_execution"
  }
  variables {
    environment               = "dev"
    api_service_account_email = "api@everlast-test.iam.gserviceaccount.com"
    region                    = "us-central1"
    enable                    = true
    create_parent_runtime     = true
  }
  expect_failures = [var.region]
}

run "enabled_without_parent_mode_is_rejected" {
  command = plan
  module {
    source = "../../modules/code_execution"
  }
  variables {
    environment               = "dev"
    api_service_account_email = "api@everlast-test.iam.gserviceaccount.com"
    enable                    = true
  }
  expect_failures = [output.api_env_vars]
}
