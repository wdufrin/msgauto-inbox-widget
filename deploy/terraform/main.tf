terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0"
    }
  }
}

resource "google_service_account" "omnibar_proxy" {
  project      = var.project_id
  account_id   = "${var.service_name}-sa"
  display_name = "Gemini Enterprise Omnibar Proxy Service Account"
}

resource "google_project_iam_member" "discovery_engine_user" {
  project = var.project_id
  role    = "roles/discoveryengine.user"
  member  = "serviceAccount:${google_service_account.omnibar_proxy.email}"
}

resource "google_cloud_run_v2_service" "omnibar_proxy" {
  name     = var.service_name
  location = var.region
  project  = var.project_id
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.omnibar_proxy.email

    containers {
      image = var.container_image

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GCP_LOCATION"
        value = var.discovery_engine_location
      }
      env {
        name  = "GE_ENGINE_ID"
        value = var.engine_id
      }
      env {
        name  = "GE_WIDGET_CONFIG_ID"
        value = var.widget_config_id
      }
      env {
        name  = "GE_IDENTITY_STRATEGY"
        value = var.identity_strategy
      }
      env {
        name  = "GE_IDENTITY_DOMAIN"
        value = var.identity_domain
      }
      env {
        name  = "GE_STS_AUDIENCE"
        value = var.wif_sts_audience
      }
      env {
        name  = "GOOGLE_OAUTH_CLIENT_ID"
        value = var.google_oauth_client_id
      }
    }
  }
}
