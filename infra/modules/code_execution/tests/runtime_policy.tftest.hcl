# [010-code-execution-sandbox] T010 — FR-GC-08 managed sandbox wiring policy (offline, mock provider; NFR-SEC-01/02,
# D3, D18, D19, D20). The parent Agent Platform runtime carries no deployed agent code; the API identity alone calls
# it with keyless ADC; no secret reaches the API environment through this module; default 2 vCPU / 1.5 GB profile.

mock_provider "google" {}

variables {
  project_id                = "everlast-test"
  environment               = "dev"
  region                    = "europe-west4"
  api_service_account_email = "api@everlast-test.iam.gserviceaccount.com"
  enable                    = true
  reasoning_engine_name     = "projects/everlast-test/locations/europe-west4/reasoningEngines/1234567890"
}

run "disabled_by_default_wires_nothing" {
  command = plan

  variables {
    enable                = false
    reasoning_engine_name = ""
  }

  assert {
    condition     = length(output.api_env_vars) == 0
    error_message = "The sandbox stays off until the owner approves it (default-off flag)."
  }
}

run "enabled_wires_only_public_identifiers" {
  command = plan

  assert {
    condition     = output.api_env_vars["CODE_EXECUTION_REASONING_ENGINE"] == "projects/everlast-test/locations/europe-west4/reasoningEngines/1234567890"
    error_message = "The API must receive the parent runtime resource name."
  }
  assert {
    condition     = output.api_env_vars["CODE_EXECUTION_LOCATION"] == "europe-west4"
    error_message = "Execution must stay in europe-west4 (D3)."
  }
  assert {
    condition     = alltrue([for k, v in output.api_env_vars : !can(regex("(?i)(secret|token|key|password|credential)", k))])
    error_message = "No secret or credential may be injected through the sandbox wiring (NFR-SEC-02)."
  }
  assert {
    condition     = output.sandbox_profile.vcpu == 2 && output.sandbox_profile.memory_gb == 1.5 && output.sandbox_profile.machine_config == "default"
    error_message = "Only the managed default 2 vCPU / 1.5 GB profile is approved (D18); 4 vCPU / 4 GB is not."
  }
  assert {
    condition     = output.sandbox_profile.network == "none" && output.sandbox_profile.deadline_seconds == 15
    error_message = "No network and the 15 s application deadline are fixed (D20)."
  }
  assert {
    condition     = output.parent_runtime_has_agent_code == false
    error_message = "The parent runtime must not deploy agent code (D18)."
  }
}

run "non_eu_runtime_is_rejected" {
  command = plan

  variables {
    reasoning_engine_name = "projects/everlast-test/locations/us-central1/reasoningEngines/1"
  }

  expect_failures = [var.reasoning_engine_name]
}

run "enabled_without_runtime_is_rejected" {
  command = plan

  variables {
    reasoning_engine_name = ""
  }

  expect_failures = [check.enabled_requires_runtime]
}
