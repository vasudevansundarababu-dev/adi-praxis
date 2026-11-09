# Offline (mock provider): plans without secret values, such as CI and the weekly drift check, keep every version.
mock_provider "google" {}

variables {
  project_id        = "test-project"
  github_repository = "owner/repo"
  private_buckets   = []
  infra_secret_ids  = []
}

run "first_apply_creates_a_version_per_secret" {
  command = plan
  variables {
    app_secret_values = {
      "google-oauth-client-id"         = "a"
      "stripe-secret-key"              = "b"
      "stripe-identity-webhook-secret" = "c"
      "smtp-password"                  = "d"
      "rl-gym-webhook-secret"          = "e"
    }
  }
  assert {
    condition     = length(google_secret_manager_secret_version.app) == 5
    error_message = "every application secret gets a version"
  }
}

run "plan_without_values_keeps_every_version" {
  command = plan
  assert {
    condition     = toset(keys(google_secret_manager_secret_version.app)) == toset(var.app_secret_names)
    error_message = "a plan without app_secret_values must not drop secret versions"
  }
}
