output "buckets" {
  value = merge({ for k, b in google_storage_bucket.private : k => b.name }, { brand = google_storage_bucket.brand.name })
}
