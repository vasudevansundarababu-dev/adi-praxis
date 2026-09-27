output "services" {
  value = {
    api       = google_cloud_run_v2_service.api.name
    worker    = google_cloud_run_v2_service.worker.name
    web       = google_cloud_run_v2_service.front["web"].name
    candidate = google_cloud_run_v2_service.front["candidate"].name
  }
}
output "api_uri" { value = google_cloud_run_v2_service.api.uri }
output "jobs" { value = { for k, j in google_cloud_run_v2_job.job : k => j.name } }
