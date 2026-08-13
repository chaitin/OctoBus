# ThreatBook NGTIP V5

OctoBus service package for ThreatBook NGTIP V5 intelligence queries.

Service name: `threatbook-ngtip-v5`.

Runtime: long-running Node.js service using `@chaitin-ai/octobus-sdk`.

## Import

Service root: `services/threatbook__ngtip_v5`.

```bash
octobus service import --id threatbook-ngtip-v5 ./services/threatbook__ngtip_v5
```

## Instance

API key mode:

```bash
octobus instance create threatbook-ngtip \
  --service threatbook-ngtip-v5 \
  --config-json '{"ngtip_domain":"http://10.0.0.1:8090","timeoutMs":5000}' \
  --secret-json '{"ngtip_apikey":"<redacted>"}'
```

Token mode:

```bash
octobus instance create threatbook-ngtip \
  --service threatbook-ngtip-v5 \
  --config-json '{"ngtip_domain":"http://10.0.0.1:8090"}' \
  --secret-json '{"ngtip_apikey":"<redacted>","auth_mode":"token","salt":"<redacted>"}'
```

## Package Layout

- `service.json`: OctoBus service package manifest.
- `proto/threatbook_ngtip_v5.proto`: gRPC API definitions.
- `src/threatbook-ngtip-v5.js`: Runtime handler, request validation, HTTP request building, and error mapping.
- `config.schema.json`: Non-secret binding schema.
- `secret.schema.json`: API key and token schema.

## Bindings

Configuration:

- `ngtip_domain`: ThreatBook NGTIP V5 base URL, for example `http://10.0.0.1:8090`.
- `domain`, `restBaseUrl`, `baseUrl`: aliases for `ngtip_domain`.
- `timeoutMs`: optional request timeout in milliseconds, default `5000`.
- `skipTlsVerify`, `tlsInsecureSkipVerify`, `insecureSkipVerify`: optional TLS verification skip aliases.

Secrets:

- `ngtip_apikey`: ThreatBook NGTIP V5 API key.
- `apikey`, `apiKey`: aliases for `ngtip_apikey`.
- `salt`: Salt for TOKEN authentication. Required when `auth_mode` is `token`.
- `auth_mode`: Authentication mode, `apikey` (default) or `token`.

## RPC Methods

- `ThreatBook_NGTIP_V5.ThreatBook_NGTIP_V5/QueryIPReputation` — IP reputation query (`/tip_api/v5/ip`)
- `ThreatBook_NGTIP_V5.ThreatBook_NGTIP_V5/QueryDNSCompromised` — Compromised detection & malicious domain (`/tip_api/v5/dns`)
- `ThreatBook_NGTIP_V5.ThreatBook_NGTIP_V5/QueryFileReputation` — File hash reputation (`/tip_api/v5/hash`)
- `ThreatBook_NGTIP_V5.ThreatBook_NGTIP_V5/QueryVulnerability` — Vulnerability intelligence (`/tip_api/v5/vuln`)
- `ThreatBook_NGTIP_V5.ThreatBook_NGTIP_V5/QueryIPLocation` — IP geolocation (`/tip_api/v5/location`)

Example requests:

```json
{"resource":"8.8.8.8","lang":"zh","location":true}
```

```json
{"resource":"example.com","lang":"zh"}
```

```json
{"resource":"44d88612fea8a8f36de82e1278abb02f"}
```

```json
{"vuln_id":"CVE-2024-1234","limit":10,"is_highrisk":true}
```

```json
{"resource":"119.219.36.24"}
```

## Behavior

- Calls `GET {ngtip_domain}/tip_api/v5/<endpoint>` with appropriate query parameters.
- Supports two authentication modes:
  - `apikey` (default): sends `apikey` query parameter.
  - `token`: sends `apikey`, `timestamp`, and `token=Base64URLEncode(HMAC_SHA1(apikey+timestamp, salt))`.
- Any HTTP `2xx` response returns gRPC OK with structured fields: `response_code` (int32), `verbose_msg` (string), and `data` (JSON-serialized string of the upstream `data` field).
- HTTP `401` / `403` maps to `PERMISSION_DENIED`.
- Other HTTP `4xx` maps to `FAILED_PRECONDITION`.
- HTTP `5xx`, network errors, and response read errors map to `UNAVAILABLE`.
- Request fields named `ngtip_apikey`, `apikey`, or `apiKey` are ignored; credentials must come from instance secrets.
- Logs redact `apikey`, `token`, and `salt` from upstream URLs.

## Call Examples

Connect RPC through OctoBus:

```bash
curl -X POST \
  http://127.0.0.1:9000/capsets/threat-intel/connect/threatbook-ngtip/ThreatBook_NGTIP_V5.ThreatBook_NGTIP_V5/QueryIPReputation \
  -H 'Content-Type: application/json' \
  -d '{"resource":"8.8.8.8"}'
```

Runtime CLI:

```bash
OCTOBUS_SERVICE_CONTEXT='{"config":{"ngtip_domain":"http://10.0.0.1:8090"},"secret":{"ngtip_apikey":"<redacted>"}}' \
node threatbook__ngtip_v5/bin/threatbook-ngtip-v5.js query-ip-reputation --data-json '{"resource":"8.8.8.8"}'
```

## Limitations

- NGTIP V5 uses deployment-specific base URLs; the package does not assume a public default.
- HTTP `2xx` business failures are returned as gRPC OK with upstream `response_code` and `verbose_msg` so callers can handle vendor-specific codes.
- Queried indicators and vulnerability filters are sent to ThreatBook and may consume quota.
- Upstream response bodies are returned only as the `data` JSON string field; full raw HTTP bodies are not logged.
- Use a non-production API key and benign indicators for validation evidence.

## Validation

```bash
cd services
npm run validate -- --service-dir threatbook__ngtip_v5
npm test -- --service-dir threatbook__ngtip_v5
```
