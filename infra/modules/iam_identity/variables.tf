variable "project_id" {
  description = "Google Cloud project ID."
  type        = string
}

variable "environment" {
  description = "Deployment environment name (e.g. dev, staging, prod)."
  type        = string
}

variable "region" {
  description = "Default Google Cloud region (must be EU, e.g. europe-west4 per D3)."
  type        = string
}

variable "github_repository" {
  description = "GitHub repository in owner/repo format allowed to authenticate via Workload Identity Federation (e.g. lukas-zech-software/everlast-lm)."
  type        = string
  default     = "lukas-zech-software/everlast-lm"
}

variable "enable_github_wif" {
  description = "Whether to provision the GitHub Actions Workload Identity Pool and OIDC Provider in this environment."
  type        = bool
  default     = false
}

variable "enable_identity_platform" {
  description = "Whether to manage the Identity Platform project configuration (D6, NFR-SEC-02)."
  type        = bool
  default     = true
}

variable "authorized_domains" {
  description = "List of authorized domains for Identity Platform OIDC/SAML callbacks."
  type        = list(string)
  default     = ["localhost"]
}

variable "enable_model_armor" {
  description = "Whether to grant Model Armor user permissions to API and worker service accounts."
  type        = bool
  default     = false
}

variable "enable_email_password_sign_in" {
  description = "Enable Identity Platform email/password sign-in (dev PoC only; D6 keeps OIDC/SAML for staging/prod)."
  type        = bool
  default     = false
}

variable "enable_google_sign_in" {
  description = "Enable Google as an Identity Platform sign-in provider (dev PoC, owner decision 2026-10-22; D6 keeps OIDC/SAML for staging/prod)."
  type        = bool
  default     = false
}

variable "google_oauth_client_id" {
  description = "OAuth 2.0 web client ID (Google Auth Platform) for the Google sign-in provider."
  type        = string
  default     = ""
}

variable "google_oauth_client_secret" {
  description = "OAuth 2.0 web client secret for the Google sign-in provider. Set only in the gitignored tfvars."
  type        = string
  default     = ""
  sensitive   = true
}
