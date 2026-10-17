output "workspace_bucket_name" {
  description = "Name of the Cloud Storage bucket for raw uploads, normalized text, and Studio artifacts."
  value       = google_storage_bucket.workspace.name
}

output "workspace_bucket_url" {
  description = "gs:// URL of the workspace Cloud Storage bucket."
  value       = google_storage_bucket.workspace.url
}

output "artifact_registry_repository_id" {
  description = "Repository ID of the Docker Artifact Registry."
  value       = google_artifact_registry_repository.containers.repository_id
}

output "artifact_registry_url" {
  description = "Base Docker registry URL for Cloud Run images."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.containers.repository_id}"
}

output "secret_ids" {
  description = "Map of logical secret keys to Secret Manager secret_ids."
  value       = { for k, s in google_secret_manager_secret.secrets : k => s.secret_id }
}

output "document_ai_layout_processor_name" {
  description = "Full resource name of the Document AI Layout Parser processor (FR-SI-01 Subset A)."
  value       = google_document_ai_processor.layout_parser.name
}
