output "api_service_name" {
  description = "Name of the everlast-api Cloud Run service."
  value       = google_cloud_run_v2_service.api.name
}

output "api_service_uri" {
  description = "Public HTTPS URI of the everlast-api Cloud Run service."
  value       = google_cloud_run_v2_service.api.uri
}

output "worker_service_name" {
  description = "Name of the everlast-worker Cloud Run service."
  value       = google_cloud_run_v2_service.worker.name
}

output "worker_service_uri" {
  description = "Internal HTTPS URI of the everlast-worker Cloud Run service."
  value       = google_cloud_run_v2_service.worker.uri
}

output "render_job_name" {
  description = "Name of the everlast-render Cloud Run Job (empty when not deployed)."
  value       = try(google_cloud_run_v2_job.render[0].name, "")
}
