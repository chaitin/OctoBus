# TopSec WAF v3.2294.20238

TopSec WAF REST package for IP blacklist groups and URL custom policy rules.

## Package

- Service name: `topsec-waf-v3-2294-20238`
- Service dir: `services/topsec__waf_v3-2294-20238`
- Runtime mode: `long-running`
- Command: `topsec-waf-v3-2294-20238`
- Proto service: `TopSec_WAF.TopSec_WAF`

## Config And Secret

Config fields:

- `host` required by runtime, with `endpoint`, `baseUrl`, and `base_url` aliases. WAF base URL.
- `timeoutMs` optional, with `timeout_ms` alias. HTTP timeout in milliseconds.
- `skipTlsVerify` optional, with `skip_tls_verify` and `insecureSkipVerify` aliases. TLS verification control for private WAF deployments.

Secret fields:

- `username` or `user` required by runtime.
- `password` or `pass` required by runtime.

The service uses session-based authentication. PHP session ID, token, password, and raw login body are stored only in process memory and are not returned.

## RPCs

| RPC | Access | Upstream behavior |
| --- | --- | --- |
| `AddBlacklistIP` | Write | Creates or replaces an IP blacklist group. |
| `DeleteBlacklistIP` | Write | Deletes an IP blacklist group by name. |
| `ListBlacklistIPs` | Read | Lists blacklist groups, optionally filtered by name. |
| `AddUrlBlock` | Write | Adds a URL custom policy rule. |
| `DeleteUrlBlock` | Write | Deletes a URL custom policy rule. |
| `ListUrlBlocks` | Read | Lists URL custom policy rules. |
| `SetUrlBlockStatus` | Write | Enables or disables a URL custom policy rule. |

HTTP timeout maps to `DEADLINE_EXCEEDED`, WAF 5xx and network errors map to `UNAVAILABLE`, auth failures map to `UNAUTHENTICATED` or `PERMISSION_DENIED`, and upstream business failures map to `FAILED_PRECONDITION`.

## Local Validation

```bash
cd services
npm run validate -- --service-dir topsec__waf_v3-2294-20238
npm test -- --service-dir topsec__waf_v3-2294-20238
npm test -- --coverage --service-dir topsec__waf_v3-2294-20238
```

## OctoBus Example

```bash
octobus service import --id topsec-waf-v3-2294-20238 ./services/topsec__waf_v3-2294-20238
octobus instance create topsec-waf \
  --service topsec-waf-v3-2294-20238 \
  --config-json '{"host":"https://waf.example.com:8443","timeoutMs":5000,"skipTlsVerify":false}' \
  --secret-json '{"username":"admin","password":"REDACTED"}'
octobus capset create security-ops --name security-ops
octobus capset add-instance security-ops topsec-waf

curl -s -X POST \
  http://127.0.0.1:9000/capsets/security-ops/connect/topsec-waf/TopSec_WAF.TopSec_WAF/ListBlacklistIPs \
  -H 'Content-Type: application/json' \
  -d '{"page":1,"rows":20}'
```

## Known Limits

- API paths and authentication flow are verified against WAF `v3.2294.20238`.
- IP blacklist delete removes the whole group by name.
- URL rule support is limited to the fields in `proto/topsec_waf.proto`.
- `skipTlsVerify` uses a per-request dispatcher and does not change global TLS settings.
