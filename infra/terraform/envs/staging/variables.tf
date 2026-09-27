variable "project_id" {
  type    = string
  default = "adi-praxis-staging"
}
variable "region" {
  type    = string
  default = "us-central1"
}
variable "github_repository" {
  type        = string
  description = "owner/repo that may deploy (Workload Identity Federation)."
}
variable "domains" {
  type        = object({ console = string, candidate = string, api = string })
  description = "Hostnames: app.<domain>, experts.<domain>, api.<domain> (the domain is still an open question)."
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
variable "monthly_budget_usd" {
  type    = number
  default = 300
}
variable "app_secret_values" {
  type      = map(string)
  default   = {}
  sensitive = true
}
