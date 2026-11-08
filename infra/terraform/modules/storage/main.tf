# Buckets (SPEC): task-files, evidence, exports, brand. Uniform access; public access prevented on all of them.
# `brand` is private too: the organization policy forbids allUsers bindings, and no app serves assets from it yet.
# If public brand assets are needed later, serve them through the load balancer (backend bucket), not allUsers.
locals {
  private = { "task-files" = null, "evidence" = var.evidence_retention_days, "exports" = null }
}

resource "google_storage_bucket" "private" {
  for_each                    = local.private
  project                     = var.project_id
  name                        = "${var.project_id}-${each.key}"
  location                    = var.location
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = each.key == "evidence"
  }

  dynamic "retention_policy" {
    for_each = each.value == null ? [] : [each.value]
    content {
      retention_period = retention_policy.value * 86400
    }
  }
}

resource "google_storage_bucket" "brand" {
  project                     = var.project_id
  name                        = "${var.project_id}-brand"
  location                    = var.location
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
}
