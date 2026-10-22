# Traceability: D2, D3, D4, C-01, C-02, FR-WM-01, FR-WM-04, FR-WM-07, FR-SI-01..04, FR-GC-01..03, FR-GC-06, FR-UI-01, NFR-SEC-01
locals {
  name_prefix = "everlast-${var.environment}"

  common_env_vars = {
    NODE_ENV                       = var.environment == "prod" ? "production" : "development"
    GCP_PROJECT_ID                 = var.project_id
    GCP_REGION                     = var.region
    VERTEX_AI_LOCATION             = var.region
    CLOUD_SQL_CONNECTION_NAME      = var.sql_connection_name
    POSTGRES_DB                    = var.database_name
    GCS_WORKSPACE_BUCKET           = var.workspace_bucket_name
    DOCUMENT_AI_PROCESSOR_NAME     = var.document_ai_layout_processor_name
    DOCUMENT_AI_PROCESSOR_ID       = var.document_ai_layout_processor_name
    DOCUMENT_AI_LOCATION           = "eu"
    QUOTA_MAX_SOURCES_PER_NOTEBOOK = tostring(var.max_sources_per_notebook)
    QUOTA_MAX_NOTEBOOKS_PER_USER   = tostring(var.max_notebooks_per_user)
    QUOTA_MAX_SOURCE_BYTES         = "200000000" # FR-WM-07: 200 MB = 200,000,000 bytes inclusive
    QUOTA_MAX_SOURCE_WORDS         = "500000"    # FR-WM-07: 500,000 extracted words inclusive
  }

  api_env_vars = merge(local.common_env_vars, {
    SERVICE_ROLE                  = "api"
    AUTH_MODE                     = "identity-platform"
    IDENTITY_PLATFORM_API_KEY     = var.identity_platform_api_key
    IDENTITY_PLATFORM_PROVIDER_ID = var.identity_platform_provider_id
    POSTGRES_USER                 = var.api_db_iam_username
    CLOUD_TASKS_INGESTION_QUEUE   = var.ingestion_queue_name
    CLOUD_TASKS_STUDIO_QUEUE      = var.studio_queue_name
    CLOUD_TASKS_INVOKER_SA_EMAIL  = var.tasks_invoker_service_account_email
    CLOUD_TASKS_LOCATION          = var.tasks_location # queues live outside europe-west4 (no Cloud Tasks there)
    WORKER_INTERNAL_URL           = google_cloud_run_v2_service.worker.uri
    # The API applies pending packages/db migrations at startup (advisory-locked, each file once).
    MIGRATE_ON_START = "true"
  })

  worker_env_vars = merge(local.common_env_vars, {
    SERVICE_ROLE  = "worker"
    POSTGRES_USER = var.worker_db_iam_username
    }, var.render_image == "" ? {} : {
    # Package 3.1 (specs/009): Office/audio normalization runs as everlast-render executions.
    RENDER_JOB_NAME     = "${local.name_prefix}-render"
    RENDER_JOB_LOCATION = var.region
    }, var.enable_v3_ingestion ? {
    SPEECH_LOCATION             = var.region # Chirp 2, europe-west4 (D3); no silent region fallback
    MODEL_ARMOR_LOCATION        = var.region
    MODEL_ARMOR_TEMPLATE_ID     = var.model_armor_template_id
    GOOGLE_OAUTH_CLIENT_ID      = var.google_oauth_client_id
    DELEGATED_SECRET_PROJECT_ID = var.project_id
  } : {})
}

