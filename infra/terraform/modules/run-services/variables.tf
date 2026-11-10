variable "project_id" { type = string }
variable "region" { type = string }
variable "environment" {
  type = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production"
  }
}
variable "network_id" { type = string }
variable "subnet_id" { type = string }
variable "service_accounts" { type = map(string) }
variable "domains" { type = object({ console = string, candidate = string, api = string }) }
variable "buckets" { type = map(string) }
variable "secret_ids" { type = object({ database_url_app = string, database_url_migration = string, redis_url = string }) }
variable "app_db_role" { type = string }
variable "vertex_location" {
  type    = string
  default = "global"
}
variable "smtp" {
  type    = object({ host = string, port = number, user = string, from = string })
  default = { host = "", port = 587, user = "", from = "ADI Praxis <no-reply@example.com>" }
}
variable "rl_gym_webhook_url" {
  type    = string
  default = ""
}
variable "scaling" {
  type = map(object({ min = number, max = number }))
}
variable "verify_cron" {
  type    = string
  default = "0 3 * * *"
}
variable "deletion_protection" {
  type    = bool
  default = true
}
variable "harbor_verify_job" { type = string }
variable "meta_compiler" {
  type = object({ live_ai = bool, models = string, cost_cap_usd = number, daily_budget_usd = number })
}
variable "policy_extraction" {
  description = "Policy Rules extraction settings and secret names from modules/policy-extraction (empty where it is not deployed)."
  type        = object({ env = map(string), secret_env = map(string) })
  default     = { env = {}, secret_env = {} }
}
