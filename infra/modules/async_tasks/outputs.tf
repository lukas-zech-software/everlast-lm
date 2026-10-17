output "ingestion_queue_name" {
  description = "Short name of the ingestion Cloud Tasks queue."
  value       = google_cloud_tasks_queue.ingestion.name
}

output "ingestion_queue_id" {
  description = "Full resource ID of the ingestion Cloud Tasks queue."
  value       = google_cloud_tasks_queue.ingestion.id
}

output "studio_queue_name" {
  description = "Short name of the Studio jobs Cloud Tasks queue (C-03)."
  value       = google_cloud_tasks_queue.studio.name
}

output "studio_queue_id" {
  description = "Full resource ID of the Studio jobs Cloud Tasks queue."
  value       = google_cloud_tasks_queue.studio.id
}
