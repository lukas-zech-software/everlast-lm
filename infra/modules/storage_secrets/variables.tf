variable "project_id" {
  description = "Google Cloud project ID."
  type        = string
}

variable "environment" {
  description = "Deployment environment name (e.g. dev, staging, prod)."
  type        = string
}

variable "region" {
  description = "EU Google Cloud region for storage and secrets (e.g. europe-west4 per D3)."
  type        = string
}

variable "api_service_account_email" {
  description = "Service account email of everlast-api."
  type        = string
}

variable "worker_service_account_email" {
  description = "Service account email of everlast-worker."
  type        = string
}

variable "ci_deployer_service_account_email" {
  description = "Service account email of the CI/CD deployer."
  type        = string
}

variable "cors_allowed_origins" {
  description = "Allowed origins for browser direct signed-URL uploads to the workspace GCS bucket."
  type        = list(string)
  default     = ["http://localhost:5173", "http://localhost:3000"]
}

variable "force_destroy_bucket" {
  description = "Whether to allow destroying the workspace bucket when non-empty (true for dev/ephemeral, false for prod)."
  type        = bool
  default     = false
}

variable "labels" {
  description = "Common resource labels."
  type        = map(string)
  default     = {}
}
