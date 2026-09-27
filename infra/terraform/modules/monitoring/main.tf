# Uptime checks and alerts (SPEC): error rate, p95 latency, queue backlog, failed jobs, broken hash chain; budgets.
resource "google_monitoring_notification_channel" "email" {
  for_each     = toset(var.alert_emails)
  project      = var.project_id
  display_name = "Praxis alerts ${each.key}"
  type         = "email"
  labels = {
    email_address = each.key
  }
}

locals {
  channels = [for c in google_monitoring_notification_channel.email : c.id]
  uptime   = { console = { host = var.domains.console, path = "/login" }, candidate = { host = var.domains.candidate, path = "/sign-in" }, api = { host = var.domains.api, path = "/healthz" } }
}

resource "google_monitoring_uptime_check_config" "https" {
  for_each     = local.uptime
  project      = var.project_id
  display_name = "praxis-${each.key}"
  timeout      = "10s"
  period       = "60s"
  http_check {
    path         = each.value.path
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }
  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = each.value.host
    }
  }
}

resource "google_monitoring_alert_policy" "uptime" {
  project               = var.project_id
  display_name          = "Praxis: a public endpoint is down"
  combiner              = "OR"
  notification_channels = local.channels
  conditions {
    display_name = "Uptime check failing"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.host"]
      }
    }
  }
}

resource "google_monitoring_alert_policy" "error_rate" {
  project               = var.project_id
  display_name          = "Praxis: 5xx error rate above ${var.error_rate_threshold * 100}%"
  combiner              = "OR"
  notification_channels = local.channels
  conditions {
    display_name = "5xx ratio"
    condition_prometheus_query_language {
      query    = "sum by (service_name) (rate(run_googleapis_com:request_count{monitored_resource=\"cloud_run_revision\",response_code_class=\"5xx\"}[5m])) / sum by (service_name) (rate(run_googleapis_com:request_count{monitored_resource=\"cloud_run_revision\"}[5m])) > ${var.error_rate_threshold}"
      duration = "300s"
    }
  }
}

resource "google_monitoring_alert_policy" "latency" {
  project               = var.project_id
  display_name          = "Praxis: p95 latency above ${var.p95_latency_ms} ms"
  combiner              = "OR"
  notification_channels = local.channels
  conditions {
    display_name = "p95 request latency"
    condition_prometheus_query_language {
      query    = "histogram_quantile(0.95, sum by (le, service_name) (rate(run_googleapis_com:request_latencies_bucket{monitored_resource=\"cloud_run_revision\"}[5m]))) > ${var.p95_latency_ms}"
      duration = "600s"
    }
  }
}

# ── Log-based metrics from the worker and jobs (structured JSON logs) ──
resource "google_logging_metric" "queue_waiting" {
  project = var.project_id
  name    = "praxis_queue_waiting"
  filter  = "resource.type=\"cloud_run_revision\" AND jsonPayload.metric=\"queue_depth\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = "1"
  }
  value_extractor = "EXTRACT(jsonPayload.waiting)"
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 20
      growth_factor      = 2
      scale              = 1
    }
  }
}

resource "google_logging_metric" "chain_broken" {
  project = var.project_id
  name    = "praxis_hash_chain_broken"
  filter  = "jsonPayload.message=\"dataset hash chain broken\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_logging_metric" "alerts" {
  project = var.project_id
  name    = "praxis_alert_logs"
  filter  = "jsonPayload.alert=true"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_monitoring_alert_policy" "queue_backlog" {
  project               = var.project_id
  display_name          = "Praxis: queue backlog above ${var.queue_backlog_threshold}"
  combiner              = "OR"
  notification_channels = local.channels
  conditions {
    display_name = "Waiting jobs"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.queue_waiting.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = var.queue_backlog_threshold
      duration        = "600s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_PERCENTILE_99"
        cross_series_reducer = "REDUCE_MAX"
      }
    }
  }
}

resource "google_monitoring_alert_policy" "chain_broken" {
  project               = var.project_id
  display_name          = "Praxis: dataset hash chain broken"
  combiner              = "OR"
  notification_channels = local.channels
  severity              = "CRITICAL"
  conditions {
    display_name = "Hash chain verification found a break"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.chain_broken.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
}

resource "google_monitoring_alert_policy" "failed_jobs" {
  project               = var.project_id
  display_name          = "Praxis: failed jobs"
  combiner              = "OR"
  notification_channels = local.channels
  conditions {
    display_name = "Cloud Run job execution failed"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/job/completed_execution_count\" AND resource.type=\"cloud_run_job\" AND metric.label.result=\"failed\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
  conditions {
    display_name = "Worker or job logged an alert"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.alerts.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
}

# ── Budget alerts at 50%, 90% and 100% of the monthly budget ──
data "google_project" "this" {
  project_id = var.project_id
}

resource "google_billing_budget" "monthly" {
  count           = var.billing_account == "" ? 0 : 1
  billing_account = var.billing_account
  display_name    = "praxis-${var.project_id}"
  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }
  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.monthly_budget_usd)
    }
  }
  dynamic "threshold_rules" {
    for_each = [0.5, 0.9, 1.0]
    content {
      threshold_percent = threshold_rules.value
    }
  }
  all_updates_rule {
    monitoring_notification_channels = local.channels
    disable_default_iam_recipients   = false
  }
}
