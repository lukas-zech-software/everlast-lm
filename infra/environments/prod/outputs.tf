output "required_apis" {
  description = "Google Cloud APIs required by Everlast LM v1.0."
  value       = module.v1_foundation.required_apis
}

output "api_service_uri" {
  description = "Public HTTPS URL of everlast-api."
  value       = module.v1_foundation.api_service_uri
}

output "worker_service_uri" {
  description = "Internal HTTPS URL of everlast-worker."
  value       = module.v1_foundation.worker_service_uri
}

output "cloud_sql_connection_name" {
  description = "Cloud SQL PostgreSQL 16 connection name."
  value       = module.v1_foundation.cloud_sql_connection_name
}

output "workspace_bucket_name" {
  description = "Cloud Storage bucket name for uploads, normalized text, and Studio artifacts."
  value       = module.v1_foundation.workspace_bucket_name
}

output "artifact_registry_url" {
  description = "Docker Artifact Registry URL for Cloud Run images."
  value       = module.v1_foundation.artifact_registry_url
}

output "document_ai_layout_processor_name" {
  description = "Document AI Layout Parser processor resource name."
  value       = module.v1_foundation.document_ai_layout_processor_name
}

output "ingestion_queue_name" {
  description = "Cloud Tasks queue name for ingestion jobs."
  value       = module.v1_foundation.ingestion_queue_name
}

output "studio_queue_name" {
  description = "Cloud Tasks queue name for Studio generator jobs."
  value       = module.v1_foundation.studio_queue_name
}

output "service_accounts" {
  description = "Service account emails created for Everlast LM."
  value       = module.v1_foundation.service_accounts
}

output "workload_identity_provider_name" {
  description = "GitHub Actions Workload Identity Provider resource name (when enabled)."
  value       = module.v1_foundation.workload_identity_provider_name
}
