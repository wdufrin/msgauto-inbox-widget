# Auth Method 3: Okta & Generic OIDC + GCP Workforce Identity Federation (WIF)

## When to Use
- Customer portal uses **Okta** (`@okta/okta-auth-js`) or a generic OIDC provider (PingFederate, Auth0, Keycloak) storing tokens in `okta-token-storage` or cookies (`ge_id_token`, `id_token`, `access_token`).

## How Identity & Token Resolution Works
1. **Browser Discovery**: [`oktaTokenFromStorage()`](../../../packages/omnibar-wc/src/auth-adapters.ts) inspects `localStorage` and `sessionStorage` for `okta-token-storage` (extracting `idToken` / `accessToken` and user claims `email`, `given_name`, `family_name`), falling back to OIDC JWT cookies.
2. **WIF STS Exchange**: `<gemini-omnibar>` sends `Authorization: Bearer <Okta-JWT>` to `POST /api/search`, where the proxy exchanges the token against `https://sts.googleapis.com/v1/token` using `GE_STS_AUDIENCE`.

## Implementation

```bash
# Proxy .env
GE_STS_AUDIENCE=//iam.googleapis.com/locations/global/workforcePools/okta-pool/providers/okta-oidc
GE_IDENTITY_STRATEGY=passthrough
```

```html
<gemini-omnibar
  api-url="https://your-proxy.a.run.app"
  theme="dark">
</gemini-omnibar>
```
