/**
 * Auth Method 5: Service Account ADC & Domain-Wide Delegation (`GE_IMPERSONATE_USER`)
 *
 * When to use:
 *   - Backend-to-backend integration where the proxy runs with a Google Cloud Service Account
 *     (`GOOGLE_APPLICATION_CREDENTIALS` or Cloud Run Metadata Server).
 *   - Optional Domain-Wide Delegation (`GE_IMPERSONATE_USER=true`) allows the service account to
 *     mint user-impersonated RS256 JWT assertions (`sub: user@company.com`) so Discovery Engine
 *     enforces per-user document ACLs without browser popups.
 */

export const SERVICE_ACCOUNT_DWD_ENV = Object.freeze({
  credentialsPath: "GOOGLE_APPLICATION_CREDENTIALS",
  impersonateUser: "GE_IMPERSONATE_USER"
});

export const SERVICE_ACCOUNT_DWD_METADATA = SERVICE_ACCOUNT_DWD_ENV;

