#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# 1-Command Cloud Run Deployment Script for Gemini Enterprise Omnibar Proxy
# ============================================================================
# Usage:
#   GCP_PROJECT_ID="your-gcp-project-id" \
#   GE_ENGINE_ID="your-gemini-engine-id" \
#   GE_WIDGET_CONFIG_ID="00000000-0000-0000-0000-000000000000" \
#   ./deploy/cloudrun-iap.sh

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID to your Google Cloud project ID}"
REGION="${GCP_REGION:-us-central1}"
LOCATION="${GCP_LOCATION:-global}"
ENGINE_ID="${GE_ENGINE_ID:?Set GE_ENGINE_ID to your Discovery Engine / Agentspace app ID}"
WIDGET_CONFIG_ID="${GE_WIDGET_CONFIG_ID:-default_search_widget_config}"
SERVICE_NAME="${SERVICE_NAME:-gemini-omnibar-proxy}"
IDENTITY_STRATEGY="${GE_IDENTITY_STRATEGY:-passthrough}"
IDENTITY_DOMAIN="${GE_IDENTITY_DOMAIN:-}"

echo "==> Building <gemini-omnibar> Web Component bundle..."
npm run build

echo "==> Deploying ${SERVICE_NAME} to Cloud Run (${PROJECT_ID} / ${REGION})..."
gcloud run deploy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --source="." \
  --dockerfile="backends/node-proxy/Dockerfile" \
  --set-env-vars="GCP_PROJECT_ID=${PROJECT_ID},GCP_LOCATION=${LOCATION},GE_ENGINE_ID=${ENGINE_ID},GE_WIDGET_CONFIG_ID=${WIDGET_CONFIG_ID},GE_IDENTITY_STRATEGY=${IDENTITY_STRATEGY},GE_IDENTITY_DOMAIN=${IDENTITY_DOMAIN}" \
  --allow-unauthenticated

SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" --project="${PROJECT_ID}" --region="${REGION}" --format='value(status.url)')"

echo ""
echo "✅ Deployed! Drop these two lines into any intranet page:"
echo ""
echo "<script src=\"${SERVICE_URL}/gemini-omnibar.js\" defer></script>"
echo "<gemini-omnibar api-url=\"${SERVICE_URL}\" theme=\"dark\" placeholder=\"Ask Gemini Enterprise\"></gemini-omnibar>"
