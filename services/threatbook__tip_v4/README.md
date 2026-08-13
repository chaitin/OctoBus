# ThreatBook TIP V4

OctoBus service package for ThreatBook TIP V4 IP reputation queries.

## Service Name

- Directory: `services/threatbook__tip_v4`
- Manifest name: `threatbook-tip-v4`
- Runtime entrypoint: `bin/threatbook-tip-v4.js`

## Import

```bash
octobus service import --id threatbook-tip-v4 ./services/threatbook__tip_v4
```

## Package Layout

- `service.json`: OctoBus service package manifest.
- `proto/threatbook_tip_v4.proto`: Legacy-compatible gRPC API.
- `src/threatbook-tip-v4.js`: Runtime handler, request validation, HTTP request building, and error mapping.
- `config.schema.json`: Non-secret binding schema.
- `secret.schema.json`: API key schema.
- `test/`: Node test coverage and mock upstream.

## Configuration

Config:

```json
{
  "threatbook_domain": "https://api.threatbook.cn",
  "timeoutMs": 1500
}
```

Secrets:

```json
{
  "threatbook_apikey": "replace-with-api-key"
}
```

Supported config aliases are `domain`, `restBaseUrl`, `baseUrl`, `skipTlsVerify`, `tlsInsecureSkipVerify`, and `insecureSkipVerify`. Supported secret aliases are `apikey` and `apiKey`.

## RPC Methods

- `ThreatBook_TIP_V4.ThreatBook_TIP_V4/QueryIPReputation`: `GET /tip_api/v4/ip`

## Runtime Example

```js
import { handlers, METHOD_QUERY_IP_REPUTATION_FULL } from './threatbook__tip_v4/src/threatbook-tip-v4.js';

const result = await handlers[METHOD_QUERY_IP_REPUTATION_FULL]({
  config: { threatbook_domain: 'https://api.threatbook.cn' },
  secret: { threatbook_apikey: process.env.THREATBOOK_API_KEY },
  request: { ip: '8.8.8.8' }
});
console.log(result);
```

## Behavior

- Calls `GET {threatbook_domain}/tip_api/v4/ip`.
- Sends query parameters `apikey`, `lang=zh`, and `resource`.
- Any HTTP `2xx` response returns gRPC OK with `http_status` and an empty `http_body`.
- HTTP `200` with `response_code != 0` is still gRPC OK, matching legacy behavior.
- HTTP `401` / `403` maps to `PERMISSION_DENIED`.
- Other HTTP `4xx` maps to `FAILED_PRECONDITION`.
- HTTP `5xx`, network errors, and response read errors map to `UNAVAILABLE`.
- API key material is redacted from logs and errors.

## Limitations

- This package covers only the TIP V4 IP reputation endpoint.
- `lang` is fixed to `zh`.
- The proto response only exposes `http_status` and `http_body`; this implementation intentionally returns an empty body for compatibility.
- IP syntax is checked only for a non-empty string locally; ThreatBook performs semantic validation.

## Validation

```bash
cd services
npm run validate -- --service-dir threatbook__tip_v4
npm test -- --service-dir threatbook__tip_v4
```
