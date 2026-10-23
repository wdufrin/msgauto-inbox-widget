# Auth Method 2: Microsoft Entra ID (MSAL v2/v3/v4) + GCP Workforce Identity Federation (WIF)

## When to Use
- Customer intranet uses **Microsoft Entra ID (Azure AD)** with `@azure/msal-browser`, SharePoint Online (SPFx), or ASP.NET EasyAuth.
- Customer has configured a **GCP Workforce Identity Pool & Provider** trusting their Entra tenant.

## How Identity & Token Resolution Works
1. **Browser Discovery**: [`msalAccountFromStorage()`](../../../packages/omnibar-wc/src/auth-adapters.ts) and [`msalTokenFromStorage()`](../../../packages/omnibar-wc/src/auth-adapters.ts) automatically scan `sessionStorage` and `localStorage` for MSAL v2/v3/v4 keys (`msal.1.account.keys`, `msal.account.keys`, `*.token.keys.*`) or call `window.__geEntraAuth.getToken()`.
2. **Header Propagation**: `<gemini-omnibar>` attaches `Authorization: Bearer <Entra-JWT>` and `X-User-Email: <resolved-email>` to `POST /api/search`.
3. **WIF STS Exchange**: The backend proxy calls [`exchangeEntraTokenForGoogleToken()`](../../../backends/node-proxy/index.js) (`POST https://sts.googleapis.com/v1/token` with `GE_STS_AUDIENCE`) to exchange the user's Entra JWT for a user-scoped Google Cloud access token that enforces per-user Discovery Engine ACLs.

## Implementation

### 1. Proxy Environment Variables (`.env` / Cloud Run)
```bash
GCP_PROJECT_ID=your-gcp-project-id
GE_ENGINE_ID=your-gemini-engine-id
GE_WIDGET_CONFIG_ID=00000000-0000-0000-0000-000000000000
GE_STS_AUDIENCE=//iam.googleapis.com/locations/global/workforcePools/entra-pool/providers/entra-oidc
GE_IDENTITY_STRATEGY=domain_rewrite
GE_IDENTITY_DOMAIN=company.com
GE_IDENTITY_SOURCE_DOMAIN=corp.company.com
```

### 2. HTML Snippet
```html
<gemini-omnibar
  api-url="https://your-proxy.a.run.app"
  identity-strategy="domain_rewrite"
  identity-domain="company.com"
  identity-source-domain="corp.company.com"
  theme="dark">
</gemini-omnibar>
```
