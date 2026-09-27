variable "project_id" { type = string }
variable "region" { type = string }
variable "services" {
  type        = map(string)
  description = "Cloud Run service names keyed web, candidate, api."
}
variable "domains" { type = object({ console = string, candidate = string, api = string }) }
variable "rate_limit_per_minute" {
  type    = number
  default = 600
}
