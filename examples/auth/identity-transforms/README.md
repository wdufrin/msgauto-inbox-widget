# Identity Transform Strategies (`passthrough`, `domain_rewrite`, `claim_template`)

Enterprise customers frequently have a mismatch between their internal Active Directory / Entra ID UPN (e.g., `abc123@nam.corp.company.com`) and their Google Cloud Identity email (`jane.doe@company.com`).

`<gemini-omnibar>` and all backend proxies support three declarative strategies out of the box:

| Strategy | Input Identity / Claims | Configuration | Output Cloud Identity Email |
| :--- | :--- | :--- | :--- |
| **`passthrough`** *(default)* | `email: "jane.doe@company.com"` | `identity-strategy="passthrough"` | `jane.doe@company.com` |
| **`domain_rewrite`** | `email: "abc123@nam.corp.company.com"`, `given_name: "Jane"`, `family_name: "Doe"` | `identity-strategy="domain_rewrite"`<br>`identity-domain="company.com"`<br>`identity-source-domain="corp.company.com"` | `jane.doe@company.com` |
| **`claim_template`** | `displayName: "Doe, Jane (Corp)"` | `identity-strategy="claim_template"`<br>`identity-domain="company.com"`<br>`identity-template="{given_name}.{family_name}@{domain}"` | `jane.doe@company.com` |
