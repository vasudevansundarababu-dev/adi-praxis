variable "project_id" { type = string }
variable "region" {
  type    = string
  default = "us-central1"
}
variable "environment" { type = string }
variable "github_repository" { type = string }
variable "domains" { type = object({ console = string, candidate = string, api = string }) }
variable "database" { type = object({ tier = string, high_availability = bool }) }
variable "redis_tier" { type = string }
variable "scaling" { type = map(object({ min = number, max = number })) }
variable "deletion_protection" { type = bool }
variable "evidence_retention_days" {
  type    = number
  default = 30
}
variable "smtp" {
  type    = object({ host = string, port = number, user = string, from = string })
  default = { host = "", port = 587, user = "", from = "ADI Praxis <no-reply@example.com>" }
}
variable "rl_gym_webhook_url" {
  type    = string
  default = ""
}
variable "alert_emails" {
  type    = list(string)
  default = []
}
variable "billing_account" {
  type    = string
  default = ""
}
variable "monthly_budget_usd" { type = number }
variable "app_secret_values" {
  type      = map(string)
  default   = {}
  sensitive = true
}
variable "meta_compiler" {
  description = "Live Claude for the Meta-Compiler and judge (owner-approved caps). live_ai = false keeps the mock."
  type        = object({ live_ai = bool, models = string, cost_cap_usd = number, daily_budget_usd = number })
  default     = { live_ai = false, models = "claude:claude-sonnet-5", cost_cap_usd = 2, daily_budget_usd = 10 }
}
