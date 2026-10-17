output "instance_name" {
  description = "Name of the Cloud SQL for PostgreSQL 16 instance."
  value       = google_sql_database_instance.postgres.name
}

output "connection_name" {
  description = "Cloud SQL Connector connection string (project:region:instance)."
  value       = google_sql_database_instance.postgres.connection_name
}

output "database_name" {
  description = "Name of the primary application database."
  value       = google_sql_database.everlast.name
}

output "api_db_iam_username" {
  description = "PostgreSQL IAM username for everlast-api."
  value       = google_sql_user.api_iam_user.name
}

output "worker_db_iam_username" {
  description = "PostgreSQL IAM username for everlast-worker."
  value       = google_sql_user.worker_iam_user.name
}
