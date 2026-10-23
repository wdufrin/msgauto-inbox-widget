# Gemini Enterprise Omnibar (`<gemini-omnibar>`)

A zero-dependency, customer-agnostic **Shadow DOM Web Component (`<gemini-omnibar>`)** and multi-auth micro-proxy for embedding **Gemini Enterprise (Agentspace / Vertex AI Discovery Engine)** inline on any corporate intranet (SharePoint, Adobe Experience Manager, React, ServiceNow, or static HTML).

## Why Teams Use This Asset

Google's out-of-the-box `<gen-search-widget>` is a modal overlay. `<gemini-omnibar>` provides:
1. **Inline Pill Bar + Expand-Down Conversation Drawer**: Matches the native Gemini Enterprise dark/light aesthetic with an `Auto ⌄` (`:streamAssist` multi-turn) vs. `Quick` (`:answer` single-shot) mode selector, grounded `[1]` citation badges, and zero CSS collisions via Shadow DOM.
2. **Seamless Deep-Link Session Handoff**: Creates a persisted Discovery Engine session (`POST .../sessions`), synchronizes `userPseudoId` to the numeric session ID via `PATCH ?updateMask=userPseudoId`, and builds the **"Open in Gemini Enterprise App ↗"** link (`/u/0/home/cid/<CID>/r/session/<SESSION_ID>`) so users can continue their multi-turn conversation in the full Gemini Enterprise web app.
3. **3 Layout Variants (`large`, `small`, `icon`)**:
   - `variant="large"` (Default): Full-width hero search bar (`max-width: 780px`, `56px` height) with inline `Auto ⌄` (`:streamAssist`) / `Quick` (`:answer`) mode selector.
   - `variant="small"`: Compact header/navbar search bar (`max-width: 360px`, `40px` height) with a floating `520px` conversation drawer.
   - `variant="icon"`: `40×40px` circular Gemini sparkle button that smoothly expands (`340px`) on click and collapses on `Escape`.
4. **Pluggable Enterprise Identity & Auth Modes**:
   - **Topology A — 100% Serverless / Browser-Direct (`mode="direct"`)**: Uses Google Identity Services (`initTokenClient` with `login_hint` auto-detected from Entra MSAL / Okta / OIDC) to call Discovery Engine directly from the browser with zero backend infrastructure.
   - **Topology B — Lightweight Proxy (`mode="proxy"`)**: Drop-in Node.js, Python FastAPI, or ASP.NET Core proxy supporting:
     - **Pattern 1**: Browser Per-User Google OAuth 2.0 (`X-Google-Access-Token` via GIS).
     - **Pattern 2**: Server-Side Per-User Google OAuth 2.0 Authorization Code + S256 PKCE + AES-256-GCM Encrypted `HttpOnly` Refresh Token Cookie (`/api/auth/google/login` & `/api/auth/google/callback`).
     - **Pattern 3**: Workforce Identity Federation (WIF STS token exchange from Entra / Okta JWT).
     - **Pattern 4**: Cloud Run IAP (`X-Goog-Authenticated-User-Email`) / Azure EasyAuth headers.
     - **Pattern 5**: Service Account ADC / Domain-Wide Delegation.
   - **Configurable Identity Transform Strategies**: `passthrough` (`user@company.com`), `domain_rewrite` (`@corp.company.com` $\rightarrow$ `@company.com`), or `claim_template` (`{given_name}.{family_name}@company.com`).

---

## Quick Start (2 Lines of HTML)

### Option 1: Proxy-Backed Mode (`large`, `small`, or `icon`)
```html
<script src="https://your-cloud-run-service.a.run.app/gemini-omnibar.js" defer></script>

<!-- Hero search bar (variant="large"), compact navbar (variant="small"), or icon trigger (variant="icon") -->
<gemini-omnibar
  api-url="https://your-cloud-run-service.a.run.app"
  variant="large"
  placeholder="Ask Gemini Enterprise"
  theme="dark"
  default-mode="streamAssist">
</gemini-omnibar>
```

### Option 2: 100% Serverless Browser-Direct Mode (No Backend Required)
```html
<script src="https://cdn.your-team.dev/gemini-omnibar.js" defer></script>

<gemini-omnibar
  mode="direct"
  variant="large"
  project-id="your-gcp-project-id"
  location="global"
  engine-id="your-gemini-engine-id"
  widget-config-id="00000000-0000-0000-0000-000000000000"
  google-client-id="123456789-xxxx.apps.googleusercontent.com"
  placeholder="Ask Gemini Enterprise"
  theme="dark">
</gemini-omnibar>
```

---

## Repository Layout

```text
.
├── packages/
│   └── omnibar-wc/                 # Zero-dependency TypeScript Web Component (<gemini-omnibar>)
│       ├── src/
│       │   ├── gemini-omnibar.ts   # CustomElement + Shadow DOM + dark/light pill CSS + drawer
│       │   ├── variants/           # Layout variants: large.ts, small.ts, icon.ts
│       │   ├── markdown.ts         # Regex Pattern Matching XSS-safe markdown + [1] citation renderer
│       │   ├── auth-adapters.ts    # Identity strategies + Entra MSAL, Okta, OIDC, Google GIS + PKCE popup
│       │   └── direct-client.ts    # Browser-direct Discovery Engine REST client
│       └── dist/
│           └── gemini-omnibar.js   # Single-file drop-in bundle
├── backends/
│   ├── node-proxy/                 # Standalone Node server, Express middleware, PKCE OAuth & Dockerfile
│   ├── python-fastapi/             # Drop-in FastAPI router for Python teams
│   └── dotnet-controller/          # Drop-in ASP.NET Core controller for C# teams
├── deploy/
│   ├── cloudrun-iap.sh             # 1-command Cloud Run deployment script
│   └── terraform/                  # Terraform module (Cloud Run + IAM + WIF)
├── examples/
│   ├── static-intranet-demo.html   # Interactive Intranet Hub showcasing large, small, and icon variants
│   ├── auth/                       # Step-by-step guides for all 6 enterprise auth & identity patterns
│   ├── variants/                   # Variant integration snippets (large, small, icon)
│   ├── react-example/              # React TypeScript wrapper component
│   └── sharepoint-spfx/            # SharePoint Online SPFx WebPart snippet
└── test/
    └── gemini-omnibar.test.ts      # Unit, Shadow DOM, & adversarial security test suite (27 tests)
```

## Local Development & Verification

```bash
# 1. Copy .env.example to .env and fill in your GCP_PROJECT_ID and GE_ENGINE_ID
cp .env.example .env

# 2. Install dev dependencies, build bundle, and run test suite
npm install
npm run build
npm test

# 3. Launch local interactive playground at http://localhost:8080
npm start
```

