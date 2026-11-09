variable "project_id" {
  description = "Google Cloud project ID."
  type        = string
}

variable "environment" {
  description = "Deployment environment name (dev, staging, prod)."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "region" {
  description = "EU Google Cloud region (D3: defaults to europe-west4)."
  type        = string
  default     = "europe-west4"

  validation {
    condition     = startswith(var.region, "europe-")
    error_message = "Data residency (D3 & Constitution Principle VI) requires an EU region starting with 'europe-' (default: europe-west4)."
  }
}

variable "enable_v3_ingestion" {
  description = "Owner-approval gate for v3 ingestion APIs and worker wiring (Speech V2, Drive, YouTube; FR-SI-01 Subset B)."
  type        = bool
  default     = false
}

variable "create_model_armor_template" {
  description = "Default-off proposal to manage the EU prompt-injection/jailbreak screening template; requires ingestion enablement and excludes an existing template ID (FR-SI-01/05)."
  type        = bool
  default     = false
}

variable "model_armor_template_id" {
  description = "Existing Model Armor local template ID (not a full resource path); mutually exclusive with create_model_armor_template (FR-SI-01/05)."
  type        = string
  default     = ""

  validation {
    condition     = !strcontains(var.model_armor_template_id, "/") && trimspace(var.model_armor_template_id) == var.model_armor_template_id
    error_message = "model_armor_template_id must be a local template ID, not a full resource path or padded value."
  }
}

variable "deletion_protection" {
  description = "Whether to enable deletion protection on Cloud SQL, Cloud Run, and GCS."
  type        = bool
  default     = false
}

variable "labels" {
  description = "Non-sensitive resource labels (FR-SI-01/05)."
  type        = map(string)
  default     = {}
}
