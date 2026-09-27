# External HTTPS load balancer with Google-managed certificates and Cloud Armor.
#   app.<domain>     -> praxis-web       (/api/* -> praxis-api, so session cookies stay first-party)
#   experts.<domain> -> praxis-candidate (/api/* -> praxis-api)
#   api.<domain>     -> praxis-api       (webhooks, RL Gym)
locals {
  backends = var.services
}

resource "google_compute_global_address" "lb" {
  project = var.project_id
  name    = "praxis-lb"
}

resource "google_compute_region_network_endpoint_group" "neg" {
  for_each              = local.backends
  project               = var.project_id
  name                  = "praxis-${each.key}-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"
  cloud_run {
    service = each.value
  }
}

resource "google_compute_security_policy" "armor" {
  project = var.project_id
  name    = "praxis-armor"

  # Preconfigured WAF rules (OWASP): SQL injection, XSS, local file inclusion, remote code execution.
  dynamic "rule" {
    for_each = { 1000 = "sqli-v33-stable", 1001 = "xss-v33-stable", 1002 = "lfi-v33-stable", 1003 = "rce-v33-stable" }
    content {
      action   = "deny(403)"
      priority = rule.key
      match {
        expr {
          expression = "evaluatePreconfiguredWaf('${rule.value}', {'sensitivity': 1})"
        }
      }
      description = "WAF ${rule.value}"
    }
  }

  # Per-IP rate limit on everything; bursts from one address are throttled.
  rule {
    action   = "throttle"
    priority = 2000
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = var.rate_limit_per_minute
        interval_sec = 60
      }
    }
    description = "Per-IP rate limit"
  }

  rule {
    action   = "allow"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Default allow"
  }

  adaptive_protection_config {
    layer_7_ddos_defense_config {
      enable = true
    }
  }
}

resource "google_compute_backend_service" "backend" {
  for_each              = local.backends
  project               = var.project_id
  name                  = "praxis-${each.key}"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"
  security_policy       = google_compute_security_policy.armor.id
  backend {
    group = google_compute_region_network_endpoint_group.neg[each.key].id
  }
  log_config {
    enable      = true
    sample_rate = 1
  }
}

resource "google_compute_url_map" "https" {
  project         = var.project_id
  name            = "praxis-https"
  default_service = google_compute_backend_service.backend["web"].id

  host_rule {
    hosts        = [var.domains.console]
    path_matcher = "console"
  }
  host_rule {
    hosts        = [var.domains.candidate]
    path_matcher = "candidate"
  }
  host_rule {
    hosts        = [var.domains.api]
    path_matcher = "api"
  }

  path_matcher {
    name            = "console"
    default_service = google_compute_backend_service.backend["web"].id
    path_rule {
      paths   = ["/api/*"]
      service = google_compute_backend_service.backend["api"].id
    }
  }
  path_matcher {
    name            = "candidate"
    default_service = google_compute_backend_service.backend["candidate"].id
    path_rule {
      paths   = ["/api/*"]
      service = google_compute_backend_service.backend["api"].id
    }
  }
  path_matcher {
    name            = "api"
    default_service = google_compute_backend_service.backend["api"].id
  }
}

resource "google_compute_managed_ssl_certificate" "cert" {
  project = var.project_id
  name    = "praxis-cert"
  managed {
    domains = [var.domains.console, var.domains.candidate, var.domains.api]
  }
}

resource "google_compute_target_https_proxy" "https" {
  project          = var.project_id
  name             = "praxis-https"
  url_map          = google_compute_url_map.https.id
  ssl_certificates = [google_compute_managed_ssl_certificate.cert.id]
}

resource "google_compute_global_forwarding_rule" "https" {
  project               = var.project_id
  name                  = "praxis-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.lb.id
  port_range            = "443"
  target                = google_compute_target_https_proxy.https.id
}

# HTTP only redirects to HTTPS.
resource "google_compute_url_map" "redirect" {
  project = var.project_id
  name    = "praxis-http-redirect"
  default_url_redirect {
    https_redirect         = true
    strip_query            = false
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  project = var.project_id
  name    = "praxis-http-redirect"
  url_map = google_compute_url_map.redirect.id
}

resource "google_compute_global_forwarding_rule" "http" {
  project               = var.project_id
  name                  = "praxis-http"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.lb.id
  port_range            = "80"
  target                = google_compute_target_http_proxy.redirect.id
}
