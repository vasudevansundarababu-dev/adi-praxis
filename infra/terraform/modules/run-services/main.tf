# Cloud Run services and jobs (SPEC GCP deployment). Images are deployed by CI (`gcloud run deploy`), so Terraform
# creates each service once with a placeholder image and then ignores image changes. Scaling is set per revision
# (template.scaling); the service-level block is filled in by the API and would otherwise show as drift.
locals {
  placeholder = "us-docker.pkg.dev/cloudrun/container/hello"
  secret_env = {
    DATABASE_URL                   = var.secret_ids.database_url_app
    REDIS_URL                      = var.secret_ids.redis_url
    STRIPE_SECRET_KEY              = "stripe-secret-key"
    STRIPE_IDENTITY_WEBHOOK_SECRET = "stripe-identity-webhook-secret"
    GOOGLE_OAUTH_CLIENT_ID         = "google-oauth-client-id"
    SMTP_PASSWORD                  = "smtp-password"
    RL_GYM_WEBHOOK_SECRET          = "rl-gym-webhook-secret"
  }
  backend_env = {
    NODE_ENV            = "production"
    APP_ENV             = var.environment
    API_PORT            = "8080"
    CANDIDATE_APP_URL   = "https://${var.domains.candidate}"
    CORS_ORIGINS        = "https://${var.domains.console},https://${var.domains.candidate}"
    EVIDENCE_BUCKET     = var.buckets.evidence
    GCS_PROJECT_ID      = var.project_id
    VERTEX_PROJECT_ID   = var.project_id
    VERTEX_LOCATION     = var.vertex_location
    EMBEDDING_LOCATION  = var.region
    SMTP_HOST           = var.smtp.host
    SMTP_PORT           = tostring(var.smtp.port)
    SMTP_USER           = var.smtp.user
    EMAIL_FROM          = var.smtp.from
    RL_GYM_WEBHOOK_URL  = var.rl_gym_webhook_url
    DATASET_VERIFY_CRON = "off" # Cloud Scheduler runs the verification job instead
    # Grading runs only in the praxis-harbor-verify sandbox job (never the mock in deployed environments, D-12).
    HARBOR_RUNNER        = "job"
    HARBOR_VERIFY_JOB    = var.harbor_verify_job
    HARBOR_VERIFY_REGION = var.region
    # Paid Claude only with both caps set (NFR-08a, NFR-09); config refuses live AI without them.
    META_COMPILER_LIVE_AI       = tostring(var.meta_compiler.live_ai)
    META_COMPILER_MODELS        = var.meta_compiler.models
    GENERATION_COST_CAP_USD     = tostring(var.meta_compiler.cost_cap_usd)
    GENERATION_DAILY_BUDGET_USD = tostring(var.meta_compiler.daily_budget_usd)
  }
  vpc = { network = var.network_id, subnetwork = var.subnet_id }
}

# ── API ──
resource "google_cloud_run_v2_service" "api" {
  project             = var.project_id
  name                = "praxis-api"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  deletion_protection = var.deletion_protection
  # The load balancer forwards unauthenticated users. The organization policy forbids allUsers bindings, so the invoker
  # IAM check is off instead; ingress still accepts traffic only from the load balancer.
  invoker_iam_disabled = true
  template {
    service_account = var.service_accounts.api
    timeout         = "60s"
    scaling {
      min_instance_count = var.scaling.api.min
      max_instance_count = var.scaling.api.max
    }
    vpc_access {
      egress = "ALL_TRAFFIC"
      network_interfaces {
        network    = local.vpc.network
        subnetwork = local.vpc.subnetwork
      }
    }
    containers {
      image = local.placeholder
      ports {
        container_port = 8080
      }
      resources {
        limits = { cpu = "1", memory = "1Gi" }
      }
      dynamic "env" {
        for_each = local.backend_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
      startup_probe {
        http_get {
          path = "/healthz"
        }
      }
      liveness_probe {
        http_get {
          path = "/healthz"
        }
      }
    }
  }
  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version, traffic, scaling]
  }
}

