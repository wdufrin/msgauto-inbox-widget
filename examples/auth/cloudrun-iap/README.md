# Auth Method 4: Cloud Run Identity-Aware Proxy (IAP) & Azure App Service EasyAuth

## When to Use
- Customer deploys the intranet or proxy behind **Google Cloud Run IAP**, **Azure App Service EasyAuth**, or an **OAuth2 Reverse Proxy** (`oauth2-proxy`, Envoy).

## How Identity & Token Resolution Works
1. `<gemini-omnibar>` issues `fetch()` requests with `credentials: "include"`.
2. The load balancer / reverse proxy injects verified identity headers on every request:
   - **Cloud Run IAP**: `X-Goog-Authenticated-User-Email: accounts.google.com:jane.doe@company.com`
   - **Azure EasyAuth**: `X-MS-CLIENT-PRINCIPAL-NAME: jane.doe@company.com`
   - **OAuth2 Proxy**: `X-Forwarded-Email: jane.doe@company.com`
3. [`resolveSignedInUserEmail()`](../../../backends/node-proxy/index.js) in the backend proxy extracts the verified email, strips `accounts.google.com:`, applies any configured identity rewrite, and executes the Discovery Engine call.

## Implementation

Deploy with a single command using [`deploy/cloudrun-iap.sh`](../../../deploy/cloudrun-iap.sh):
```bash
GCP_PROJECT_ID="your-gcp-project-id" \
GE_ENGINE_ID="your-gemini-engine-id" \
GE_WIDGET_CONFIG_ID="00000000-0000-0000-0000-000000000000" \
./deploy/cloudrun-iap.sh
```
