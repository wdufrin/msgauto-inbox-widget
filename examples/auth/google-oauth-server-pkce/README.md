# Pattern 2: Server-Side Google OAuth 2.0 + PKCE + Encrypted Refresh Token Cookie

## When to Use
Use this pattern when your intranet uses a proxy backend (`backends/node-proxy`) and you want **per-user ACL enforcement** in Gemini Enterprise **without hourly token expiration prompts**.

1. On the user's first search, if no encrypted session cookie (`ge_omnibar_google_oauth_session`) is present, `/api/search` returns `401 { "error": "google_oauth_required", "authUrl": "/api/auth/google/login?mode=popup&login_hint=..." }`.
2. `<gemini-omnibar>` automatically opens the OAuth popup (`/api/auth/google/login`), which initiates an **OAuth 2.0 Authorization Code + S256 PKCE** flow with `access_type=offline` and `login_hint=<corporate-email>`.
3. `/api/auth/google/callback` verifies the encrypted state cookie (`ge_omnibar_google_oauth_state`), exchanges the code for an `access_token` + `refresh_token`, verifies that the authenticated Google account matches the signed-in intranet user, and seals the tokens in an **AES-256-GCM encrypted `HttpOnly` cookie** (`ge_omnibar_google_oauth_session`, 30-day TTL).
4. Whenever the 1-hour `access_token` expires, the proxy transparently exchanges the `refresh_token` in the background and rotates the encrypted cookie—zero user interaction required.

## Configuration (`backends/node-proxy/.env`)

```bash
GCP_PROJECT_ID=your-gcp-project-id
GCP_LOCATION=global
GE_ENGINE_ID=your-gemini-engine-id
GE_WIDGET_CONFIG_ID=00000000-0000-0000-0000-000000000000

GOOGLE_OAUTH_CLIENT_ID=123456789-xxxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxx
GOOGLE_OAUTH_REDIRECT_URI=https://intranet.company.com/api/auth/google/callback
GOOGLE_OAUTH_COOKIE_SECRET=generate-a-32-byte-random-secret
```

## Endpoints Provided by `backends/node-proxy`
- `GET /api/auth/google/login?login_hint=<email>&mode=popup`
- `GET /api/auth/google/callback`
- `GET /api/auth/google/status`
- `POST /api/auth/google/logout`
