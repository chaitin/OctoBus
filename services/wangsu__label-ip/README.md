# Wangsu Label IP

Wangsu OpenAPI package for Spider label IP batch forbid and unforbid operations.

## Package

- Service name: `wangsu-label-ip`
- Service dir: `services/wangsu__label-ip`
- Runtime mode: `long-running`
- Command: `wangsu-label-ip`
- Proto service: `Wangsu_LabelIP.WangsuLabelIPService`

## Config And Secret

Config fields:

- `baseUrl` required by runtime, with `restBaseUrl` and `url` aliases. Full Wangsu OpenAPI POST endpoint.
- `user` required by runtime.
- `labelCode` required by runtime unless request `label_code` is provided. Aliases: `label_code`, `wangsu_tag`, `wangsuTag`.
- `defaultForbidMinutes` optional, with `default_forbid_minutes` alias.
- `timeoutMs` optional, with `timeout_ms` and `timeout` aliases.
- `overrideDateHeader` or `dateHeader` optional for deterministic tests.
- `skipTlsVerify`, `tlsInsecureSkipVerify`, `tls_skip_verify` optional. TLS verification aliases for private deployments.
- `headers` optional, extra upstream headers.

Secret fields:

- `apiKey` or `api_key` required by runtime.

The service derives the Basic Auth password from `Base64(HMAC-SHA1(apiKey, Date))`; it does not accept API keys in request payloads.

## RPCs

| RPC | Access | Upstream behavior |
| --- | --- | --- |
| `BatchForbidIP` | Write | Posts operation type `1`, label code, IP list, and forbid duration. |
| `BatchUnforbidIP` | Write | Posts operation type `2`, label code, IP list, and optional forbid duration. |

Upstream `code == "0"` is success or partial success depending on failed IP lists. Nonzero business codes map to `FAILED_PRECONDITION`.

## Local Validation

```bash
cd services
npm run validate -- --service-dir wangsu__label-ip
npm test -- --service-dir wangsu__label-ip
npm test -- --coverage --service-dir wangsu__label-ip
```

## OctoBus Example

```bash
octobus service import --id wangsu-label-ip ./services/wangsu__label-ip
octobus instance create wangsu-label \
  --service wangsu-label-ip \
  --config-json '{"baseUrl":"https://openapi.example.com/label-ip","user":"api-user","labelCode":"BLACKLIST","timeoutMs":5000}' \
  --secret-json '{"apiKey":"REDACTED"}'
octobus capset create security-ops --name security-ops
octobus capset add-instance security-ops wangsu-label

curl -s -X POST \
  http://127.0.0.1:9000/capsets/security-ops/connect/wangsu-label/Wangsu_LabelIP.WangsuLabelIPService/BatchForbidIP \
  -H 'Content-Type: application/json' \
  -d '{"ip_list":["198.51.100.10"],"forbid_time_minutes":{"value":60},"request_id":"incident-1"}'
```

## Known Limits

- Both RPCs are write operations against Wangsu label state.
- Clock skew affects Wangsu signature verification because the `Date` header is part of the derived password.
- TLS skip is per request and should stay disabled for production OpenAPI endpoints.
