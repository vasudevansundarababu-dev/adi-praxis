variable "project_id" { type = string }
variable "location" { type = string }
variable "evidence_retention_days" {
  type        = number
  default     = 30
  description = "Minimum time evidence files are kept before deletion is allowed."
}
