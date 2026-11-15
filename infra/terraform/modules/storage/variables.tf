variable "project_id" { type = string }
variable "location" { type = string }
variable "evidence_retention_days" {
  type        = number
  default     = 30
  description = "Minimum time evidence files are kept before deletion is allowed."
}
variable "tutorial_cors_origins" {
  type        = list(string)
  default     = []
  description = "Origins (console, candidate app) allowed to read tutorial videos and captions from signed URLs."
}
