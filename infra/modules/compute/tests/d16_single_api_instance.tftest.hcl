# D16 / D4 (grill F6): one API instance with CPU allocated for in-process v2 background work.
mock_provider "google" {}
mock_provider "google-beta" {}

variables {
  project_id                          = "everlast-test"
  environment                         = "dev"
  region                              = "europe-west4"
  api_image                           = "europe-west4-docker.pkg.dev/everlast-test/everlast/everlast:test"
  worker_image                        = "europe-west4-docker.pkg.dev/everlast-test/everlast/everlast:test"
  api_service_account_email           = "api@everlast-test.iam.gserviceaccount.com"
  worker_service_account_email        = "worker@everlast-test.iam.gserviceaccount.com"
  tasks_invoker_service_account_email = "tasks@everlast-test.iam.gserviceaccount.com"
  sql_connection_name                 = "everlast-test:europe-west4:everlast"
  database_name                       = "everlast"
  api_db_iam_username                 = "api@everlast-test.iam"
  worker_db_iam_username              = "worker@everlast-test.iam"
  workspace_bucket_name               = "everlast-test-workspace"
  ingestion_queue_name                = "everlast-dev-ingestion-queue"
  studio_queue_name                   = "everlast-dev-studio-queue"
  document_ai_layout_processor_name   = "projects/everlast-test/locations/eu/processors/123"
  secret_ids                          = {}
}

run "api_cpu_stays_allocated" {
  command = plan
  assert {
    condition     = google_cloud_run_v2_service.api.template[0].containers[0].resources[0].cpu_idle == false
    error_message = "D16: the API must keep CPU allocated for in-process background work."
  }
}

run "second_api_instance_is_rejected" {
  command = plan
  variables { api_max_instances = 2 }
  expect_failures = [google_cloud_run_v2_service.api]
}
