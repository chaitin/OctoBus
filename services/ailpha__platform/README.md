# AiLPHA Security Platform

OctoBus service package for the AiLPHA SIEM/SOC platform (V5.1) REST API.

## Import

```bash
octobus service import --id ailpha-platform ./services/ailpha__platform
```

## Configuration

Set `endpoint` to the platform base URL. `timeoutMs` (default 1500), `headers`, and `skipTlsVerify` are optional.

```json
{
  "endpoint": "https://ailpha.example.com",
  "timeoutMs": 3000
}
```

Secret: `apiKey` sent as the `apiKey` HTTP header.

```json
{
  "apiKey": "<api-key>"
}
```

## Behavior

- `ListMergeAlarms` calls `GET /openapi/v2.0/merge-alarms` with optional filters (`order_by`, `page`, `size`, `condition`, `connect_type`, `start_time`, `end_time`). Returns alarm list as Struct.
- `GetMergeAlarmDetail` calls `GET /openapi/v1.0/merge-alarm/detail`. Requires `agg_condition` and `window_id`.
- `UpdateMergeAlarmStatus` calls `POST /openapi/v2.0/merge-alarms/status`. Requires `alarm_status` and a selector (`condition` or `start_time`+`end_time`).
- `ListLinkageStrategies` calls `GET /openapi/v1.0/linkage-strategies` to list blocking strategies.
- `BlockIp` calls `POST /openapi/v1.0/linkage-strategies/{ids}/accessIp`.
- `UnblockIp` calls `DELETE /openapi/v1.0/linkage-strategies/{ids}/blockIp`. Idempotent: 404 returns empty success.
- Missing endpoint or API key returns `INVALID_ARGUMENT`. HTTP 401 maps to `UNAUTHENTICATED`. HTTP 403 maps to `PERMISSION_DENIED`. HTTP 404 (non-idempotent) maps to `NOT_FOUND`. Other 4xx maps to `FAILED_PRECONDITION`. Network errors and 5xx map to `UNAVAILABLE`.

## Local Checks

```bash
cd services
npm run validate -- --service-dir ailpha__platform
npm test -- --service-dir ailpha__platform --coverage
npm run pack:check
```
