# ThreatBook TDP

OctoBus service package for ThreatBook TDP domain block and unblock APIs.

## Service Name

- Directory: `services/threatbook__tdp`
- Manifest name: `threatbook-tdp`
- Runtime entrypoint: `bin/threatbook-tdp.js`

## Import

```bash
octobus service import --id threatbook-tdp ./services/threatbook__tdp
```

## Package Layout

- `service.json`: OctoBus service package manifest.
- `proto/threatbook_tdp.proto`: Legacy-compatible gRPC API.
- `src/threatbook-tdp.js`: Runtime handlers, request validation, signing, response parsing, and error mapping.
- `config.schema.json`: Non-secret binding schema.
- `secret.schema.json`: API key and HMAC secret schema.
- `test/`: Node test coverage and mock upstream.

## Configuration

Config:

```json
{
  "restBaseUrl": "https://tdp.example.com",
  "timeoutMs": 2000
}
```

Secrets:

```json
{
  "api_key": "replace-with-api-key",
  "secret": "replace-with-hmac-secret"
}
```

Supported config aliases are `baseUrl`, `skipTlsVerify`, `tlsInsecureSkipVerify`, and `headers`. Supported secret aliases are `apiKey` and `Secret`.

## RPC Methods

- `ThreatBook_TDP.ThreatBook_TDP/BlockDomain`: sends `operate: "add"` to `POST /api/v1/linkage_block/deny_list/operate`
- `ThreatBook_TDP.ThreatBook_TDP/UnblockDomain`: sends `operate: "delete"` to `POST /api/v1/linkage_block/deny_list/operate`

## Runtime Example

```js
import { handlers, METHOD_BLOCK_DOMAIN_FULL } from './threatbook__tdp/src/threatbook-tdp.js';

const result = await handlers[METHOD_BLOCK_DOMAIN_FULL]({
  config: { restBaseUrl: 'https://tdp.example.com' },
  secret: { api_key: process.env.TDP_API_KEY, secret: process.env.TDP_SECRET },
  request: {
    ioc_list: ['bad.example'],
    remark: 'case-123'
  }
});
console.log(result);
```

## Behavior

- Every request appends `api_key`, `auth_timestamp`, and URL-safe HMAC-SHA256 `sign` query parameters.
- `block_direction` is always `out`.
- Successful HTTP statuses are `200`, `201`, `204`, `209`, and `210`.
- Success with an empty body returns `data: null`.
- Success with JSON returns the parsed upstream JSON as `google.protobuf.Value`.
- Successful HTTP with `response_code`, `responseCode`, or `code` not equal to `0` maps to `FAILED_PRECONDITION`.
- HTTP `401` / `403` maps to `PERMISSION_DENIED`.
- Other HTTP `4xx` maps to `FAILED_PRECONDITION`.
- HTTP `5xx`, network errors, and response read errors map to `UNAVAILABLE`.
- Invalid JSON on a successful HTTP status maps to `UNKNOWN`.
- API key, HMAC secret, and signature material are redacted from logs and errors.

## Limitations

- This package only manages TDP outbound domain deny-list operations.
- Domain syntax is checked only for non-empty strings locally; TDP performs semantic validation.
- `remark` is optional; when omitted, a Chinese legacy default remark is generated from the first domain and count.

## Validation

```bash
cd services
npm run validate -- --service-dir threatbook__tdp
npm test -- --service-dir threatbook__tdp
```
