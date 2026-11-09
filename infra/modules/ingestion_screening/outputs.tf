# FR-SI-01/05: the worker endpoint builder needs a local ID, never the full resource path.
output "template_id" {
  description = "Effective local Model Armor template ID (managed or explicitly existing)."
  value       = var.create_model_armor_template ? google_model_armor_template.ingestion[0].template_id : var.model_armor_template_id
}
