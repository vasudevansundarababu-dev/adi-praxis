output "env" {
  value = {
    POLICY_EXTRACTION_LIVE   = tostring(var.settings.live)
    LLAMAEXTRACT_PROJECT_ID  = var.settings.llamaextract_project_id
    DOCUMENTAI_PROCESSOR     = google_document_ai_processor.layout.id
    DOCUMENTAI_LOCATION      = google_document_ai_processor.layout.location
    POLICY_BUDGET_LLAMA_USD  = tostring(var.settings.budget_llama_usd)
    POLICY_BUDGET_GOOGLE_USD = tostring(var.settings.budget_google_usd)
    POLICY_MAX_PAGES         = tostring(var.settings.max_pages)
  }
}

output "secret_env" {
  value = var.settings.live ? { LLAMAEXTRACT_API_KEY = google_secret_manager_secret.llamaextract.secret_id } : {}
}
