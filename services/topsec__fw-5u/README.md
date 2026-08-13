# TopSec FW 5U

TopSec FW 5U WebUI package for login, refresh, blacklist add/remove, and logout workflows.

## Package

- Service name: `topsec-fw-5u`
- Service dir: `services/topsec__fw-5u`
- Runtime mode: `long-running`
- Command: `topsec-fw-5u`
- Proto service: `TopSec_FW_5U.TopSec_FW_5U`

## Config And Secret

Config fields:

- `host` required by runtime, with `baseUrl` and `restBaseUrl` aliases. Device WebUI base URL.
- `user` or `username` deprecated compatibility fallback. Prefer `secret.username`.
- `timeoutMs` optional, upstream HTTP timeout in milliseconds.
- `skipTlsVerify`, `tlsInsecureSkipVerify` optional. TLS verification aliases for private deployments.
- `allow_http` or `allowHttp` optional. Local mock and lab-only HTTP allowance.
- `headers` optional, extra upstream headers.

Secret fields:

- `username` required by schema for new instances.
- `password` required.

Request `password`, `session`, `token`, `cookie`, and username fields are deprecated and ignored by SDK handlers.

## RPCs

| RPC | Access | Upstream behavior |
| --- | --- | --- |
| `Login` | Write/session | `POST /home/login/`; encrypts password internally and caches session. |
| `Refresh` | Write/session | Refreshes the cached session. |
| `AddToBlacklist` | Write | Adds one IP to the blacklist using the cached session. |
| `RemoveFromBlacklist` | Write | Removes one IP from the blacklist using the cached session. |
| `Logout` | Write/session | Logs out and clears the cached session. |

Duplicate add and already-missing remove responses are treated as idempotent success when the upstream message clearly indicates that state.

## Local Validation

```bash
cd services
npm run validate -- --service-dir topsec__fw-5u
npm test -- --service-dir topsec__fw-5u
npm test -- --coverage --service-dir topsec__fw-5u
```

## OctoBus Example

```bash
octobus service import --id topsec-fw-5u ./services/topsec__fw-5u
octobus instance create topsec-5u \
  --service topsec-fw-5u \
  --config-json '{"host":"https://fw5u.example.com","timeoutMs":5000,"skipTlsVerify":false}' \
  --secret-json '{"username":"admin","password":"REDACTED"}'
octobus capset create security-ops --name security-ops
octobus capset add-instance security-ops topsec-5u

curl -s -X POST \
  http://127.0.0.1:9000/capsets/security-ops/connect/topsec-5u/TopSec_FW_5U.TopSec_FW_5U/AddToBlacklist \
  -H 'Content-Type: application/json' \
  -d '{"ip":"198.51.100.10"}'
```

## Known Limits

- WebUI encryption and token formats are version-specific.
- All blacklist RPCs are write operations.
- HTTP allowance is intended only for local mock or lab use.
