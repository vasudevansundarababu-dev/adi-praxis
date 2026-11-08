variable "project_id" { type = string }
variable "region" { type = string }
variable "subnet_cidr" {
  type    = string
  default = "10.20.0.0/26"
}
variable "runner_service_accounts" {
  type        = list(string)
  description = "Emails that may start and read executions (api and worker)."
}
variable "deployer_email" { type = string }
variable "grade_seconds" {
  type    = number
  default = 120
}
variable "placeholder_image" {
  type    = string
  default = "us-docker.pkg.dev/cloudrun/container/hello"
}
variable "deletion_protection" {
  type    = bool
  default = true
}
