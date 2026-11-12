output "api_env_vars" {
  description = "Public (non-secret) sandbox identifiers merged into the everlast-api environment."
  value       = local.api_env_vars

  precondition {
    condition     = !var.create_parent_runtime || var.enable
    error_message = "create_parent_runtime requires the owner-approved enable gate (FR-GC-08)."
  }
  precondition {
    condition     = !var.enable || (var.create_parent_runtime != (var.reasoning_engine_name != ""))
    error_message = "Enabled execution requires exactly one managed parent or existing reasoning_engine_name, never both."
  }
}

output "sandbox_profile" {
  description = "Approved managed sandbox envelope (D18/D20); asserted by tests, enforced by the API."
  value       = local.sandbox_profile
}

output "parent_runtime_has_agent_code" {
  description = "The parent runtime never carries deployed agent code (D18)."
  value       = false
}

output "reasoning_engine_name" {
  description = "Selected public parent name (computed for a managed parent); empty while execution is disabled."
  value       = local.enabled ? local.reasoning_engine_name : ""
}
