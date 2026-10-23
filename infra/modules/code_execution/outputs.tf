output "api_env_vars" {
  description = "Public (non-secret) sandbox identifiers merged into the everlast-api environment."
  value       = local.api_env_vars
}

output "sandbox_profile" {
  description = "Approved managed sandbox envelope (D18/D20); asserted by tests, enforced by the API."
  value       = local.sandbox_profile
}

output "parent_runtime_has_agent_code" {
  description = "The parent runtime never carries deployed agent code (D18)."
  value       = false
}