# ── Worker: CPU always allocated; reachable only inside the VPC (health endpoint only) ──
resource "google_cloud_run_v2_service" "worker" {
  project             = var.project_id
  name                = "praxis-worker"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = var.deletion_protection
  template {
    service_account = var.service_accounts.worker
    scaling {
      min_instance_count = var.scaling.worker.min
      max_instance_count = var.scaling.worker.max
    }
    vpc_access {
      egress = "ALL_TRAFFIC"
      network_interfaces {
        network    = local.vpc.network
        subnetwork = local.vpc.subnetwork
      }
    }
    containers {
      image = local.placeholder
      args  = ["src/worker.ts"]
      ports {
        container_port = 8080
      }
      resources {
        cpu_idle = false
        limits   = { cpu = "1", memory = "1Gi" }
      }
      dynamic "env" {
        for_each = merge(local.backend_env, { WORKER_HEALTH_PORT = "8080" })
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }
  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version, traffic, scaling]
  }
}

# ── Next.js front ends ──
resource "google_cloud_run_v2_service" "front" {
  for_each             = { web = "praxis-web", candidate = "praxis-candidate" }
  project              = var.project_id
  name                 = each.value
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  deletion_protection  = var.deletion_protection
  invoker_iam_disabled = true # see praxis-api
  template {
    service_account = var.service_accounts[each.key]
    scaling {
      min_instance_count = var.scaling[each.key].min
      max_instance_count = var.scaling[each.key].max
    }
    vpc_access {
      egress = "ALL_TRAFFIC"
      network_interfaces {
        network    = local.vpc.network
        subnetwork = local.vpc.subnetwork
      }
    }
    containers {
      image = local.placeholder
      ports {
        container_port = 8080
      }
      resources {
        limits = { cpu = "1", memory = "512Mi" }
      }
      env {
        name  = "API_BASE_URL"
        value = google_cloud_run_v2_service.api.uri
      }
      env {
        name  = "CANDIDATE_APP_URL"
        value = "https://${var.domains.candidate}"
      }
      dynamic "env" {
        for_each = each.key == "candidate" ? ["google-oauth-client-id"] : []
        content {
          name = "GOOGLE_OAUTH_CLIENT_ID"
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }
  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version, traffic, scaling]
  }
}

# ── Jobs: migrations (as the migration role) and the nightly hash-chain verification ──
resource "google_cloud_run_v2_job" "job" {
  for_each = {
    migrate       = { args = ["src/jobs/run.ts", "migrate"], db_secret = var.secret_ids.database_url_migration }
    verify-chains = { args = ["src/jobs/run.ts", "verify-chains"], db_secret = var.secret_ids.database_url_app }
  }
  project             = var.project_id
  name                = "praxis-${each.key}"
  location            = var.region
  deletion_protection = var.deletion_protection
  template {
    task_count = 1
    template {
      service_account = var.service_accounts.jobs
      max_retries     = 2
      timeout         = "1800s"
      vpc_access {
        egress = "ALL_TRAFFIC"
        network_interfaces {
          network    = local.vpc.network
          subnetwork = local.vpc.subnetwork
        }
      }
      containers {
        image = local.placeholder
        args  = each.value.args
        env {
          name  = "NODE_ENV"
          value = "production"
        }
        env {
          name  = "APP_ENV"
          value = var.environment
        }
        env {
          name  = "APP_DB_ROLE"
          value = var.app_db_role
        }
        # Jobs load the full config; they do not call external services.
        dynamic "env" {
          for_each = merge(local.secret_env, { DATABASE_URL = each.value.db_secret })
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = env.value
                version = "latest"
              }
            }
          }
        }
        dynamic "env" {
          for_each = { for k, v in local.backend_env : k => v if !contains(["NODE_ENV", "APP_ENV"], k) }
          content {
            name  = env.key
            value = env.value
          }
        }
      }
    }
  }
  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }
}

resource "google_cloud_run_v2_job_iam_member" "scheduler" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.job["verify-chains"].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${var.service_accounts.scheduler}"
}

resource "google_cloud_scheduler_job" "verify_chains" {
  project     = var.project_id
  region      = var.region
  name        = "praxis-verify-chains-nightly"
  description = "Nightly hash-chain verification of the append-only dataset"
  schedule    = var.verify_cron
  time_zone   = "Etc/UTC"
  retry_config {
    retry_count = 3
  }
  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.job["verify-chains"].name}:run"
    oauth_token {
      service_account_email = var.service_accounts.scheduler
    }
  }
}
