# m01 Mail Gateway — Intelligence

OctoBus service package for the m01 mail security gateway local threat-intelligence APIs.

## Import

```bash
octobus service import --id m01-intelligence ./services/m01__intelligence
```

## Configuration

Set `endpoint` to the gateway base URL. `timeoutMs` (default 1500), `headers`, and `skipTlsVerify` are optional.

```json
{
  "endpoint": "http://192.168.2.225:9003",
  "timeoutMs": 3000
}
```

Secret: `apiKey` (header `x-api-key`) or `apiToken` (Bearer JWT). The API key takes precedence.

```json
{
  "apiKey": "<x-api-key>"
}
```

## Behavior

- `DetectIntelligence` calls `POST /m01/intelligence/detection`. Each query item requires `pattern`, `type`, and `request_id`.
- `ListIntelligence` calls `POST /m01/intelligence/list` with optional status, pattern, attribute, and time-range filters.
- `AddIntelligence` calls `POST /m01/intelligence/add`. Required per item: `tlp`, `urgency`, `attribute`, `pattern`. Returns success/failure counts.
- `UpdateIntelligence` calls `POST /m01/intelligence/update` by item `id`.
- `DeleteIntelligence` calls `POST /m01/intelligence/delete`. Required per item: `intelligence_id`, `intelligence_type`, `pattern`, `pattern_type`.
- `GetIntelligenceStats` calls `GET /m01/intelligence/stats` and returns total, active, and revoked counts.
- Missing endpoint or credentials returns `INVALID_ARGUMENT`. HTTP 401/403 maps to `PERMISSION_DENIED`. Other 4xx maps to `FAILED_PRECONDITION`. Network errors and 5xx map to `UNAVAILABLE`.

## Local Checks

```bash
cd services
npm run validate -- --service-dir m01__intelligence
npm test -- --service-dir m01__intelligence --coverage
npm run pack:check
```
