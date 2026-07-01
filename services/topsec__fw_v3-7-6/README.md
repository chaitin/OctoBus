# TopSec FW V3.7.6

TopSec FW V3.7.6 WebUI package for REST login, blacklist add/delete, and logout workflows.

## Package

- Service name: `topsec-fw-v3-7-6`
- Service dir: `services/topsec__fw_v3-7-6`
- Runtime mode: `long-running`
- Command: `topsec-fw-v3-7-6`
- Proto service: `TopSec_FW_V376.TopSec_FW_V376`

## Config And Secret

Config fields:

- `host` required by runtime, with `baseUrl` and `restBaseUrl` aliases.
- `memo` optional, default memo for added blacklist entries.
- `timeoutMs` optional, upstream HTTP timeout in milliseconds.
- `skipTlsVerify`, `tlsInsecureSkipVerify` optional. TLS verification aliases for private deployments.
- `allow_http` or `allowHttp` optional. Local mock and lab-only HTTP allowance.
- `headers` optional, extra upstream headers.
- `user`, `username`, `aesKey`, and `aesIv` are deprecated compatibility fallbacks. Prefer instance secret.

Secret fields:

- `username` required.
- `password` required.
- `aesKey` required, with `aesKeyHex` and `aesKeyBase64` aliases.
- `aesIv` required, with `aesIvHex` and `aesIvBase64` aliases.

Request `username`, `password`, `aes_key`, `aes_iv`, `session`, `token`, `cookie`, and `secret` fields are deprecated and ignored for credential/session input by SDK handlers.

## RPCs

| RPC | Access | Upstream behavior |
| --- | --- | --- |
| `Login` | Write/session | `POST /home/restLogin/`; encrypts password and `ngtosAuth`, then caches session. |
| `AddBlacklistIP` | Write | Adds one or more IP addresses and signs commands with `codeRun`. |
| `DeleteBlacklistIP` | Write | Deletes one or more IP addresses and signs commands with `codeRun`. |
| `Logout` | Write/session | Logs out and clears the cached session. |

Duplicate add and already-absent delete responses are treated as idempotent success when the upstream message clearly indicates that state.

## Local Validation

```bash
cd services
npm run validate -- --service-dir topsec__fw_v3-7-6
npm test -- --service-dir topsec__fw_v3-7-6
npm test -- --coverage --service-dir topsec__fw_v3-7-6
```

## OctoBus Example

```bash
octobus service import --id topsec-fw-v3-7-6 ./services/topsec__fw_v3-7-6
octobus instance create topsec-v376 \
  --service topsec-fw-v3-7-6 \
  --config-json '{"host":"https://fw-v376.example.com","timeoutMs":5000,"skipTlsVerify":false}' \
  --secret-json '{"username":"admin","password":"REDACTED","aesKey":"00112233445566778899aabbccddeeff","aesIv":"0102030405060708090a0b0c0d0e0f10"}'
octobus capset create security-ops --name security-ops
octobus capset add-instance security-ops topsec-v376

curl -s -X POST \
  http://127.0.0.1:9000/capsets/security-ops/connect/topsec-v376/TopSec_FW_V376.TopSec_FW_V376/AddBlacklistIP \
  -H 'Content-Type: application/json' \
  -d '{"ip_addresses":["198.51.100.10"],"memo":{"value":"incident test"}}'
```

## Known Limits

- AES material is device-version specific and must be provisioned as instance secret.
- All blacklist RPCs are write operations.
- HTTP allowance is intended only for local mock or lab use.
