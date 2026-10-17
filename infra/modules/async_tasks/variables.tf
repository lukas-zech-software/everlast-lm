variable "project_id" {
  description = "Google Cloud project ID."
  type        = string
}

variable "environment" {
  description = "Deployment environment name (e.g. dev, staging, prod)."
  type        = string
}

variable "region" {
  description = "EU Google Cloud region for Cloud Tasks queues (e.g. europe-west4 per D3)."
  type        = string
}

variable "max_dispatches_per_second" {
  description = "Maximum task dispatch rate per second (protects Gemini model quota and caps spend per §4.1 & §5.4)."
  type        = number
  default     = 5
}

variable "max_concurrent_dispatches" {
  description = "Maximum concurrent task executions on everlast-worker."
  type        = number
  default     = 10
}
