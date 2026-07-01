# WD K01

WD K01 package for Web API login, IP block, IP unblock, and logout workflows.

The legacy source only identifies the product as `WD_K01`; this package keeps the `wd__k01` service dir and legacy proto package.

## Package

- Service name: `wd-k01`
- Service dir: `services/wd__k01`
- Runtime mode: `long-running`
- Command: `wd-k01`
- Proto service: `WD_K01.WD_K01`

## Config And Secret

Config fields:

- `host` required by runtime, with `restBaseUrl` and `baseUrl` aliases. Web API base URL.
- `user` or `username` required by runtime.
- `timeoutMs` optional, upstream HTTP timeout in milliseconds.
- `skipTlsVerify`, `tlsInsecureSkipVerify`, `insecureSkipVerify` optional. TLS verification aliases for private deployments.
- `headers` optional, extra upstream headers.

Secret fields:

- `password` required by runtime.

The login token is used only internally for the action and logout calls. `login_raw_json` is returned as an empty string, and logout raw text is redacted.

## RPCs

| RPC | Access | Upstream behavior |
| --- | --- | --- |
| `BlockIP` | Write | Logs in, posts `method: "add"` to `/api/v1/security/iplist/save`, then logs out. |
| `UnblockIP` | Write | Logs in, posts `method: "delete"` to `/api/v1/security/iplist/save`, then logs out. |

Block messages containing `already exists` equivalents or multicast hints are idempotent success. Unblock messages containing object-not-found equivalents or multicast hints are idempotent success.

## Local Validation

```bash
cd services
npm run validate -- --service-dir wd__k01
npm test -- --service-dir wd__k01
npm test -- --coverage --service-dir wd__k01
```

## OctoBus Example

```bash
octobus service import --id wd-k01 ./services/wd__k01
octobus instance create wd-k01 \
  --service wd-k01 \
  --config-json '{"host":"https://wd.example.com","user":"api-user","timeoutMs":1500,"skipTlsVerify":false}' \
  --secret-json '{"password":"REDACTED"}'
octobus capset create security-ops --name security-ops
octobus capset add-instance security-ops wd-k01

curl -s -X POST \
  http://127.0.0.1:9000/capsets/security-ops/connect/wd-k01/WD_K01.WD_K01/BlockIP \
  -H 'Content-Type: application/json' \
  -d '{"ip":"198.51.100.10","type":1,"timeout":60,"time_type":60,"comment":"incident test"}'
```

## Known Limits

- The product identity is preserved from the legacy `WD_K01` naming.
- The service logs in and logs out for each operation.
- Response fields kept for legacy compatibility do not contain raw login body or raw logout text.
