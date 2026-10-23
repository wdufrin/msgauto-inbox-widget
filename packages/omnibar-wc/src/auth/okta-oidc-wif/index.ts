/**
 * Auth Method 3: Okta & Generic OIDC + GCP Workforce Identity Federation (WIF)
 *
 * When to use:
 *   - Customer portal authenticates via Okta Auth JS SDK (`okta-token-storage`) or standard OIDC cookies
 *     (`ge_id_token`, `id_token`, `access_token`).
 *
 * How it works:
 *   1. Reads `okta-token-storage` from `localStorage`/`sessionStorage` or decodes OIDC JWT cookies.
 *   2. Extracts `email`, `preferred_username`, `given_name`, `family_name`, and raw JWT.
 *   3. Sends `Authorization: Bearer <Okta/OIDC-JWT>` to the proxy for GCP WIF STS token exchange,
 *      or passes `email` as `login_hint` to Google Identity Services in Serverless Direct Mode.
 */

export {
  oktaTokenFromStorage,
  decodeJwtPayload,
  readBrowserCookie
} from "../../auth-adapters";
