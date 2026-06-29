# Leadsec_waf OctoBus Service

Leadsec_waf global access control wrapper for OctoBus. This service exposes blacklist and whitelist management methods for AI security operations workflows.

## Supported Product

- Product: Leadsec_waf
- Verified scenario: Application Protection / Global Access Control / Blacklist and Whitelist
- Verified date: 2026-06-26
- Verified firmware/version: not available from the current API document; record the exact device version in PR evidence when available.

## Authentication

The service calls `POST /api/mgr/login` before business requests.

- `username` is sent as plaintext.
- `password` from `secret.schema.json` is hashed with SHA-256 before login.
- The returned `data.authorization` value is sent as the `Authorization` header.
- `Set-Cookie` is preserved and sent back as `Cookie` when present.
- If a business response indicates an expired authorization/session, the service retries once after re-login.

Do not place real username, password, token, cookie, SID, production host, or business data in code, tests, screenshots, or PR text.

## Configuration

`config.schema.json`:

```json
{
  "baseUrl": "https://<waf-host>",
  "timeoutMs": 5000,
  "insecureSkipTlsVerify": true
}
```

`secret.schema.json`:

```json
{
  "username": "<redacted>",
  "password": "<redacted>"
}
```

`insecureSkipTlsVerify` is intended only for demo/lab devices with self-signed certificates.

## Methods

| Method | Upstream API | Risk |
|---|---|---|
| `HealthCheck` | `POST /api/mgr/login` | Read-only |
| `ListAccessOptions` | `GET /blacklist/add` | Read-only |
| `CreateAddressObject` | `POST /addressobject/addAddrObj` | Write |
| `ListBlacklists` | `GET /blacklist` | Read-only |
| `CreateBlacklist` | `POST /blacklist/add_submit` | Write |
| `BlockIP` | `GET /blacklist/add`, `POST /blacklist/add_submit`, `GET /blacklist` | Write |
| `UpdateBlacklist` | `POST /blacklist/edit_submit` | Write |
| `SetBlacklistEnabled` | `POST /blacklist/enableItem` | Write |
| `DeleteBlacklist` | `POST /blacklist/delete` | Write |
| `DeleteBlockedIP` | `POST /blacklist/delete` | Write |
| `SetBlacklistPriority` | `POST /blacklist/setpriority` | Write |
| `ListWhitelists` | `GET /whitelist` | Read-only |
| `CreateWhitelist` | `POST /whitelist/add_submit` | Write |
| `AllowIP` | `GET /blacklist/add`, `POST /whitelist/add_submit`, `GET /whitelist` | Write |
| `UpdateWhitelist` | `POST /whitelist/edit_submit` | Write |
| `SetWhitelistEnabled` | `POST /whitelist/enableItem` | Write |
| `DeleteWhitelist` | `POST /whitelist/delete` | Write |
| `DeleteAllowedIP` | `POST /whitelist/delete` | Write |
| `SetWhitelistPriority` | `POST /whitelist/setpriority` | Write |

## Rule Fields

`Create*` and `Update*` use the same rule payload:

```json
{
  "name": "octobus_agent_test",
  "if_in": "gev0/1",
  "src_addrobj": "白名单",
  "dst_addrobj": "any",
  "dst_servobj": "any",
  "log": 1,
  "log_level": 6,
  "enable": 1,
  "week_day": "7,",
  "day_enable_time": "0-24",
  "set_periodic": 1
}
```

Defaults applied by the service when optional fields are missing:

- `log`: `1`
- `log_level`: `6`
- `enable`: `1`
- `week_day`: `"7,"`
- `day_enable_time`: `"0-24"`
- `set_periodic`: `1`

Operators should confirm address objects, service objects, and interface names before exposing write methods. The current test device was verified with selectable interface values such as `gev0/1` and `gev0/2`; using a value that is not returned by `ListAccessOptions` can produce an upstream `success` response without creating a visible rule. The service verifies the list after create and reports an error if the rule is not present.

## IP Block and Allow Helpers

`BlockIP` and `AllowIP` are convenience methods for AI workflows that start from an IP address rather than a WAF object name.

```json
{
  "ip": "1.1.1.1",
  "dst_servobj": "any"
}
```

The service resolves the IP to an existing WAF address object by calling `ListAccessOptions`. On the verified test device, `1.1.1.1` resolves to the existing address object `白名单`, so `BlockIP` creates this effective upstream rule:

