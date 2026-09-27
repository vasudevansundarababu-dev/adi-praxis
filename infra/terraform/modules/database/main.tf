# Cloud SQL for PostgreSQL 16 (pgvector is created by the first migration). Private IP only, PITR, 30-day backups.
# Two users: `praxis_migrator` owns the schema (migrations job), `praxis_app` is the runtime role and receives
# only the grants in apps/api/src/jobs/grant-app-role.ts (no UPDATE/DELETE on append-only tables).
resource "google_sql_database_instance" "db" {
  project             = var.project_id
  name                = "praxis-${var.environment}"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = var.deletion_protection

  settings {
    tier              = var.tier
    edition           = "ENTERPRISE"
    availability_type = var.high_availability ? "REGIONAL" : "ZONAL"
    disk_autoresize   = true
    disk_type         = "PD_SSD"

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = var.network_id
      enable_private_path_for_google_cloud_services = true
      ssl_mode                                      = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "02:00"
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 30
        retention_unit   = "COUNT"
      }
    }

    maintenance_window {
      day  = 7
      hour = 3
    }

    insights_config {
      query_insights_enabled = true
    }

    database_flags {
      name  = "log_min_duration_statement"
      value = "1000"
    }
  }

  depends_on = [var.private_services_connection]
}

resource "google_sql_database" "praxis" {
  project  = var.project_id
  instance = google_sql_database_instance.db.name
  name     = "praxis"
}

resource "random_password" "migrator" {
  length  = 32
  special = false
}

resource "random_password" "app" {
  length  = 32
  special = false
}

resource "google_sql_user" "migrator" {
  project  = var.project_id
  instance = google_sql_database_instance.db.name
  name     = "praxis_migrator"
  password = random_password.migrator.result
}

resource "google_sql_user" "app" {
  project  = var.project_id
  instance = google_sql_database_instance.db.name
  name     = "praxis_app"
  password = random_password.app.result
}

locals {
  host = google_sql_database_instance.db.private_ip_address
  urls = {
    "database-url-app"       = "postgresql://praxis_app:${random_password.app.result}@${local.host}:5432/praxis?sslmode=require"
    "database-url-migration" = "postgresql://praxis_migrator:${random_password.migrator.result}@${local.host}:5432/praxis?sslmode=require"
  }
}

resource "google_secret_manager_secret" "url" {
  for_each  = local.urls
  project   = var.project_id
  secret_id = each.key
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "url" {
  for_each    = local.urls
  secret      = google_secret_manager_secret.url[each.key].id
  secret_data = each.value
}
