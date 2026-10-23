/**
 * Auth Method 4: Google Cloud Run Identity-Aware Proxy (IAP) & Azure App Service EasyAuth
 *
 * When to use:
 *   - Customer hosts their intranet or proxy behind Google Cloud Run IAP, Azure App Service EasyAuth,
 *     or an OAuth2 reverse proxy (Envoy / Pomerium / oauth2-proxy).
 *
 * How it works:
 *   1. Browser sends requests with `credentials: "include"` (zero client-side token code required).
 *   2. Proxy inspects verified edge headers:
 *      - `X-Goog-Authenticated-User-Email: accounts.google.com:user@company.com` (Cloud Run IAP)
 *      - `X-MS-CLIENT-PRINCIPAL-NAME: user@company.com` (Azure EasyAuth)
 *      - `X-Forwarded-Email: user@company.com` (OAuth2 Proxy)
 *   3. Proxy strips the `accounts.google.com:` prefix, applies the Identity Transform Strategy,
 *      and executes the Discovery Engine `:streamAssist` / `:answer` call on behalf of the user.
 */

export const IAP_AUTH_HEADERS = Object.freeze({
  cloudRunIap: "X-Goog-Authenticated-User-Email",
  azureEasyAuth: "X-MS-CLIENT-PRINCIPAL-NAME",
  forwardedEmail: "X-Forwarded-Email"
});

export const CLOUDRUN_IAP_METADATA = IAP_AUTH_HEADERS;

export function parseIapIdentityHeader(rawHeader?: string | null): string {
  if (!rawHeader) {
    return "";
  }
  const cleaned = String(rawHeader)
    .replace(/^accounts\.google\.com:/i, "")
    .trim()
    .toLowerCase();
  return cleaned.includes("@") ? cleaned : "";
}

