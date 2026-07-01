# ThreatBook OneSIG

OctoBus service package for ThreatBook OneSIG inbound blacklist block, list, and unblock APIs.

## Service Name

- Directory: `services/threatbook__onesig`
- Manifest name: `threatbook-onesig`
- Runtime entrypoint: `bin/threatbook-onesig.js`

## Import

```bash
octobus service import --id threatbook-onesig ./services/threatbook__onesig
```

## Package Layout

- `service.json`: OctoBus service package manifest.
- `proto/threatbook_onesig.proto`: Legacy-compatible gRPC API.
- `src/threatbook-onesig.js`: Runtime handlers, request validation, signing, response parsing, and error mapping.
- `config.schema.json`: Non-secret binding schema.
- `secret.schema.json`: API key and HMAC secret schema.
- `test/`: Node test coverage and mock upstream.

## Configuration

Config:

```json
{
  "base_url": "https://onesig.example.com",
  "timeoutMs": 1500,
  "signature_mode": "apiKey+timestamp",
  "timestamp_precision": "seconds",
  "encode_sign": true
}
```

Secrets:

```json
{
  "api_key": "replace-with-api-key",
  "secret": "replace-with-hmac-secret"
}
```

Supported config aliases are `baseUrl`, `allow_http`, `allowInsecureHttp`, `skipTlsVerify`, `tlsInsecureSkipVerify`, `signatureMode`, `timestampPrecision`, `encodeSign`, and `headers`. Supported secret aliases are `apiKey` and `Secret`.

## RPC Methods

- `ThreatBook_OneSIG.ThreatBook_OneSIG/BatchBlockIP`: `POST /v3/blacklist/inbound`
- `ThreatBook_OneSIG.ThreatBook_OneSIG/ListInboundBlacklistEntries`: `POST /v3/blacklist/inbound/list`
- `ThreatBook_OneSIG.ThreatBook_OneSIG/BatchUnblockByEntryIds`: `DELETE /v3/blacklist/inbound`

## Runtime Example

```js
import { handlers, METHOD_BATCH_BLOCK_FULL } from './threatbook__onesig/src/threatbook-onesig.js';

const result = await handlers[METHOD_BATCH_BLOCK_FULL]({
  config: { base_url: 'https://onesig.example.com' },
  secret: { api_key: process.env.ONESIG_API_KEY, secret: process.env.ONESIG_SECRET },
  request: {
    ip_addresses: ['1.1.1.1'],
    life_cycle_seconds: 3600,
    comments: 'case-123',
    threat_name: 'botnet'
  }
});
console.log(result);
```

## Behavior

- Every request appends `apikey`, `timestamp`, and `sign` query parameters.
- Default signing payload is `apiKey + timestamp`; `sign` is Base64 HMAC-SHA1 using `secret`.
- Success requires HTTP `200` and OneSIG `responseCode == 0`.
- HTTP non-200 maps to `UNAVAILABLE`.
- `responseCode != 0` maps to `FAILED_PRECONDITION`.
- Invalid or empty JSON maps to `UNKNOWN`.
- API key, HMAC secret, and signature material are redacted from logs and errors.

## Limitations

- This package covers only OneSIG inbound blacklist block/list/unblock APIs.
- IP address syntax is only checked for non-empty strings locally; OneSIG performs semantic validation.
- `comments` and `threat_name` are capped at 20 characters.
- OneSIG HTTP auth, rate-limit, and server failures all map to `UNAVAILABLE` for compatibility with the legacy wrapper.

## Validation

```bash
cd services
npm run validate -- --service-dir threatbook__onesig
npm test -- --service-dir threatbook__onesig
```
