# One environment of ADI Praxis, composed from the concern modules. envs/staging and envs/production call this with
# their own settings; nothing is created by hand.
locals {
  apis = [
    "run.googleapis.com", "sqladmin.googleapis.com", "redis.googleapis.com", "compute.googleapis.com",
    "servicenetworking.googleapis.com", "secretmanager.googleapis.com", "artifactregistry.googleapis.com",
    "containerscanning.googleapis.com", "cloudscheduler.googleapis.com", "aiplatform.googleapis.com",
    "iam.googleapis.com", "iamcredentials.googleapis.com", "sts.googleapis.com", "monitoring.googleapis.com",
    "logging.googleapis.com", "cloudtrace.googleapis.com", "clouderrorreporting.googleapis.com",
    "cloudbilling.googleapis.com", "billingbudgets.googleapis.com", "storage.googleapis.com",
  ]
}

resource "google_project_service" "api" {
  for_each           = toset(local.apis)
  project            = var.project_id
  service            = each.key
  disable_on_destroy = false
}

module "network" {
  source     = "../network"
  project_id = var.project_id
  region     = var.region
  depends_on = [google_project_service.api]
}

module "database" {
  source                      = "../database"
  project_id                  = var.project_id
  region                      = var.region
  environment                 = var.environment
  network_id                  = module.network.network_id
  private_services_connection = module.network.private_services_connection
  tier                        = var.database.tier
  high_availability           = var.database.high_availability
  deletion_protection         = var.deletion_protection
}

module "redis" {
  source                      = "../redis"
  project_id                  = var.project_id
  region                      = var.region
  environment                 = var.environment
  network_id                  = module.network.network_id
  private_services_connection = module.network.private_services_connection
  tier                        = var.redis_tier
}

module "storage" {
  source                  = "../storage"
  project_id              = var.project_id
  location                = var.region
  evidence_retention_days = var.evidence_retention_days
  depends_on              = [google_project_service.api]
}

module "registry" {
  source     = "../registry"
  project_id = var.project_id
  region     = var.region
  depends_on = [google_project_service.api]
}

module "iam" {
  source            = "../iam"
  project_id        = var.project_id
  github_repository = var.github_repository
  private_buckets   = [for k, b in module.storage.buckets : b if k != "brand"]
  infra_secret_ids  = [module.database.app_url_secret_id, module.database.migration_url_secret_id, module.redis.url_secret_id]
  app_secret_values = var.app_secret_values
  depends_on        = [google_project_service.api]
}

module "run" {
  source              = "../run-services"
  project_id          = var.project_id
  region              = var.region
  environment         = var.environment
  network_id          = module.network.network_id
  subnet_id           = module.network.subnet_id
  service_accounts    = module.iam.service_accounts
  domains             = var.domains
  buckets             = module.storage.buckets
  secret_ids          = { database_url_app = module.database.app_url_secret_id, database_url_migration = module.database.migration_url_secret_id, redis_url = module.redis.url_secret_id }
  app_db_role         = module.database.app_role
  smtp                = var.smtp
  rl_gym_webhook_url  = var.rl_gym_webhook_url
  scaling             = var.scaling
  deletion_protection = var.deletion_protection
  depends_on          = [module.iam]
}

module "edge" {
  source     = "../edge"
  project_id = var.project_id
  region     = var.region
  services   = { web = module.run.services.web, candidate = module.run.services.candidate, api = module.run.services.api }
  domains    = var.domains
}

module "monitoring" {
  source             = "../monitoring"
  project_id         = var.project_id
  domains            = var.domains
  alert_emails       = var.alert_emails
  billing_account    = var.billing_account
  monthly_budget_usd = var.monthly_budget_usd
  depends_on         = [google_project_service.api]
}
