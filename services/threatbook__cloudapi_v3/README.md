# ThreatBook CloudAPI V3

OctoBus service package for ThreatBook CloudAPI V3 IP reputation and domain query APIs.

Service name: `threatbook-cloudapi-v3`.

Runtime: long-running Node.js service using `@chaitin-ai/octobus-sdk`.

## Import

Service root: `services/threatbook__cloudapi_v3`.

```bash
octobus service import --id threatbook-cloudapi-v3 ./services/threatbook__cloudapi_v3
```

## Instance

```bash
octobus instance create threatbook-cloudapi \
  --service threatbook-cloudapi-v3 \
  --config-json '{"threatbook_domain":"https://api.threatbook.cn","timeoutMs":1500}' \
  --secret-json '{"threatbook_apikey":"<redacted>"}'
```

## Package Layout

- `service.json`: OctoBus service package manifest.
- `proto/threatbook_cloudapi_v3.proto`: Legacy-compatible gRPC API.
- `src/threatbook-cloudapi-v3.js`: Runtime handlers, request building, response parsing, and error mapping.
- `config.schema.json`: Non-secret binding schema.
- `secret.schema.json`: API key schema.
- `test/`: Node test coverage and mock upstream.

## Bindings

Configuration:

- `threatbook_domain`: ThreatBook base URL, for example `https://api.threatbook.cn`.
- `domain`, `restBaseUrl`, `baseUrl`: aliases for `threatbook_domain`.
- `timeoutMs`: optional request timeout in milliseconds, default `1500`.
- `skipTlsVerify`, `tlsInsecureSkipVerify`, `insecureSkipVerify`: optional TLS verification skip aliases.

Secrets:

- `threatbook_apikey`: ThreatBook CloudAPI API key.
- `apikey`, `apiKey`: aliases for `threatbook_apikey`.

## RPC Methods

### IpReputation

Full method:

```text
ThreatBook_CloudAPI_V3.ThreatBook_CloudAPI_V3/IpReputation
```

Request:

```json
{
  "resource": "8.8.8.8",
  "lang": "zh"
}
```

Calls `GET {threatbook_domain}/1.1.1/scene/ip_reputation` with `apikey`, `lang`, and `resource`.

### DomainQuery

Full method:

```text
ThreatBook_CloudAPI_V3.ThreatBook_CloudAPI_V3/DomainQuery
```

Request:

```json
{
  "resource": "example.com",
  "lang": "zh",
  "exclude": "cas"
}
```

Calls `GET {threatbook_domain}/1.1.1/domain/query` with `apikey`, `lang`, `resource`, and `exclude`.

## Behavior

- `IpReputation` calls `GET {threatbook_domain}/1.1.1/scene/ip_reputation`.
- `DomainQuery` calls `GET {threatbook_domain}/1.1.1/domain/query`.
- `lang` defaults to `zh`.
- `DomainQuery.exclude` defaults to `cas`.
- Success requires HTTP `200` and ThreatBook `response_code == 0`.
- Successful RPC responses return `http_status`. `raw_body` is intentionally empty and `raw_json` is not populated to avoid retaining upstream payloads that may contain sensitive data.

Errors preserve the legacy structured JSON message convention:

- Missing arguments: `INVALID_ARGUMENT`.
- HTTP `401` / `403`: `PERMISSION_DENIED`.
- Other HTTP `4xx`: `FAILED_PRECONDITION`.
- HTTP `5xx`, network errors, and response read errors: `UNAVAILABLE`.
- Invalid JSON or missing `response_code`: `UNKNOWN`.
- HTTP `200` with `response_code != 0`: `FAILED_PRECONDITION`.
- Error messages include empty `raw_body`, `raw_body_length`, and redacted upstream `verbose_msg` when available.

## Call Examples

Connect RPC through OctoBus:

```bash
curl -X POST \
  http://127.0.0.1:9000/capsets/threat-intel/connect/threatbook-cloudapi/ThreatBook_CloudAPI_V3.ThreatBook_CloudAPI_V3/IpReputation \
  -H 'Content-Type: application/json' \
  -d '{"resource":"8.8.8.8"}'
```

Runtime CLI:

```bash
OCTOBUS_SERVICE_CONTEXT='{"config":{"threatbook_domain":"https://api.threatbook.cn"},"secret":{"threatbook_apikey":"<redacted>"}}' \
node threatbook__cloudapi_v3/bin/threatbook-cloudapi-v3.js ip-reputation --data-json '{"resource":"8.8.8.8"}'
```

## Limitations

- API keys must come from instance secrets; request fields named `apikey` or `apiKey` are ignored.
- Queried IPs/domains are sent to ThreatBook and may consume quota.
- Upstream response bodies are not returned or logged by the package.
- Use a non-production API key and benign indicators for validation evidence.

## Validation

```bash
cd services
npm run validate -- --service-dir threatbook__cloudapi_v3
npm test -- --service-dir threatbook__cloudapi_v3
```
