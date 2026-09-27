output "url_secret_id" { value = google_secret_manager_secret.url.secret_id }
output "host" { value = google_redis_instance.redis.host }
