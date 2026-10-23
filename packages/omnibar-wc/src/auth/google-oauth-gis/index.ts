/**
 * Auth Method 1: Per-User Google OAuth 2.0 via Google Identity Services (GIS)
 *
 * When to use:
 *   - Customer users have Google Workspace or Cloud Identity accounts (even if federated with Entra/Okta SSO).
 *   - Supports both Topology A (100% Serverless Direct Browser->GCP) and Topology B (Proxy passthrough).
 *
 * How it works:
 *   1. Discovers the user's corporate email from Entra MSAL, Okta, or cookie (`first.last@company.com`).
 *   2. Passes that email as `hint` (`login_hint`) to `google.accounts.oauth2.initTokenClient`.
 *   3. Attempts silent token acquisition (`prompt: ""`), falling back to account chooser (`prompt: "select_account"`).
 *   4. Caches the `ya29...` token in `sessionStorage` bound to the user's email (rejecting cross-user cache hits).
 */

export {
  loadGoogleIdentityServices,
  readCachedGoogleOAuth,
  saveCachedGoogleOAuth,
  resolveGoogleClientId,
  getGoogleOAuthToken
} from "../../auth-adapters";
