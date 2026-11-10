# Offline (mock provider): live extraction stays staging-only, and the key reaches Cloud Run only once live is on.
mock_provider "google" {
  mock_resource "google_document_ai_processor" {
    defaults = { id = "projects/test-project/locations/us/processors/abc123" }
  }
}

variables {
  project_id             = "test-project"
  environment            = "staging"
  api_service_account    = "praxis-api@test-project.iam.gserviceaccount.com"
  worker_service_account = "praxis-worker@test-project.iam.gserviceaccount.com"
  settings               = { live = false, llamaextract_project_id = "p-1", budget_llama_usd = 20, budget_google_usd = 30, max_pages = 20 }
}

run "off_by_default_creates_the_slot_but_wires_no_key" {
  command = apply
  assert {
    condition     = output.env.POLICY_EXTRACTION_LIVE == "false" && length(output.secret_env) == 0
    error_message = "with live = false the key must not be mounted (the secret has no version yet)"
  }
  assert {
    condition     = output.env.DOCUMENTAI_PROCESSOR == "projects/test-project/locations/us/processors/abc123" && output.env.DOCUMENTAI_LOCATION == "us"
    error_message = "the app needs the full processor resource name in us"
  }
  assert {
    condition     = output.env.POLICY_BUDGET_LLAMA_USD == "20" && output.env.POLICY_BUDGET_GOOGLE_USD == "30" && output.env.POLICY_MAX_PAGES == "20"
    error_message = "budgets and page limit are passed through"
  }
  assert {
    condition     = google_project_iam_member.documentai_user.member == "serviceAccount:praxis-worker@test-project.iam.gserviceaccount.com"
    error_message = "only the worker calls Document AI"
  }
  assert {
    condition     = length(google_secret_manager_secret_iam_member.llamaextract) == 2
    error_message = "api and worker read the key; nobody else"
  }
}

run "live_mounts_the_key" {
  command = apply
  variables {
    settings = { live = true, llamaextract_project_id = "p-1", budget_llama_usd = 20, budget_google_usd = 30, max_pages = 20 }
  }
  assert {
    condition     = length(output.secret_env) == 1 && output.secret_env["LLAMAEXTRACT_API_KEY"] == "llamaextract-api-key" && output.env.POLICY_EXTRACTION_LIVE == "true"
    error_message = "live = true mounts the key secret"
  }
}

run "live_is_refused_outside_staging" {
  command = plan
  variables {
    environment = "production"
    settings    = { live = true, llamaextract_project_id = "p-1", budget_llama_usd = 20, budget_google_usd = 30, max_pages = 20 }
  }
  expect_failures = [google_document_ai_processor.layout]
}

run "budgets_are_required" {
  command = plan
  variables {
    settings = { live = false, llamaextract_project_id = "p-1", budget_llama_usd = 0, budget_google_usd = 30, max_pages = 20 }
  }
  expect_failures = [var.settings]
}
