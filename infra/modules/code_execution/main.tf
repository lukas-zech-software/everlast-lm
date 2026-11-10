# FR-GC-08 managed code-execution sandbox wiring (specs/010 T011; D18, D19, D20, NFR-SEC-01/02).
#
# Agent Engine Code Execution needs one bare parent runtime; each attempt creates/destroys its own child sandbox.
# Google provider 8.10 supports the typed parent resource. Creation is optional, owner-gated and mutually exclusive
# with a supplied existing runtime name. No deployed agent code, service account, IAM grant or machine override.
# The API already holds roles/aiplatform.user and calls the child sandbox service with keyless ADC.

resource "google_vertex_ai_reasoning_engine" "parent" {
  count           = var.enable && var.create_parent_runtime ? 1 : 0
  project         = var.project_id
  region          = var.region
  display_name    = "everlast-${var.environment}-code-execution"
  description     = "Bare parent for isolated FR-GC-08 child sandbox attempts; no deployed agent code."
  labels          = var.labels
  deletion_policy = var.deletion_protection ? "PREVENT" : "DELETE"
  # Omit spec/context_spec: no agent framework, package, container or deployed workload belongs on this parent.
}

locals {
  enabled = var.enable && (var.create_parent_runtime || var.reasoning_engine_name != "")
  reasoning_engine_name = var.enable && var.create_parent_runtime ? (
    google_vertex_ai_reasoning_engine.parent[0].name
  ) : var.reasoning_engine_name

  api_env_vars = local.enabled ? {
    CODE_EXECUTION_ENABLED          = "true"
    CODE_EXECUTION_REASONING_ENGINE = local.reasoning_engine_name
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
