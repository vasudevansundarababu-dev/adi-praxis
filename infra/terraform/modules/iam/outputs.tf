output "service_accounts" { value = { for k, sa in google_service_account.sa : k => sa.email } }
output "deployer_email" { value = google_service_account.deployer.email }
output "workload_identity_provider" { value = google_iam_workload_identity_pool_provider.github.name }
output "planner_email" { value = google_service_account.planner.email }
