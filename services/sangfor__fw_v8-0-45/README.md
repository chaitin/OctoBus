# Sangfor FW V8.0.45

Sangfor firewall V8.0.45 Web API package for login, blacklist block/unblock, and logout workflows.

## Package

- Service name: `sangfor-fw-v8-0-45`
- Service dir: `services/sangfor__fw_v8-0-45`
- Runtime mode: `long-running`
- Command: `sangfor-fw-v8-0-45`
- Proto service: `Sangfor_FW_V8045.Sangfor_FW_V8045`

## Config And Secret

Config fields:

- `host` required by runtime, with `restBaseUrl` and `baseUrl` aliases. HTTP(S) base URL for the device.
- `timeoutMs` optional, upstream HTTP timeout in milliseconds.
- `headers` optional, extra upstream headers.
- `skipTlsVerify`, `tlsInsecureSkipVerify`, `insecureSkipVerify` optional. TLS verification aliases for private or lab devices only.

Secret fields:

- `user` or `username` required by runtime.
- `password` required by runtime.

Deprecated request fields such as `password` and `token` are ignored for credentials and session state. Use instance secret instead.

## RPCs

| RPC | Access | Upstream behavior |
| --- | --- | --- |
| `Login` | Write/session | `POST /api/v1/namespaces/public/login`; caches the returned token inside the instance and returns no token. |
| `BlockIP` | Write | `POST /api/batch/v1/namespaces/public/whiteblacklist` with the cached token cookie. |
| `UnblockIP` | Write | `POST /api/batch/v1/namespaces/public/whiteblacklist?_method=delete` with the cached token cookie. |
| `Logout` | Write/session | `POST /api/v1/namespaces/public/logout`; clears the local session. |

Block success codes are `0` and `17`; unblock success codes are `0` and `1004`. Responses and errors do not expose login token, cookie, password, or raw login body.

## Local Validation

```bash
cd services
npm run validate -- --service-dir sangfor__fw_v8-0-45
npm test -- --service-dir sangfor__fw_v8-0-45
npm test -- --coverage --service-dir sangfor__fw_v8-0-45
```

## OctoBus Example

```bash
octobus service import --id sangfor-fw-v8-0-45 ./services/sangfor__fw_v8-0-45
octobus instance create sangfor-fw \
  --service sangfor-fw-v8-0-45 \
  --config-json '{"host":"https://fw.example.com","timeoutMs":5000,"skipTlsVerify":false}' \
  --secret-json '{"username":"api-user","password":"REDACTED"}'
octobus capset create security-ops --name security-ops
octobus capset add-instance security-ops sangfor-fw

curl -s -X POST \
  http://127.0.0.1:9000/capsets/security-ops/connect/sangfor-fw/Sangfor_FW_V8045.Sangfor_FW_V8045/BlockIP \
  -H 'Content-Type: application/json' \
  -d '{"addresses":["198.51.100.10"],"description":{"value":"incident test"}}'
```

## Known Limits

- `Login` must succeed before block, unblock, or logout unless a valid session is already cached for the instance.
- Write RPCs change firewall policy and should be bound only to capsets that are allowed to mutate blacklist state.
- `skipTlsVerify` is implemented per request; keep it disabled in production when the device has a valid certificate.
