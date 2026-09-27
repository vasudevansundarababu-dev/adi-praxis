# Least privilege (SPEC Security): one service account per Cloud Run service; only api, worker and jobs can read
# secrets and reach the database. GitHub Actions deploys through Workload Identity Federation (no keys anywhere).
locals {
  services = ["web", "candidate", "api", "worker", "jobs", "scheduler"]
  backend  = ["api", "worker", "jobs"]
  backend_roles = [
    "roles/cloudsql.client",
    "roles/aiplatform.user",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/cloudtrace.agent",
    "roles/errorreporting.writer",
  ]
  frontend_roles = ["roles/logging.logWriter", "roles/monitoring.metricWriter", "roles/cloudtrace.agent"]
  deployer_roles = ["roles/run.admin", "roles/artifactregistry.writer", "roles/cloudscheduler.viewer"]
}

resource "google_service_account" "sa" {
  for_each     = toset(local.services)
  project      = var.project_id
  account_id   = "praxis-${each.key}"
  display_name = "ADI Praxis ${each.key}"
}

resource "google_project_iam_member" "backend" {
  for_each = { for pair in setproduct(local.backend, local.backend_roles) : "${pair[0]}-${pair[1]}" => pair }
  project  = var.project_id
  role     = each.value[1]
  member   = "serviceAccount:${google_service_account.sa[each.value[0]].email}"
}

resource "google_project_iam_member" "frontend" {
  for_each = { for pair in setproduct(["web", "candidate"], local.frontend_roles) : "${pair[0]}-${pair[1]}" => pair }
  project  = var.project_id
  role     = each.value[1]
  member   = "serviceAccount:${google_service_account.sa[each.value[0]].email}"
}

# Evidence, task files and exports: read/write for api and worker only.
resource "google_storage_bucket_iam_member" "backend_objects" {
  for_each = { for pair in setproduct(["api", "worker"], var.private_buckets) : "${pair[0]}-${pair[1]}" => pair }
  bucket   = each.value[1]
  role     = "roles/storage.objectAdmin"
  member   = "serviceAccount:${google_service_account.sa[each.value[0]].email}"
}

# ── Application secrets: one secret per key, values from (sensitive) Terraform variables ──
resource "google_secret_manager_secret" "app" {
  for_each  = toset(var.app_secret_names)
  project   = var.project_id
  secret_id = each.key
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "app" {
  for_each    = nonsensitive(toset([for k in var.app_secret_names : k if lookup(var.app_secret_values, k, "") != ""]))
  secret      = google_secret_manager_secret.app[each.key].id
  secret_data = var.app_secret_values[each.key]
}

resource "google_secret_manager_secret_iam_member" "backend" {
  for_each   = { for pair in setproduct(local.backend, concat(var.app_secret_names, var.infra_secret_ids)) : "${pair[0]}-${pair[1]}" => pair }
  project    = var.project_id
  secret_id  = each.value[1]
  role       = "roles/secretmanager.secretAccessor"
  member     = "serviceAccount:${google_service_account.sa[each.value[0]].email}"
  depends_on = [google_secret_manager_secret.app]
}

# The Google sign-in client id is public; the candidate app reads it at runtime.
resource "google_secret_manager_secret_iam_member" "candidate_client_id" {
  project    = var.project_id
  secret_id  = "google-oauth-client-id"
  role       = "roles/secretmanager.secretAccessor"
  member     = "serviceAccount:${google_service_account.sa["candidate"].email}"
  depends_on = [google_secret_manager_secret.app]
}

# ── Audit: data-access logs on Cloud SQL, Cloud Storage and Secret Manager ──
resource "google_project_iam_audit_config" "data_access" {
  for_each = toset(["cloudsql.googleapis.com", "storage.googleapis.com", "secretmanager.googleapis.com"])
  project  = var.project_id
  service  = each.key
  audit_log_config {
    log_type = "DATA_READ"
  }
  audit_log_config {
    log_type = "DATA_WRITE"
  }
}

# ── GitHub Actions deployer through Workload Identity Federation ──
resource "google_service_account" "deployer" {
  project      = var.project_id
  account_id   = "praxis-deployer"
  display_name = "GitHub Actions deployer"
}

resource "google_project_iam_member" "deployer" {
  for_each = toset(local.deployer_roles)
  project  = var.project_id
  role     = each.key
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

# The deployer may deploy revisions that run as the runtime service accounts.
resource "google_service_account_iam_member" "deployer_act_as" {
  for_each           = toset(local.services)
  service_account_id = google_service_account.sa[each.key].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"
  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }
  # Only this repository can impersonate the deployer.
  attribute_condition = "assertion.repository == \"${var.github_repository}\""
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "github_impersonation" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

# Terraform planner for CI (`terraform plan` on pull requests and the weekly drift check): read-only on the project,
# plus the secret values and state it must refresh. Applies are run by an operator with elevated rights.
resource "google_service_account" "planner" {
  project      = var.project_id
  account_id   = "praxis-tf-planner"
  display_name = "Terraform planner (CI)"
}

resource "google_project_iam_member" "planner" {
  for_each = toset(["roles/viewer", "roles/iam.securityReviewer", "roles/secretmanager.secretAccessor"])
  project  = var.project_id
  role     = each.key
  member   = "serviceAccount:${google_service_account.planner.email}"
}

resource "google_storage_bucket_iam_member" "planner_state" {
  bucket = "${var.project_id}-tfstate"
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.planner.email}"
}

resource "google_service_account_iam_member" "planner_impersonation" {
  service_account_id = google_service_account.planner.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}
