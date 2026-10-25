# FR-GC-08 managed code-execution sandbox wiring (specs/010 T011; D18, D19, D20, NFR-SEC-01/02).
#
# Google's Agent Platform (Agent Engine) Code Execution needs one parent runtime (reasoningEngines/<id>) WITHOUT
# deployed agent code; every attempt creates and deletes its own child sandbox through the API's runtime identity.
# The pinned hashicorp/google ~> 6.0 provider has no reasoning-engine resource, so the parent runtime is created once
# by the owner (infra/README.md) and passed in by name; switching to a provider resource is a later IaC change.
# The API service account already holds roles/aiplatform.user (iam_identity), which covers sandbox create/execute/
# delete; no new role, key or secret is added here. Nothing is created while `enable` is false.

locals {
  enabled = var.enable && var.reasoning_engine_name != ""

  api_env_vars = local.enabled ? {
    CODE_EXECUTION_ENABLED          = "true"
    CODE_EXECUTION_REASONING_ENGINE = var.reasoning_engine_name
    CODE_EXECUTION_LOCATION         = var.region
  } : {}

  # D18/D20: the managed default profile is selected by leaving machineConfig unset; the API verifies it.
  sandbox_profile = {
    vcpu             = 2
    memory_gb        = 1.5
    machine_config   = "default"
    network          = "none"
    file_io_mb       = 100
    deadline_seconds = 15
  }
}

check "enabled_requires_runtime" {
  assert {
    condition     = !var.enable || var.reasoning_engine_name != ""
    error_message = "enable=true needs reasoning_engine_name (the owner-created parent runtime)."
  }
}
