# VPC for Cloud Run Direct VPC egress, private service access for Cloud SQL and Memorystore, and Cloud NAT with a
# fixed outbound IP (partners can allowlist it). Nothing in the data tier gets a public address.
resource "google_compute_network" "vpc" {
  project                 = var.project_id
  name                    = "praxis-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "run" {
  project                  = var.project_id
  name                     = "praxis-run"
  region                   = var.region
  network                  = google_compute_network.vpc.id
  ip_cidr_range            = var.run_subnet_cidr
  private_ip_google_access = true
}

resource "google_compute_global_address" "private_services" {
  project       = var.project_id
  name          = "praxis-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
}

resource "google_compute_address" "nat" {
  project = var.project_id
  name    = "praxis-nat-egress"
  region  = var.region
}

resource "google_compute_router" "router" {
  project = var.project_id
  name    = "praxis-router"
  region  = var.region
  network = google_compute_network.vpc.id
}

resource "google_compute_router_nat" "nat" {
  project                            = var.project_id
  name                               = "praxis-nat"
  region                             = var.region
  router                             = google_compute_router.router.name
  nat_ip_allocate_option             = "MANUAL_ONLY"
  nat_ips                            = [google_compute_address.nat.self_link]
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"
  subnetwork {
    name                    = google_compute_subnetwork.run.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }
  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

# Deny all inbound traffic into the VPC from the internet (Cloud Run egress and Google health checks are unaffected).
resource "google_compute_firewall" "deny_ingress" {
  project       = var.project_id
  name          = "praxis-deny-internet-ingress"
  network       = google_compute_network.vpc.name
  direction     = "INGRESS"
  priority      = 65534
  source_ranges = ["0.0.0.0/0"]
  deny {
    protocol = "all"
  }
}
