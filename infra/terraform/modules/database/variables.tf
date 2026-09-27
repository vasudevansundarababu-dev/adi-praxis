variable "project_id" { type = string }
variable "region" { type = string }
variable "environment" { type = string }
variable "network_id" { type = string }
variable "private_services_connection" { type = string }
variable "tier" {
  type    = string
  default = "db-custom-2-7680"
}
variable "high_availability" {
  type    = bool
  default = true
}
variable "deletion_protection" {
  type    = bool
  default = true
}
