# DAS APT / 明御APT攻击预警平台 OctoBus Service

OctoBus service package for read-only DAS APT asset lookup operations.

- Source API document version: `明御APT攻击预警平台V2.0R77版本对外API接口文档_144646.pdf`
- Observed live validation version: `V2.0R79C06` from `/openapi/about`

## Configuration

Use `host` for the DAS APT management base URL. Set `timeoutMs` for HTTP timeout in milliseconds, and `skipTlsVerify` only when connecting to a trusted appliance with a non-public or self-signed certificate.

```json
{
  "host": "https://apt.example.invalid",
  "timeoutMs": 5000,
  "skipTlsVerify": false
}
```

## Secrets

Use `secret.apikey` for the downstream `apikey` request header. Never hard-code the API key in source, config files, logs, README examples, or tests.

```json
{
  "apikey": "replace-with-api-key"
}
```

## Supported Capabilities

- `ListAssets`: lists assets by calling `POST /openapi/asset/list` with JSON body parameters.
- `GetAsset`: gets one asset by IP by calling `POST /openapi/asset/list` with `{ "offset": 0, "limit": 10, "ip": "<ip>" }`, then selecting the asset whose IP exactly matches the requested IP.

## Request and Response Shapes

Sanitized `ListAssets` upstream request shape:

```http
POST /openapi/asset/list
apikey: replace-with-api-key
content-type: application/json
```

```json
{
  "offset": 0,
  "limit": 10,
  "ip": "192.0.2.10"
}
```

Sanitized upstream response shape:

```json
{
  "code": 0,
  "msg": "success",
  "total": 1,
  "data": [
    {
      "ip": "192.0.2.10",
      "name": "example-asset",
      "status": "online"
    }
  ]
}
```

Field names and optional fields can vary by deployment. Examples above are placeholders only and do not contain real base URLs, API keys, asset details, customer-sensitive URLs, or validation evidence.

## Behavior Notes

- The PDF labels asset-list parameters as query parameters, but the running system expects JSON body parameters for `/openapi/asset/list`.
- All downstream requests send the API key through the `apikey` request header sourced from secrets.
- This first version is intentionally read-only. It does not implement asset mutation, grouping or tagging changes, UI-internal Bearer-token APIs, report export, or report download.

## Local Checks

```bash
cd services
npm run validate -- --service-dir das__apt
npm test -- --service-dir das__apt
```
