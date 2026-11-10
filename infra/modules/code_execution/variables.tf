# Traceability: FR-GC-08, NFR-SEC-01/02, D3, D18, D19, D20 (specs/010-code-execution-sandbox T011)

variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev/staging/prod)."
  type        = string
}

variable "region" {
  description = "Execution region; only europe-west4 is approved (D3)."
  type        = string
  default     = "europe-west4"

  validation {
    condition     = var.region == "europe-west4"
    error_message = "Agent Platform Code Execution must run in europe-west4 (D3); no region exception is approved."
  }
}

variable "api_service_account_email" {
  description = "everlast-api runtime identity; the only caller of the sandbox API (keyless ADC)."
  type        = string
}

variable "enable" {
  description = "Owner-approval gate for the FR-GC-08 managed sandbox (default off)."
  type        = bool
  default     = false
}

variable "reasoning_engine_name" {
  description = "Existing bare Agent Engine parent resource name; mutually exclusive with create_parent_runtime."
  type        = string
  default     = ""

  validation {
    condition     = var.reasoning_engine_name == "" || can(regex("^projects/[a-z0-9-]+/locations/europe-west4/reasoningEngines/[0-9]+$", var.reasoning_engine_name))
    error_message = "reasoning_engine_name must be projects/<project>/locations/europe-west4/reasoningEngines/<id> (D3)."
  }
}

# [010-code-execution-sandbox] T054 — FR-GC-08, D18–D20: default-off managed parent proposal.
variable "create_parent_runtime" {
  description = "Default-off managed bare parent proposal; requires enable and excludes reasoning_engine_name."
  type        = bool
  default     = false
}

variable "deletion_protection" {
  description = "Protect the managed parent against deletion using the existing stack policy (FR-GC-08)."
  type        = bool
  default     = true
}

variable "labels" {
  description = "Existing non-sensitive stack labels applied to the optional parent (FR-GC-08)."
  type        = map(string)
  default     = {}
}
