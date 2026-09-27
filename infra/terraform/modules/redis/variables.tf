variable "project_id" { type = string }
variable "region" { type = string }
variable "environment" { type = string }
variable "network_id" { type = string }
variable "private_services_connection" { type = string }
variable "tier" {
  type    = string
  default = "STANDARD_HA"
}
variable "memory_size_gb" {
  type    = number
  default = 1
}
