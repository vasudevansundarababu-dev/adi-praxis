terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.10"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  # State in the versioned bucket created by ../../bootstrap (GCS backends lock automatically).
  backend "gcs" {
    bucket = "adi-praxis-staging-tfstate"
    prefix = "praxis"
  }
}

provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

module "platform" {
  source              = "../../modules/platform"
  project_id          = var.project_id
  region              = var.region
  environment         = "staging"
  github_repository   = var.github_repository
  domains             = var.domains
  database            = { tier = "db-custom-1-3840", high_availability = false }
  redis_tier          = "BASIC"
  scaling             = { web = { min = 0, max = 10 }, candidate = { min = 0, max = 20 }, api = { min = 0, max = 20 }, worker = { min = 1, max = 5 } }
  deletion_protection = false
  smtp                = var.smtp
  rl_gym_webhook_url  = var.rl_gym_webhook_url
  alert_emails        = var.alert_emails
  billing_account     = var.billing_account
  monthly_budget_usd  = var.monthly_budget_usd
  app_secret_values   = var.app_secret_values
  # Owner approval (8 Nov 2026): live Claude in staging, $2 per run, $10 per day.
  meta_compiler = { live_ai = true, models = "claude:claude-sonnet-5", cost_cap_usd = 2, daily_budget_usd = 10 }
  # Owner decisions D-B1/D-D1: $20 LlamaExtract, $30 Google, 20 pages. Set live = true only after the
  # llamaextract-api-key secret has a version (docs/integrations/POLICY-EXTRACTION-LIVE-SETUP.md).
  policy_extraction = { live = false, llamaextract_project_id = "bbe4af96-0b9d-4518-99f8-1bb62570b278", budget_llama_usd = 20, budget_google_usd = 30, max_pages = 20 }
}

output "platform" { value = module.platform }
