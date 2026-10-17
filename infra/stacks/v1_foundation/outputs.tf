output "required_apis" {
  description = "Google Cloud APIs required by Everlast LM v1.0."
  value       = module.project_services.required_apis
}

output "api_service_uri" {
  description = "Public HTTPS URL of everlast-api (serves SPA + BFF + ADK Chat Agent)."
  value       = module.compute.api_service_uri
}

output "worker_service_uri" {
  description = "Internal HTTPS URL of everlast-worker."
  value       = module.compute.worker_service_uri
}

output "cloud_sql_connection_name" {
  description = "Cloud SQL PostgreSQL 16 connection name."
  value       = module.database.connection_name
}

output "workspace_bucket_name" {
  description = "Cloud Storage bucket name for uploads, normalized text, and Studio artifacts."
  value       = module.storage_secrets.workspace_bucket_name
}

output "artifact_registry_url" {
  description = "Docker Artifact Registry URL for Cloud Run images."
  value       = module.storage_secrets.artifact_registry_url
}

output "document_ai_layout_processor_name" {
  description = "Document AI Layout Parser processor resource name."
  value       = module.storage_secrets.document_ai_layout_processor_name
}

output "ingestion_queue_name" {
  description = "Cloud Tasks queue name for ingestion jobs."
  value       = module.async_tasks.ingestion_queue_name
}

output "studio_queue_name" {
  description = "Cloud Tasks queue name for Studio generator jobs."
  value       = module.async_tasks.studio_queue_name
}

output "service_accounts" {
  description = "Service account emails created for Everlast LM."
  value = {
    api           = module.iam_identity.api_service_account_email
    worker        = module.iam_identity.worker_service_account_email
    tasks_invoker = module.iam_identity.tasks_invoker_service_account_email
    ci_deployer   = module.iam_identity.ci_deployer_service_account_email
  }
}

output "workload_identity_provider_name" {
  description = "GitHub Actions Workload Identity Provider resource name (when enabled)."
  value       = module.iam_identity.workload_identity_provider_name
}
