output "api_service_account_email" {
  description = "Email of the everlast-api runtime service account."
  value       = google_service_account.api.email
}

output "api_service_account_name" {
  description = "Fully-qualified resource name of the everlast-api runtime service account."
  value       = google_service_account.api.name
}

output "worker_service_account_email" {
  description = "Email of the everlast-worker runtime service account."
  value       = google_service_account.worker.email
}

output "worker_service_account_name" {
  description = "Fully-qualified resource name of the everlast-worker runtime service account."
  value       = google_service_account.worker.name
}

output "tasks_invoker_service_account_email" {
  description = "Email of the Cloud Tasks OIDC invoker service account."
  value       = google_service_account.tasks_invoker.email
}

output "ci_deployer_service_account_email" {
  description = "Email of the keyless CI/CD deployer service account."
  value       = google_service_account.ci_deployer.email
}

output "workload_identity_provider_name" {
  description = "Full resource name of the GitHub OIDC Workload Identity Provider (when enabled)."
  value       = var.enable_github_wif ? google_iam_workload_identity_pool_provider.github[0].name : null
}

output "identity_platform_api_key" {
  description = "Public Identity Platform browser API key (not a model API key; D6). Empty when Identity Platform is disabled."
  value       = try(google_identity_platform_config.auth[0].client[0].api_key, "")
  sensitive   = true
}

output "render_service_account_email" {
  description = "Email of the everlast-render job service account (specs/009)."
  value       = google_service_account.render.email
}
