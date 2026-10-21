module "v1_foundation" {
  source = "../../stacks/v1_foundation"

  project_id               = var.project_id
  environment              = "dev"
  region                   = var.region
  tasks_location           = var.tasks_location
  enable_project_services  = var.enable_project_services
  enable_model_armor       = var.enable_model_armor
  enable_identity_platform = var.enable_identity_platform
  enable_github_wif        = var.enable_github_wif
  github_repository        = var.github_repository
  authorized_domains       = var.authorized_domains
  cors_allowed_origins     = var.cors_allowed_origins
  db_tier                  = var.db_tier
  db_availability_type     = var.db_availability_type
  db_disk_size_gb          = var.db_disk_size_gb
  db_activation_policy     = var.db_activation_policy
  api_image                = var.api_image
  worker_image             = var.worker_image
  api_min_instances        = var.api_min_instances
  api_max_instances        = var.api_max_instances
  worker_max_instances     = var.worker_max_instances
  mount_secrets            = var.mount_secrets
  max_sources_per_notebook = var.max_sources_per_notebook
  max_notebooks_per_user   = var.max_notebooks_per_user
  deletion_protection      = var.deletion_protection

  enable_email_password_sign_in = var.enable_email_password_sign_in
}
