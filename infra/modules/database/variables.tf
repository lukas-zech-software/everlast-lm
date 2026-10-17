variable "project_id" {
  description = "Google Cloud project ID."
  type        = string
}

variable "environment" {
  description = "Deployment environment name (e.g. dev, staging, prod)."
  type        = string
}

variable "region" {
  description = "EU Google Cloud region for the Cloud SQL instance (e.g. europe-west4 per D3)."
  type        = string
}

variable "tier" {
  description = <<-EOT
    Cloud SQL machine tier. Architecture §4.1 requires starting on the smallest
    dedicated-core tier (db-custom-1-3840) because shared-core tiers lack RAM for HNSW pgvector indexes.
  EOT
  type        = string
  default     = "db-custom-1-3840"
}

variable "availability_type" {
  description = "ZONAL for dev/staging cost efficiency, REGIONAL for multi-zone HA."
  type        = string
  default     = "ZONAL"

  validation {
    condition     = contains(["ZONAL", "REGIONAL"], var.availability_type)
    error_message = "availability_type must be ZONAL or REGIONAL."
  }
}

variable "disk_size_gb" {
  description = "Initial SSD storage size in GB (autoresize is enabled)."
  type        = number
  default     = 20
}

variable "deletion_protection" {
  description = "Whether to enable OpenTofu and Cloud SQL deletion protection."
  type        = bool
  default     = false
}

variable "activation_policy" {
  description = "ALWAYS while active, or NEVER to stop the instance between demo sessions (D4 §5.4 cost optimization)."
  type        = string
  default     = "ALWAYS"

  validation {
    condition     = contains(["ALWAYS", "NEVER"], var.activation_policy)
    error_message = "activation_policy must be ALWAYS or NEVER."
  }
}

variable "api_service_account_email" {
  description = "Service account email of everlast-api for IAM DB authentication."
  type        = string
}

variable "worker_service_account_email" {
  description = "Service account email of everlast-worker for IAM DB authentication."
  type        = string
}

variable "labels" {
  description = "Common resource labels."
  type        = map(string)
  default     = {}
}