```json
{
  "name": "octobus_block_1_1_1_1",
  "if_in": "gev0/1",
  "src_addrobj": "白名单",
  "dst_addrobj": "any",
  "dst_servobj": "any",
  "log": 1,
  "log_level": 6,
  "enable": 1,
  "week_day": "7,",
  "day_enable_time": "0-24",
  "set_periodic": 1
}
```

The WAF blacklist and whitelist policy APIs accept address object names, not arbitrary raw IP literals. If no existing address object contains the requested host IP, `BlockIP` and `AllowIP` create an IPv4 host address object named `octobus_addr_<ip_with_underscores>` and then create the access-control rule. Callers can override the generated object name with `address_object_name`, or bypass lookup by passing an explicit `src_addrobj`.

The input must be a valid IPv4 host address; for example, `192.16.8.22.22` is rejected as invalid because it has five octets.

`CreateAddressObject` can also be called directly:

```json
{
  "ip": "192.15.11.11",
  "name": "octobus_addr_192_15_11_11",
  "desc": ""
}
```

## Important Upstream Notes

- `GET /whitelist` returns whitelist entries under `data.blacklist`. The service maps this to `ListWhitelists.rules`.
- Blacklist `enableItem` requires `mode=2`.
- Whitelist `enableItem` requires `mode=1`; `mode=2` returned `{"code":-1,"data":null}` during verification.

## Idempotency and Rollback

- Rules are identified by `name`.
- `Create*` is not treated as idempotent by the service; duplicate names are delegated to the upstream device.
- `Update*`, `Set*Enabled`, `Delete*`, and `Set*Priority` return upstream business status.
- Rollback for test writes: delete `octobus_agent_test_*` rules or restore the original `enable`/priority value captured before the write.
- Test evidence must show final cleanup.

## Suggested Capsets

Read-only capset:

- `HealthCheck`
- `ListBlacklists`
- `ListWhitelists`

Operator write capset:

- All read-only methods
- `Create*`, `Update*`, `Set*Enabled`, `Delete*`, `Set*Priority`

Write methods change global access-control policy and should be exposed only to approved operator agents or workflows.

## Local Validation

From the `services` package root:

```bash
npm run validate -- --service-dir leadsec__waf
npm test -- --service-dir leadsec__waf
npm run pack:check
```

## Live Verification

Live tests are opt-in and require environment variables. They create, disable, delete, and verify cleanup of `octobus_agent_test_live`.

```bash
VENUS_WAF_LIVE=1 \
VENUS_WAF_BASE_URL='https://<waf-host>' \
VENUS_WAF_USERNAME='<redacted>' \
VENUS_WAF_PASSWORD='<redacted>' \
npm test -- --service-dir leadsec__waf --test-name-pattern live
```

Optional overrides:

- `VENUS_WAF_TEST_IF_IN`
- `VENUS_WAF_TEST_SRC_ADDROBJ`
- `VENUS_WAF_TEST_DST_ADDROBJ`
- `VENUS_WAF_TEST_DST_SERVOBJ`
- `VENUS_WAF_TEST_WEEK_DAY`
- `VENUS_WAF_TEST_DAY_ENABLE_TIME`

## OctoBus Smoke Flow

```bash
octobus service import leadsec-waf ./services/leadsec__waf
octobus instance create leadsec-waf-demo \
  --service leadsec-waf \
  --config-json '{"baseUrl":"https://<waf-host>","insecureSkipTlsVerify":true}' \
  --secret-json '{"username":"<redacted>","password":"<redacted>"}'
octobus capset create waf-dev --name WafDevAgent
octobus capset add-instance waf-dev leadsec-waf-demo
octobus catalog waf-dev --all --json
```

Connect RPC read-only check:

```bash
curl -X POST \
  http://127.0.0.1:9000/capsets/waf-dev/connect/leadsec-waf-demo/Venus_WAF.Venus_WAF/ListBlacklists \
  -H 'Content-Type: application/json' \
  -d '{}'
```

MCP list tools:

```bash
curl -X POST http://127.0.0.1:9000/capsets/waf-dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Known Limitations

- Exact firmware version is not currently discovered by this service.
- Address object and service object discovery is exposed through `ListAccessOptions`. The service creates IPv4 host address objects for `BlockIP` and `AllowIP`, but it does not create service objects.
- Only global access blacklist and whitelist are included. URL whitelist, event whitelist, temporary blocklist, and attack-IP smart blocking are intentionally out of scope.
