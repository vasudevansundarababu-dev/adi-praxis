variable "project_id" { type = string }
variable "domains" { type = object({ console = string, candidate = string, api = string }) }
variable "alert_emails" {
  type    = list(string)
  default = []
}
variable "error_rate_threshold" {
  type    = number
  default = 0.02
}
variable "p95_latency_ms" {
  type    = number
  default = 2000
}
variable "queue_backlog_threshold" {
  type    = number
  default = 500
}
variable "billing_account" {
  type        = string
  default     = ""
  description = "Billing account id for budget alerts; blank skips the budget."
}
variable "monthly_budget_usd" {
  type    = number
  default = 300
}
