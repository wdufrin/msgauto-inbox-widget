# Auth Method 5: Service Account ADC & Domain-Wide Delegation (`GE_IMPERSONATE_USER`)

## When to Use
- Customer wants zero browser OAuth prompts and runs the backend proxy with a Google Cloud **Service Account** (`GOOGLE_APPLICATION_CREDENTIALS` or Cloud Run default service account).
- When `GE_IMPERSONATE_USER=true` is set with a service account JSON key that has Google Workspace Domain-Wide Delegation enabled, the proxy signs an RS256 JWT assertion with `sub: <resolvedUserEmail>` so Discovery Engine enforces per-user ACLs server-side.

## Implementation

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/secrets/omnibar-sa-key.json"
export GE_IMPERSONATE_USER="true"
export GCP_PROJECT_ID="your-gcp-project-id"
export GE_ENGINE_ID="your-gemini-engine-id"
export GE_WIDGET_CONFIG_ID="00000000-0000-0000-0000-000000000000"
```
