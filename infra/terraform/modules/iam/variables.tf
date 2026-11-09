variable "project_id" { type = string }
variable "github_repository" {
  type        = string
  description = "owner/repo allowed to deploy through Workload Identity Federation."
}
variable "private_buckets" { type = list(string) }
variable "infra_secret_ids" {
  type        = list(string)
  description = "Secrets created by other modules (database and Redis URLs) that the backend reads."
}
variable "app_secret_names" {
  type = list(string)
  default = [
    "google-oauth-client-id",
    "stripe-secret-key",
    "stripe-identity-webhook-secret",
    "smtp-password",
    "rl-gym-webhook-secret",
  ]
}
variable "app_secret_values" {
  type        = map(string)
  default     = {}
  sensitive   = true
  description = "First version of each secret, needed when it is created. Later changes are ignored (rotate with gcloud)."
}
