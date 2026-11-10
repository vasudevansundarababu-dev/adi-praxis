# Live policy extraction for Policy Rules (staging only): the Document AI Layout Parser for the Google option and the
# LlamaExtract key slot. Terraform creates the secret without a version; the owner adds the key with gcloud, then sets
# live = true, which is when the key is wired into Cloud Run (a revision cannot start on a secret with no version).
resource "google_project_service" "documentai" {
  project            = var.project_id
  service            = "documentai.googleapis.com"
  disable_on_destroy = false
}

resource "google_document_ai_processor" "layout" {
  project      = var.project_id
  location     = "us"
  type         = "LAYOUT_PARSER_PROCESSOR"
  display_name = "praxis-policy-layout"
  depends_on   = [google_project_service.documentai]
  lifecycle {
    precondition {
      condition     = !var.settings.live || var.environment == "staging"
      error_message = "Live policy extraction is allowed in staging only."
    }
  }
}

# Only the worker runs extraction jobs (policy.extract handler); Vertex access already comes from roles/aiplatform.user.
resource "google_project_iam_member" "documentai_user" {
  project = var.project_id
  role    = "roles/documentai.apiUser"
  member  = "serviceAccount:${var.worker_service_account}"
}

resource "google_secret_manager_secret" "llamaextract" {
  project   = var.project_id
  secret_id = "llamaextract-api-key"
  replication {
    auto {}
  }
}

# The api reads the key only to report whether LlamaExtract is configured; the worker calls it.
resource "google_secret_manager_secret_iam_member" "llamaextract" {
  for_each  = toset([var.api_service_account, var.worker_service_account])
  project   = var.project_id
  secret_id = google_secret_manager_secret.llamaextract.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${each.key}"
}

# The policy-seed job (praxis-migrate image, jobs service account) stores fictional SEED documents. Staging only, and
# only create + read under policy/: the seed never lists, overwrites or deletes (object keys are fresh ids).
resource "google_storage_bucket_iam_member" "seed_objects" {
  for_each = var.environment == "staging" ? toset(["roles/storage.objectCreator", "roles/storage.objectViewer"]) : toset([])
  bucket   = var.evidence_bucket
  role     = each.key
  member   = "serviceAccount:${var.jobs_service_account}"
  condition {
    title      = "policy-seed-objects"
    expression = "resource.name.startsWith(\"projects/_/buckets/${var.evidence_bucket}/objects/policy/\")"
  }
}
