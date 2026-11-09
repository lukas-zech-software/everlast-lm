# [009-multimodal-ingestion-sync] T066 — FR-SI-01/05, NFR-SEC-01/02, D3.
# Optional reviewable proposal only. Creating resources / enabling APIs still requires owner approval.
resource "google_model_armor_template" "ingestion" {
  count           = var.create_model_armor_template ? 1 : 0
  project         = var.project_id
  location        = var.region
  template_id     = "everlast-${var.environment}-ingestion"
  deletion_policy = var.deletion_protection ? "PREVENT" : "DELETE"
  labels          = var.labels

  filter_config {
    pi_and_jailbreak_filter_settings {
      filter_enforcement = "ENABLED"
      # LOW_AND_ABOVE includes all supported confidence levels, rather than letting low-confidence matches through.
      confidence_level = "LOW_AND_ABOVE"
    }
  }

  template_metadata {
    enforcement_type                   = "INSPECT_AND_BLOCK"
    ignore_partial_invocation_failures = false
    data_residency_compliant           = true
    modalities                         = ["MODALITY_TEXT"]
    log_sanitize_operations            = false
  }

  lifecycle {
    precondition {
      condition     = var.enable_v3_ingestion
      error_message = "Managed ingestion screening requires enable_v3_ingestion (FR-SI-01/05)."
    }
    precondition {
      condition     = var.region == "europe-west4"
      error_message = "Managed ingestion screening must stay in the approved europe-west4 region (D3)."
    }
    precondition {
      condition     = var.model_armor_template_id == ""
      error_message = "Choose managed screening or an existing model_armor_template_id, never both."
    }
  }

}
