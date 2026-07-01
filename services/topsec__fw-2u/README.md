# TopSec FW 2U

TopSec FW 2U WebUI package for login, permission activation, blacklist add/delete, and logout workflows.

## Package

- Service name: `topsec-fw-2u`
- Service dir: `services/topsec__fw-2u`
- Runtime mode: `long-running`
- Command: `topsec-fw-2u`
- Proto service: `TopSec_FW_2U.TopSec_FW_2U`

## Config And Secret

Config fields:

- `host` required by runtime, with `restBaseUrl` and `baseUrl` aliases. Device WebUI base URL.
- `timeoutMs` optional, upstream HTTP timeout in milliseconds.
- `skipTlsVerify`, `tlsInsecureSkipVerify`, `insecureSkipVerify` optional. TLS verification aliases for private deployments.

Secret fields:

- `username` required.
- `password` required.

Request `username`, `password`, `session`, `token`, `cookie`, and `secret` fields are deprecated and ignored by SDK handlers.

## RPCs

| RPC | Access | Upstream behavior |
| --- | --- | --- |
| `Login` | Write/session | `POST /home/login/addNoCode/`; caches session internally and returns only status fields. |
| `ActivatePermission` | Write/session | Activates the cached WebUI permission context. |
| `AddBlacklistIP` | Write | Adds one or more IP addresses to the blacklist using the cached session. |
| `DeleteBlacklistIP` | Write | Removes one or more IP addresses from the blacklist using the cached session. |
| `Logout` | Write/session | Logs out and clears the cached session. |

Session cache keys include service, instance, host, and username. Responses and errors do not expose token, cookie, password, session secret, or raw upstream body.

## Local Validation

```bash
cd services
npm run validate -- --service-dir topsec__fw-2u
npm test -- --service-dir topsec__fw-2u
npm test -- --coverage --service-dir topsec__fw-2u
```

## OctoBus Example

```bash
octobus service import --id topsec-fw-2u ./services/topsec__fw-2u
octobus instance create topsec-2u \
  --service topsec-fw-2u \
  --config-json '{"host":"https://fw2u.example.com","timeoutMs":5000,"skipTlsVerify":false}' \
  --secret-json '{"username":"admin","password":"REDACTED"}'
octobus capset create security-ops --name security-ops
octobus capset add-instance security-ops topsec-2u

curl -s -X POST \
  http://127.0.0.1:9000/capsets/security-ops/connect/topsec-2u/TopSec_FW_2U.TopSec_FW_2U/AddBlacklistIP \
  -H 'Content-Type: application/json' \
  -d '{"ips":["198.51.100.10"]}'
```

## Known Limits

- WebUI endpoints are device-version sensitive.
- All blacklist RPCs are write operations and should be restricted to mutation-capable capsets.
- TLS skip is per request and should be used only for self-signed lab devices.
