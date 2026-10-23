/**
 * Auth Method 2: Microsoft Entra ID (MSAL v2/v3/v4) + GCP Workforce Identity Federation (WIF)
 *
 * When to use:
 *   - Customer intranet is built on SharePoint Online, React + `@azure/msal-browser`, or .NET with Entra ID.
 *   - Customer uses GCP Workforce Identity Federation (`GE_STS_AUDIENCE`) or per-user Google OAuth (`login_hint`).
 *
 * How it works:
 *   1. Auto-discovers the active MSAL account and ID/Access JWT from `sessionStorage`/`localStorage`
 *      (`msal.1.account.keys`, `msal.account.keys`, `*.token.keys.*`) or `window.__geEntraAuth`.
 *   2. Applies the configured Identity Transform Strategy (e.g. `domain_rewrite` from `@nam.corp.company.com`
 *      to `first.last@company.com`).
 *   3. Attaches `Authorization: Bearer <Entra-JWT>` and `X-User-Email` to `/api/search`, where the backend proxy
 *      exchanges the Entra JWT at `https://sts.googleapis.com/v1/token` (`exchangeEntraTokenForGoogleToken`).
 */

export {
  msalAccountFromStorage,
  msalTokenFromStorage,
  discoverBrowserIdentity,
  getIdpAccessToken
} from "../../auth-adapters";
