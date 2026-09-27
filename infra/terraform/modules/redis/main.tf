# Memorystore for Redis (BullMQ queues and rate limits). Private service access only, AUTH required.
# Transit encryption is off because the instance is reachable only inside the VPC (see docs/DECISIONS.md, M8).
resource "google_redis_instance" "redis" {
  project                 = var.project_id
  name                    = "praxis-${var.environment}"
  region                  = var.region
  tier                    = var.tier
  memory_size_gb          = var.memory_size_gb
  redis_version           = "REDIS_7_2"
  authorized_network      = var.network_id
  connect_mode            = "PRIVATE_SERVICE_ACCESS"
  auth_enabled            = true
  transit_encryption_mode = "DISABLED"
  redis_configs = {
    maxmemory-policy = "noeviction" # BullMQ requires it
  }
  depends_on = [var.private_services_connection]
}

resource "google_secret_manager_secret" "url" {
  project   = var.project_id
  secret_id = "redis-url"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "url" {
  secret      = google_secret_manager_secret.url.id
  secret_data = "redis://:${google_redis_instance.redis.auth_string}@${google_redis_instance.redis.host}:${google_redis_instance.redis.port}"
}
