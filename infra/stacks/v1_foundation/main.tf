# Everlast LM v1.0 ("Core Grounded Workspace") Infrastructure Stack
# Traceability: SRS §5.3 v1.0 (Packages 1.1–1.4), C-01, C-02, FR-WM-01, FR-WM-04, FR-WM-07,
# FR-SI-01 (Subset A), FR-SI-03, FR-SI-04, FR-GC-01..03, FR-GC-06, FR-UI-01, NFR-SEC-01,
# NFR-EVAL-01..04, and docs/solution-architecture.md (D1–D4, D6, D13, D14).

locals {
  common_labels = {
    app         = "everlast-lm"
    environment = var.environment
    release     = "v1-0"
    managed_by  = "opentofu"
  }
}

module "project_services" {
  source = "../../modules/project_services"

  project_id              = var.project_id
  enable_project_services = var.enable_project_services
  enable_model_armor      = var.enable_model_armor
}

module "iam_identity" {
  source = "../../modules/iam_identity"

  project_id               = var.project_id
  environment              = var.environment
  region                   = var.region
  enable_identity_platform = var.enable_identity_platform
  enable_github_wif        = var.enable_github_wif
  github_repository        = var.github_repository
  authorized_domains       = var.authorized_domains
  enable_model_armor       = var.enable_model_armor

  enable_email_password_sign_in = var.enable_email_password_sign_in
  enable_google_sign_in         = var.enable_google_sign_in
  google_oauth_client_id        = var.google_oauth_client_id
  google_oauth_client_secret    = var.google_oauth_client_secret

  depends_on = [module.project_services]
}

module "storage_secrets" {
  source = "../../modules/storage_secrets"

  project_id                        = var.project_id
  environment                       = var.environment
  region                            = var.region
  api_service_account_email         = module.iam_identity.api_service_account_email
  worker_service_account_email      = module.iam_identity.worker_service_account_email
  ci_deployer_service_account_email = module.iam_identity.ci_deployer_service_account_email
  cors_allowed_origins              = var.cors_allowed_origins
  force_destroy_bucket              = !var.deletion_protection
  labels                            = local.common_labels

  depends_on = [module.project_services]
}

module "database" {
  source = "../../modules/database"

  project_id                   = var.project_id
  environment                  = var.environment
  region                       = var.region
  tier                         = var.db_tier
  availability_type            = var.db_availability_type
  disk_size_gb                 = var.db_disk_size_gb
  activation_policy            = var.db_activation_policy
  deletion_protection          = var.deletion_protection
  api_service_account_email    = module.iam_identity.api_service_account_email
  worker_service_account_email = module.iam_identity.worker_service_account_email
  labels                       = local.common_labels

  depends_on = [module.project_services]
}

module "async_tasks" {
  source = "../../modules/async_tasks"

  project_id  = var.project_id
  environment = var.environment
  region      = var.tasks_location

  depends_on = [module.project_services]
}

module "compute" {
  source = "../../modules/compute"

  project_id                          = var.project_id
  environment                         = var.environment
  region                              = var.region
  api_image                           = var.api_image
  worker_image                        = var.worker_image
  api_service_account_email           = module.iam_identity.api_service_account_email
  worker_service_account_email        = module.iam_identity.worker_service_account_email
  tasks_invoker_service_account_email = module.iam_identity.tasks_invoker_service_account_email
  sql_connection_name                 = module.database.connection_name
  database_name                       = module.database.database_name
  api_db_iam_username                 = module.database.api_db_iam_username
  worker_db_iam_username              = module.database.worker_db_iam_username
  workspace_bucket_name               = module.storage_secrets.workspace_bucket_name
  ingestion_queue_name                = module.async_tasks.ingestion_queue_name
  tasks_location                      = var.tasks_location
  studio_queue_name                   = module.async_tasks.studio_queue_name
  document_ai_layout_processor_name   = module.storage_secrets.document_ai_layout_processor_name
  secret_ids                          = module.storage_secrets.secret_ids
  identity_platform_api_key           = module.iam_identity.identity_platform_api_key
  identity_platform_provider_id       = var.enable_google_sign_in || var.enable_email_password_sign_in ? join(",", compact([var.enable_google_sign_in ? "google.com" : "", var.enable_email_password_sign_in ? "password" : ""])) : var.identity_platform_provider_id
  mount_secrets                       = var.mount_secrets
  api_min_instances                   = var.api_min_instances
  api_max_instances                   = var.api_max_instances
  worker_max_instances                = var.worker_max_instances
  max_sources_per_notebook            = var.max_sources_per_notebook
  max_notebooks_per_user              = var.max_notebooks_per_user
  deletion_protection                 = var.deletion_protection
  labels                              = local.common_labels
}
