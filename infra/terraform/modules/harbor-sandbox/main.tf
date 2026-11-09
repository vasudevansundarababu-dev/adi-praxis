# Grading sandbox (architecture section 6, AD-04): the Cloud Run job `praxis-harbor-verify` runs untrusted solve.sh and
# verifier code. It has its own VPC with no Cloud NAT and no peering, so it reaches Google APIs only (Private Google
# Access, for the signed URLs) and never the internet, Cloud SQL or Redis. Its service account has no roles: the worker
# passes short-lived signed URLs for the one bundle to read and the one result to write. Task code additionally runs
# as nobody in an empty network namespace (infra/harbor-verify/grade.py).
resource "google_compute_network" "sandbox" {
  project                 = var.project_id
  name                    = "praxis-sandbox-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "sandbox" {
  project                  = var.project_id
  name                     = "praxis-sandbox"
  region                   = var.region
  network                  = google_compute_network.sandbox.id
  ip_cidr_range            = var.subnet_cidr
  private_ip_google_access = true
}

resource "google_compute_firewall" "deny_private_egress" {
  project            = var.project_id
  name               = "praxis-sandbox-deny-private-egress"
  network            = google_compute_network.sandbox.name
  direction          = "EGRESS"
  priority           = 1000
  destination_ranges = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"]
  deny {
    protocol = "all"
  }
}

resource "google_compute_firewall" "deny_ingress" {
  project       = var.project_id
  name          = "praxis-sandbox-deny-ingress"
  network       = google_compute_network.sandbox.name
  direction     = "INGRESS"
  priority      = 1000
  source_ranges = ["0.0.0.0/0"]
  deny {
    protocol = "all"
  }
}

resource "google_service_account" "sandbox" {
  project      = var.project_id
  account_id   = "praxis-harbor-verify"
  display_name = "ADI Praxis grading sandbox (no roles)"
}

resource "google_cloud_run_v2_job" "verify" {
  project             = var.project_id
  name                = "praxis-harbor-verify"
  location            = var.region
  deletion_protection = var.deletion_protection
  template {
    task_count = 1
    template {
      service_account       = google_service_account.sandbox.email
      execution_environment = "EXECUTION_ENVIRONMENT_GEN2"
      max_retries           = 0
      timeout               = "${var.grade_seconds + 60}s"
      vpc_access {
        egress = "ALL_TRAFFIC"
        network_interfaces {
          network    = google_compute_network.sandbox.id
          subnetwork = google_compute_subnetwork.sandbox.id
        }
      }
      containers {
        image = var.placeholder_image
        resources {
          limits = { cpu = "1", memory = "1Gi" }
        }
        env {
          name  = "HARBOR_GRADE_SECONDS"
          value = tostring(var.grade_seconds)
        }
      }
    }
  }
  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }
}

# The api (test setup) and worker start executions with per-run args and signed URLs, and read their status.
resource "google_cloud_run_v2_job_iam_member" "runners" {
  for_each = { for pair in setproduct(var.runner_service_accounts, ["roles/run.jobsExecutorWithOverrides", "roles/run.viewer"]) : "${pair[0]}-${pair[1]}" => pair }
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.verify.name
  role     = each.value[1]
  member   = "serviceAccount:${each.value[0]}"
}

# CI updates the job's image; the job runs as the sandbox account.
resource "google_service_account_iam_member" "deployer_act_as" {
  service_account_id = google_service_account.sandbox.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${var.deployer_email}"
}
