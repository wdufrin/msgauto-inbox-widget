variable "project_id" {
  description = "GCP project ID hosting the Gemini Enterprise (Discovery Engine) app."
  type        = string
}

variable "region" {
  description = "Cloud Run deployment region."
  type        = string
  default     = "us-central1"
}

variable "service_name" {
  description = "Cloud Run service name."
  type        = string
  default     = "gemini-omnibar-proxy"
}

variable "container_image" {
  description = "Container image URI built from backends/node-proxy/Dockerfile."
  type        = string
}

variable "discovery_engine_location" {
  description = "Discovery Engine multi-region location (global, us, eu)."
  type        = string
  default     = "global"
}

variable "engine_id" {
  description = "Gemini Enterprise / Agentspace Engine ID."
  type        = string
}

variable "widget_config_id" {
  description = "Gemini Enterprise Widget Config ID (CID) used for deep-link handoff."
  type        = string
}

variable "identity_strategy" {
  description = "Identity transform strategy: passthrough, domain_rewrite, or claim_template."
  type        = string
  default     = "passthrough"
}

variable "identity_domain" {
  description = "Target Cloud Identity domain when using domain_rewrite or claim_template."
  type        = string
  default     = ""
}

variable "wif_sts_audience" {
  description = "Optional Workforce Identity Federation STS audience."
  type        = string
  default     = ""
}

variable "google_oauth_client_id" {
  description = "Optional Google OAuth 2.0 Web Client ID for GIS login_hint."
  type        = string
  default     = ""
}
