# ThreatBook NGTIP V5

OctoBus service package for ThreatBook NGTIP V5 intelligence queries.

## Import

Service root: `services/threatbook__ngtip_v5`.

```bash
octobus service import --id threatbook-ngtip-v5 ./services/threatbook__ngtip_v5
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

## Behavior

- Calls `GET {ngtip_domain}/tip_api/v5/<endpoint>` with appropriate query parameters.
- Supports two authentication modes:
  - `apikey` (default): sends `apikey` query parameter.
  - `token`: sends `apikey`, `timestamp`, and `token=Base64URLEncode(HMAC_SHA1(apikey+timestamp, salt))`.
- Any HTTP `2xx` response returns gRPC OK with structured fields: `response_code` (int32), `verbose_msg` (string), and `data` (JSON-serialized string of the upstream `data` field).
- HTTP `401` / `403` maps to `PERMISSION_DENIED`.
- Other HTTP `4xx` maps to `FAILED_PRECONDITION`.
- HTTP `5xx`, network errors, and response read errors map to `UNAVAILABLE`.
