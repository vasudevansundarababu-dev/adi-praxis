variable "project_id" { type = string }
variable "environment" { type = string }
variable "api_service_account" { type = string }
variable "worker_service_account" { type = string }
variable "jobs_service_account" { type = string }
variable "evidence_bucket" { type = string }
variable "settings" {
  description = "Owner decisions D-B1/D-D1: per-provider spend ceilings in USD; live = false keeps both providers Not available."
  type = object({
    live                    = bool
    llamaextract_project_id = string
    budget_llama_usd        = number
    budget_google_usd       = number
    max_pages               = number
  })
  validation {
    condition     = var.settings.budget_llama_usd > 0 && var.settings.budget_google_usd > 0 && var.settings.max_pages >= 1 && var.settings.max_pages <= 30
    error_message = "Both budgets must be positive and max_pages must be 1-30 (Layout Parser online limit)."
  }
}
