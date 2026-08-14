# TopSec EDR (天融信终端威胁防御系统)

OctoBus service package for TopSec EDR management center API integration.

The RPC surface is defined by `proto/topsec_edr.proto`; the implementation does not expose additional compatibility methods.

## Import

```bash
octobus service import --id topsec-edr ./services/topsec__edr
```

## Behavior

- `Login` maps to `POST /auth/token`; the service encrypts the plaintext password via 3×MD5 + 3×SHA256 (toUpperCase), then AES-256-CBC encrypts the full JSON body (`{ng-cloud, username, password, captcha, tenant_id, captcha_id}`) into `{encryptStr: <base64>}`. The response `encryptStr` is decrypted to obtain the JWT token.
- `ListClients` maps to `POST /api/v1/getCustomList?collection=terminalManager` with signed query params and an encrypted pagination body.
- `GetClient` maps to `POST /api/v1/getCustomList?collection=terminalManager` with `{client_id}` in the encrypted body.
- `GetAlertStats` maps to `GET /api/v1/audit/stat` with signed query params. Returns threat scan/vuln/intrusion statistics.
- `GetSystemView` maps to `GET /api/v1/view/system_view` with signed query params. Returns terminal counts, server info (CPU/memory/disk/network), and license info.
- `GetSystemInfo` maps to `GET /api/v1/view/system_view` (same endpoint as GetSystemView, parsed for system resource fields).
- Successful HTTP responses include `status_code` and `raw_body`. Authentication failures, other non-2xx responses, malformed JSON, network errors, and timeouts are mapped to typed gRPC errors without exposing credentials or upstream response bodies.

## Authentication Flow

1. `POST /auth/token` with `{encryptStr: AES-256-CBC-PKCS7(JSON)}`
2. Decrypt response `encryptStr` to obtain JWT token
3. Each subsequent API call:
   - Generate fresh `nonce` (8 random digits) and `stime` (Unix timestamp)
   - Compute `sign = MD5(token + stime + nonce + "dO(QK*EX@cTG")`
   - Add nonce/stime/sign as query params
   - Send `Authorization: Bearer <token>`
   - Request/response bodies use `{encryptStr: AES-256-CBC-PKCS7 base64}` format

## AES Encryption

- Algorithm: AES-256-CBC with PKCS7 padding
- Key: `6ZlcPK5xfRrd7W1oyIqVgiHGbamhBAJ3` (32 bytes, extracted from EDR frontend JS)
- IV:  `6ZlcPK5xfRrd7W1o` (first 16 bytes of key)
- Encrypt: plaintext → AES → base64 ciphertext
- Decrypt: base64 ciphertext → AES → UTF-8

## Password Hashing

Password is hashed before encryption via EDR frontend `setPassword()`:
- Rounds 0–2: `MD5(password) → MD5(MD5(…)) → MD5(MD5(MD5(…)))`
- Rounds 3–5: `SHA256 → SHA256(SHA256(…)) → SHA256(SHA256(SHA256(…)))`
- Final: `.toUpperCase()`

## Session

Callers keep `SessionContext` between RPC calls:

- `token` — JWT token from login response

Nonce/stime/sign are generated fresh per request (not stored in session).

## Local Checks

```bash
cd services
npm run validate -- --service-dir topsec__edr
npm test -- --service-dir topsec__edr --coverage
npm run pack:check
```

## Known Limitations

1. Captcha-protected logins are not supported (the EDR instance tested has `disable_captcha: true`)
2. The `getCustomList` endpoint may return column configuration rather than actual terminal data depending on EDR version and authorization state
3. All API paths are prefixed with `/api/v1` (EDR SERVER_URL); direct paths like `/terminal/list` return 403 on the tested EDR version
