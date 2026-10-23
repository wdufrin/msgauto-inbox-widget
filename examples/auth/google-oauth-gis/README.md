# Auth Method 1: Per-User Google OAuth 2.0 via Google Identity Services (`login_hint`)

## When to Use
- Customer users have **Google Workspace** or **Google Cloud Identity** accounts (`first.last@company.com`), even when their primary IdP is Microsoft Entra ID or Okta (federated SSO).
- Works in **both** Topology A (`mode="direct"` zero-backend) and Topology B (`mode="proxy"`).

## How Identity & Token Resolution Works
1. `<gemini-omnibar>` inspects the browser session (MSAL, Okta, or cookie) to resolve the user's Cloud Identity email (e.g., `jane.doe@company.com`).
2. `<gemini-omnibar>` loads `https://accounts.google.com/gsi/client` and invokes `google.accounts.oauth2.initTokenClient` with `hint: "jane.doe@company.com"` and `prompt: ""` (silent token fetch), falling back to `prompt: "select_account"` only if consent is needed.
3. The resulting `ya29...` access token is cached in `sessionStorage` (`ge_omnibar_google_oauth`) bound to `jane.doe@company.com` (preventing cross-user cache reuse) and sent either directly to `discoveryengine.googleapis.com` (`mode="direct"`) or via `X-Google-Access-Token` to the proxy (`mode="proxy"`).

## Implementation

```html
<gemini-omnibar
  mode="direct"
  project-id="your-gcp-project-id"
  location="global"
  engine-id="your-gemini-engine-id"
  widget-config-id="00000000-0000-0000-0000-000000000000"
  google-client-id="123456789-xxxx.apps.googleusercontent.com"
  identity-strategy="domain_rewrite"
  identity-domain="company.com"
  identity-source-domain="corp.company.com">
</gemini-omnibar>
```
