output "instance_name" { value = google_sql_database_instance.db.name }
output "connection_name" { value = google_sql_database_instance.db.connection_name }
output "private_ip" { value = google_sql_database_instance.db.private_ip_address }
output "app_url_secret_id" { value = google_secret_manager_secret.url["database-url-app"].secret_id }
output "migration_url_secret_id" { value = google_secret_manager_secret.url["database-url-migration"].secret_id }
output "app_role" { value = google_sql_user.app.name }