# 1. everlast-worker: Internal-only Cloud Run Service (Cloud Tasks Target, §3.3 & §5.1)
resource "google_cloud_run_v2_service" "worker" {
  project             = var.project_id
  name                = "${local.name_prefix}-worker"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = var.deletion_protection
  labels              = var.labels

  template {
    service_account                  = var.worker_service_account_email
    timeout                          = "600s"
    max_instance_request_concurrency = 10

    scaling {
      min_instance_count = 0
      max_instance_count = var.worker_max_instances
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [var.sql_connection_name]
      }
    }

    containers {
      name  = "worker"
      image = var.worker_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "2Gi"
        }
        cpu_idle = true
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      dynamic "env" {
        for_each = local.worker_env_vars
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.mount_secrets ? var.secret_ids : {}
        content {
          name = upper(env.key)
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }
}

# Grant ONLY the Cloud Tasks OIDC invoker and everlast-api permission to invoke everlast-worker (§5.1)
resource "google_cloud_run_v2_service_iam_member" "worker_tasks_invoker" {
  project  = var.project_id
  location = google_cloud_run_v2_service.worker.location
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${var.tasks_invoker_service_account_email}"
}

resource "google_cloud_run_v2_service_iam_member" "worker_api_invoker" {
  project  = var.project_id
  location = google_cloud_run_v2_service.worker.location
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${var.api_service_account_email}"
}

# 2. everlast-api: Public HTTPS Cloud Run Service serving SPA + BFF + ADK Chat Agent (§3.3 & §5.1)
resource "google_cloud_run_v2_service" "api" {
  project             = var.project_id
  name                = "${local.name_prefix}-api"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = var.deletion_protection
  labels              = var.labels

  template {
    service_account                  = var.api_service_account_email
    timeout                          = "300s"
    max_instance_request_concurrency = 80

    scaling {
      min_instance_count = var.api_min_instances
      max_instance_count = var.api_max_instances
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [var.sql_connection_name]
      }
    }

    containers {
      name  = "api"
      image = var.api_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "1Gi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      dynamic "env" {
        for_each = local.api_env_vars
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.mount_secrets ? var.secret_ids : {}
        content {
          name = upper(env.key)
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "api_public_invoker" {
  count    = var.allow_public_api_ingress ? 1 : 0
  project  = var.project_id
  location = google_cloud_run_v2_service.api.location
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# 3. everlast-render: Cloud Run Job (C8; FR-SI-01 Subset B, specs/009 T013). One execution per conversion, started
#    by the worker with RENDER_* overrides; jobs have no idle instances, so it costs nothing while unused.
resource "google_cloud_run_v2_job" "render" {
  count               = var.render_image == "" ? 0 : 1
  project             = var.project_id
  name                = "${local.name_prefix}-render"
  location            = var.region
  deletion_protection = var.deletion_protection
  labels              = var.labels

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account = var.render_service_account_email
      timeout         = "600s"
      max_retries     = 0

      # Security review 2026-10-23: all egress goes into an isolated VPC without Cloud NAT, so the converters
      # cannot reach the internet or internal hosts; Google APIs (Cloud Storage) stay reachable via Private
      # Google Access.
      vpc_access {
        egress = "ALL_TRAFFIC"
        network_interfaces {
          network    = google_compute_network.render_isolated[0].id
          subnetwork = google_compute_subnetwork.render_isolated[0].id
        }
      }

      containers {
        name  = "render"
        image = var.render_image

        resources {
          limits = {
            cpu    = "2"
            memory = "4Gi"
          }
        }

        env {
          name  = "GCS_WORKSPACE_BUCKET"
          value = var.workspace_bucket_name
        }
        env {
          name  = "NODE_ENV"
          value = var.environment == "prod" ? "production" : "development"
        }
      }
    }
  }
}

# Isolated network for everlast-render: no Cloud NAT and no other hosts, so a converted document cannot reach the
# internet or internal services; Private Google Access keeps Cloud Storage reachable. A deny-all firewall plus a
# private googleapis.com DNS zone was rejected: the zone adds fixed idle cost (CC-08) and NAT-less egress already
# has no internet path.
resource "google_compute_network" "render_isolated" {
  count                   = var.render_image == "" ? 0 : 1
  project                 = var.project_id
  name                    = "${local.name_prefix}-render-isolated"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "render_isolated" {
  count                    = var.render_image == "" ? 0 : 1
  project                  = var.project_id
  name                     = "${local.name_prefix}-render-isolated"
  region                   = var.region
  network                  = google_compute_network.render_isolated[0].id
  ip_cidr_range            = "10.250.0.0/26"
  private_ip_google_access = true
}

# The worker may start executions with per-run overrides (input/output object references) and nothing else.
resource "google_cloud_run_v2_job_iam_member" "worker_render_executor" {
  count    = var.render_image == "" ? 0 : 1
  project  = var.project_id
  location = google_cloud_run_v2_job.render[0].location
  name     = google_cloud_run_v2_job.render[0].name
  role     = "roles/run.jobsExecutorWithOverrides"
  member   = "serviceAccount:${var.worker_service_account_email}"
}
