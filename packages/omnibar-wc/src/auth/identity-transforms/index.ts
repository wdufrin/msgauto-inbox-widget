/**
 * Pluggable Identity Transform Strategies (`passthrough`, `domain_rewrite`, `claim_template`)
 *
 * Solves enterprise UPN mismatches between corporate IdPs (Entra AD / Okta) and Google Cloud Identity:
 *   1. `passthrough` (default): `jane.doe@company.com` -> `jane.doe@company.com`
 *   2. `domain_rewrite`: `abc123@nam.corp.company.com` + claims (`Jane`, `Doe`) -> `jane.doe@company.com`
 *      or `jdoe@emea.corp.company.com` -> `jdoe@company.com`
 *   3. `claim_template`: `{given_name}.{family_name}@{domain}` -> `jane.doe@company.com`
 */

export {
  IdentityStrategy,
  IdentityConfig,
  DiscoveredIdentity,
  slugNamePart,
  parseNamesFromDisplayName,
  mailboxFromNames,
  resolveCloudIdentityEmail
} from "../../auth-adapters";
