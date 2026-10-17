variable "project_id" {
  description = "Google Cloud project ID hosting Everlast LM resources."
  type        = string
}

variable "enable_project_services" {
  description = <<-EOT
    Explicit project-owner approval gate for enabling billable Google Cloud APIs
    (Constitution Platform Constraints & gcloud skill guardrail). Defaults to false
    so APIs are assumed already enabled unless explicitly approved.
  EOT
  type        = bool
  default     = false
}

variable "enable_model_armor" {
  description = "Whether to include the Model Armor API (optional in v1.0, mandatory from v3.0 per FR-SI-01/05 and Constitution VI)."
  type        = bool
  default     = false
}

variable "disable_on_destroy" {
  description = "Whether to disable APIs when the Terraform resource is destroyed."
  type        = bool
  default     = false
}
