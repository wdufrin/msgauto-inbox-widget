output "service_url" {
  description = "Cloud Run URL for the Gemini Enterprise Omnibar proxy and script bundle."
  value       = google_cloud_run_v2_service.omnibar_proxy.uri
}

output "embed_snippet" {
  description = "HTML snippet to embed <gemini-omnibar> on any customer intranet page."
  value       = <<-EOT
    <script src="${google_cloud_run_v2_service.omnibar_proxy.uri}/gemini-omnibar.js" defer></script>
    <gemini-omnibar api-url="${google_cloud_run_v2_service.omnibar_proxy.uri}" theme="dark" placeholder="Ask Gemini Enterprise"></gemini-omnibar>
  EOT
}
