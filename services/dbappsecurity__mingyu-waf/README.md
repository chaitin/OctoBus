# DBAPPSecurity Mingyu WAF OctoBus Service

OctoBus service package for [DBAPPSecurity Mingyu WAF](https://www.dbappsecurity.com.cn/) (安恒信息 明御® Web应用防火墙).

Import it into OctoBus with:

```bash
octobus service import --id dbappsecurity-mingyu-waf ./services/dbappsecurity__mingyu-waf
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/waf.proto`: gRPC API definition.
- `config.schema.json`: WAF management address and TLS settings.
- `secret.schema.json`: WAF username and password.
- `bin/waf.js`: Service entrypoint — RSA-encrypted login, JWT token management, and REST API calls.

## Configuration

Use `host` for the Mingyu WAF management address. Set `verify_ssl` to `false` for self-signed certificates (the default for on-premises deployments).

```json
{
  "host": "https://your-waf-address",
  "verify_ssl": false
}
```

```json
{
  "username": "admin",
  "password": "your-password"
}
```

> **Authentication note**: The Mingyu WAF API requires RSA-PKCS1v15 encrypted passwords. The service fetches the public key automatically and encrypts the password before login — do not pre-encrypt the password in the secret schema.

## RPC Methods

### IP Blocking Rules (Basic Rules — `POST /api/v1/security/basic_rules/`)

- `mingyu_waf.v1.WafService/ListBlockRules` — List IP blocking rules with pagination and name filter.
- `mingyu_waf.v1.WafService/CreateBlockRule` — Create an IP blocking rule (action: `deny`).
- `mingyu_waf.v1.WafService/UpdateBlockRule` — Update an existing IP blocking rule.
- `mingyu_waf.v1.WafService/DeleteBlockRule` — Delete an IP blocking rule by ID.

### IP Allowlist Rules (Protection Control Rules — `POST /api/v1/security/control_rules/`)

- `mingyu_waf.v1.WafService/ListAllowRules` — List IP allowlist rules with pagination and name filter.
- `mingyu_waf.v1.WafService/CreateAllowRule` — Create an IP allowlist rule (action: `allow`).
- `mingyu_waf.v1.WafService/UpdateAllowRule` — Update an existing IP allowlist rule.
- `mingyu_waf.v1.WafService/DeleteAllowRule` — Delete an IP allowlist rule by ID.

### Sites

- `mingyu_waf.v1.WafService/ListSites` — List protected sites (used to scope rules to specific sites via `siteIds`).

## Condition Groups

Rules use OR logic between `conditionGroups` and AND logic within each group's `conditions`:

```json
{
  "conditionGroups": [
    {
      "conditions": [
        {
          "field": "sip",
          "ipList": ["1.2.3.4", "10.0.0.0/8"],
          "negate": false
        }
      ]
    }
  ]
}
```

Supported `field` values:

| Field | Description |
|-------|-------------|
| `sip` | Source IP address |
| `sip_xff` | Real client IP from X-Forwarded-For header |
| `dip` | Destination IP address |

## Behavior Notes

- Login is performed automatically on the first request and on token expiry (`GENERAL_TOKEN_INVALID`).
- `applyTo: "all_apps"` applies the rule to all protected sites; pass specific site IDs via `siteIds` to scope the rule.
- IP addresses may be single IPs or CIDR notation (e.g. `10.0.0.0/8`).
