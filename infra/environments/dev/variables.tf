variable "project_id" {
  description = "Google Cloud project ID for the dev environment."
  type        = string
}

variable "region" {
  description = "EU Google Cloud region (D3: defaults to europe-west4)."
  type        = string
  default     = "europe-west4"
}

variable "tasks_location" {
  description = "EU Google Cloud region for Cloud Tasks queues (europe-west4 does not support Cloud Tasks; defaults to europe-west1)."
  type        = string
  default     = "europe-west1"
}

variable "enable_project_services" {
  description = "Explicit project-owner approval gate for enabling billable Google Cloud APIs (defaults to false)."
  type        = bool
  default     = false
}

variable "enable_model_armor" {
  description = "Whether to enable Model Armor in v1.0 (optional in v1.0, mandatory from v3.0)."
  type        = bool
  default     = false
}

variable "enable_identity_platform" {
  description = "Whether to manage Identity Platform OIDC/SAML configuration (D6, NFR-SEC-02)."
  type        = bool
  default     = true
}

variable "enable_github_wif" {
  description = "Whether to provision the GitHub Actions Workload Identity Pool and OIDC Provider."
  type        = bool
  default     = false
}

variable "github_repository" {
  description = "GitHub repository in owner/repo format for Workload Identity Federation."
  type        = string
  default     = "lukas-zech-software/everlast-lm"
}

variable "authorized_domains" {
  description = "Authorized domains for Identity Platform OIDC/SAML callbacks."
  type        = list(string)
  default     = ["localhost"]
}

variable "cors_allowed_origins" {
  description = "Allowed origins for browser direct signed-URL uploads to the workspace GCS bucket."
  type        = list(string)
  default     = ["http://localhost:5173", "http://localhost:3000"]
}

variable "db_tier" {
  description = "Cloud SQL dedicated-core machine tier (D1, D4: db-custom-1-3840 minimum for HNSW pgvector index)."
  type        = string
  default     = "db-custom-1-3840"
}

variable "db_availability_type" {
  description = "Cloud SQL availability type (ZONAL for dev/demo cost optimization)."
  type        = string
  default     = "ZONAL"
}

variable "db_disk_size_gb" {
  description = "Cloud SQL initial SSD disk size in GB."
  type        = number
  default     = 20
}

variable "db_activation_policy" {
  description = "Cloud SQL activation policy (ALWAYS while active, NEVER to pause between demo sessions per §5.4)."
  type        = string
  default     = "ALWAYS"
}

variable "api_image" {
  description = "Container image URI for everlast-api."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "worker_image" {
  description = "Container image URI for everlast-worker."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "api_min_instances" {
  description = "Minimum instances for everlast-api (0 for scale-to-zero per D4; 1 during live demos per §5.5)."
  type        = number
  default     = 0
}

variable "api_max_instances" {
  description = "Maximum instances for everlast-api. 1 while release v2 data lives in API memory (D16 proof of concept)."
  type        = number
  default     = 1
}

variable "worker_max_instances" {
  description = "Maximum instances for everlast-worker."
  type        = number
  default     = 5
}

variable "mount_secrets" {
  description = "Whether Secret Manager secret versions have been populated and should be mounted into Cloud Run."
  type        = bool
  default     = false
}

variable "max_sources_per_notebook" {
  description = "Configurable N_max sources per notebook (FR-WM-07: 50 in v1 baseline, up to 300)."
  type        = number
  default     = 50
}

variable "max_notebooks_per_user" {
  description = "Configurable max notebooks per user (FR-WM-07: 100 in v1 baseline)."
  type        = number
  default     = 100
}

variable "deletion_protection" {
  description = "Whether to enable deletion protection on Cloud SQL, Cloud Run, and GCS."
  type        = bool
  default     = false
}
