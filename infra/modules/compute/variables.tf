variable "project_id" {
  description = "Google Cloud project ID."
  type        = string
}

variable "environment" {
  description = "Deployment environment name (e.g. dev, staging, prod)."
  type        = string
}

variable "region" {
  description = "EU Google Cloud region for Cloud Run services (e.g. europe-west4 per D3)."
  type        = string
}

variable "api_image" {
  description = "Container image URI for everlast-api (serves SPA static assets + BFF + ADK Chat Agent)."
  type        = string
}

variable "worker_image" {
  description = "Container image URI for everlast-worker (Ingestion + Source Guide + Studio plugins)."
  type        = string
}

variable "api_service_account_email" {
  description = "Runtime service account email for everlast-api."
  type        = string
}

variable "worker_service_account_email" {
  description = "Runtime service account email for everlast-worker."
  type        = string
}

variable "tasks_invoker_service_account_email" {
  description = "Service account email used by Cloud Tasks OIDC push to invoke everlast-worker."
  type        = string
}

variable "sql_connection_name" {
  description = "Cloud SQL Connector connection name (project:region:instance)."
  type        = string
}

variable "database_name" {
  description = "PostgreSQL database name."
  type        = string
}

variable "api_db_iam_username" {
  description = "Cloud SQL IAM database username for everlast-api."
  type        = string
}

variable "worker_db_iam_username" {
  description = "Cloud SQL IAM database username for everlast-worker."
  type        = string
}

variable "workspace_bucket_name" {
  description = "Cloud Storage bucket name for uploads, normalized text, and Studio artifacts."
  type        = string
}

variable "ingestion_queue_name" {
  description = "Cloud Tasks queue name for ingestion jobs."
  type        = string
}

variable "studio_queue_name" {
  description = "Cloud Tasks queue name for Studio generator jobs."
  type        = string
}

variable "document_ai_layout_processor_name" {
  description = "Full resource name of the Document AI Layout Parser processor (FR-SI-01 Subset A)."
  type        = string
}

variable "secret_ids" {
  description = "Map of logical secret keys to Secret Manager secret IDs."
  type        = map(string)
}

variable "mount_secrets" {
  description = "Whether Secret Manager secret versions have been populated and should be mounted into Cloud Run."
  type        = bool
  default     = false
}

variable "api_min_instances" {
  description = "Minimum instances for everlast-api (0 for scale-to-zero per D4; set to 1 only during live demos per §5.5)."
  type        = number
  default     = 0
}

variable "api_max_instances" {
  description = "Maximum instances for everlast-api."
  type        = number
  default     = 10
}

variable "worker_max_instances" {
  description = "Maximum instances for everlast-worker."
  type        = number
  default     = 10
}

variable "allow_public_api_ingress" {
  description = "Whether to grant roles/run.invoker to allUsers on everlast-api (application layer validates OIDC/SAML tokens per NFR-SEC-02)."
  type        = bool
  default     = true
}

variable "max_sources_per_notebook" {
  description = "Configurable N_max quota per notebook (FR-WM-07: 50 in v1 baseline, up to 300)."
  type        = number
  default     = 50

  validation {
    condition     = var.max_sources_per_notebook >= 50 && var.max_sources_per_notebook <= 300
    error_message = "max_sources_per_notebook must be between 50 and 300 (FR-WM-07)."
  }
}

variable "max_notebooks_per_user" {
  description = "Configurable max notebooks per user (FR-WM-07: 100 in v1 baseline, up to 500 in v6)."
  type        = number
  default     = 100
}

variable "deletion_protection" {
  description = "Whether to enable Cloud Run deletion protection."
  type        = bool
  default     = false
}

variable "labels" {
  description = "Common resource labels."
  type        = map(string)
  default     = {}
}
