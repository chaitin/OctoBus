# Riversec Botgate WAF 26.03 OctoBus Service

OctoBus adapter for **瑞数动态应用保护系统（Riversec Botgate / Safeplus）** REST API v1.

Service root: `services/riversec__waf_26-03`.

Import:

```bash
octobus service import --id riversec-waf-26-03 ./services//riversec__waf_26-03
```

## Supported Version

| Product | Version | Notes |
|---------|---------|-------|
| Botgate | RAS 20.01+ / 26.03 | Primary target |
| Safeplus | 20.01+ | Same signing protocol |

## Core Capabilities

### IPBlacklistService

| RPC | Upstream | Risk |
|-----|----------|------|
| `GetBlacklistStatus` | `GET /api/v1/ip_black_list/switch` | Low |
| `SetBlacklistStatus` | `POST /api/v1/ip_black_list/switch` | Medium |
| `GetBlacklist` | `GET /api/v1/ip_black_list` | Low |
| `SetBlacklist` | `POST /api/v1/ip_black_list` | High (overwrite) |
| `AddBlacklistItems` | `PUT /api/v1/ip_black_list` | Medium |
| `ClearBlacklist` | `DELETE /api/v1/ip_black_list` | High |
| `BlockIP` | `PUT /api/v1/ip_black_list` (incremental add) | Medium |
| `UnblockIP` | `GET` + `POST /api/v1/ip_black_list` (rewrite list) | Medium |

### ProtectedSiteService

Protected site CRUD and batch update via `/api/v1/protected_sites` and `/api/v1/batch_protected_sites`.

### ClusterService

SSO URL, cluster info, upgrade, and rollback via `/api/v1/rcm/*`.

### ProgrammableRuleService

Programmable confrontation rules via `/api/v1/ubbv2/*`.

### APIManagementService

API asset CRUD and online status via `/api/v1/abd/*`.

## Configuration

```json
{
  "baseUrl": "https://botgate.example.com:20167",
  "timeout": 30000,
  "verifySSL": false,
  "maxRetries": 0,
  "productType": "Botgate"
}
```

`host` and `endpoint` are aliases for `baseUrl`. Use `skipTlsVerify: true` when `verifySSL` is false.

Secret bindings from the Botgate **系统API接口** page:

```json
{
  "tokenId": "api_admin",
  "tokenValue": "replace-with-token-value-from-device-ui"
}
```

Aliases: `token_id`, `token_value`, `token`.

## Authentication

```
Signature = HMAC-SHA256(TokenValue, CanonicalRequest)

CanonicalRequest =
    Method + '\n' +
    CanonicalURI + '\n' +
    CanonicalQueryString + '\n' +
    Timestamp + '\n' +
    Nonce + '\n' +
    TokenID + '\n' +
    MD5(Body)
```

Signed query params: `timestamp`, `nonce`, `tokenid`, `signature`.

## Instance / Capset Example

```bash
octobus instance create riversec-demo \
  --service riversec-waf-26-03 \
  --config-json '{"baseUrl":"https://botgate.example.com:20167","verifySSL":false}' \
  --secret-json '{"tokenId":"api_admin","tokenValue":"replace-with-demo-token"}'

octobus capset create waf-ops --name "WAF Ops"
octobus capset add-instance waf-ops riversec-demo

cap-grpcurl -capset waf-ops -instance riversec-demo \
  -d '{"ip_list":["203.0.113.10"]}' \
  Riversec_Botgate_WAF.IPBlacklistService/BlockIP
```

Suggested capsets:

| Scenario | Capset | Methods |
|----------|--------|---------|
| Daily ops | `waf-daily-ops` | GetBlacklist, AddBlacklistItems, ListProtectedSites |
| Incident response | `waf-incident` | BlockIP, AddBlacklistItems, SetBlacklistStatus |
| Read-only audit | `waf-audit` | GetBlacklistStatus, GetBlacklist, GetClusterInfo, ListAPIs |

## Error Mapping

| API `err_no` | gRPC legacy code |
|--------------|------------------|
| 0 | success |
| 2, 3 | `UNAUTHENTICATED` |
| 4 | `INVALID_ARGUMENT` |
| 10 | `PERMISSION_DENIED` |
| other | `FAILED_PRECONDITION` |
| HTTP 5xx / network | `UNAVAILABLE` |

## Risks

- `SetBlacklist` and `ClearBlacklist` are destructive overwrite operations.
- `UpgradeCluster` / `RollbackCluster` affect the entire cluster.
- Deleted protected sites are not automatically recoverable.
- Use test IPs such as `203.0.113.0/24` and clean up after device verification.

## Local Checks

```bash
cd services
npm run validate -- --service-dir riversec__waf_26-03
npm test -- --service-dir riversec__waf_26-03
npm run pack:check
```

## Package Layout

```
riversec__waf_26-03/
  service.json
  proto/riversec_waf_26_03.proto
  src/riversec-client.js
  src/riversec-handlers.js
  src/riversec-waf-26-03.js
  src/service.js
  bin/riversec-waf-26-03.js
  config.schema.json
  secret.schema.json
  test/riversec-waf-26-03.test.js
  test/mock_upstream.js
```
