output "required_apis" {
  description = "Complete list of Google Cloud APIs required for Everlast LM v1.0."
  value       = sort(tolist(local.required_apis))
}

output "enabled_apis" {
  description = "APIs actively managed by google_project_service when enable_project_services = true."
  value       = [for s in google_project_service.v1_apis : s.service]
}
