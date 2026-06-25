# YXLink WAF

OctoBus service package for YXLink WAF external API v2.1/v2.2 style interfaces. It covers Web tamper resistance management and intrusion log query/delete/count workflows from the provided YXLink WAF API document.

## Supported Version

- Product: YXLink Web Application Firewall
- API document: `YXLink WAF 对外 API 接口文档 v2.1`, with document history mentioning v2.2 updates for daily intrusion count.
- Auth: signed `Authorization` HTTP header built from `appId`, random `nonceStr`, Unix `timestamp`, and SHA1 signature with `appSecret`.

## Configuration

Instance config example:

```json
{
  "host": "https://waf.example.com",
  "timeoutMs": 5000,
  "skipTlsVerify": false
}
```

Aliases `baseUrl` and `restBaseUrl` are accepted for `host`.

Instance secret example:

```json
{
  "appId": "your-app-id",
  "appSecret": "your-app-secret"
}
```

Aliases `app_id` and `app_secret` are accepted.

## Methods

| Method | Upstream API | Notes |
| --- | --- | --- |
| `ListTamperSites` | `POST /api/tamperresistance/tamperresistanceforweb/paginate` | Lists Web tamper resistance records with `start` and `limit`. |
| `CreateTamperSite` | `POST /api/tamperresistance/tamperresistanceforweb/create` | Creates one monitored site. |
| `UpdateTamperSite` | `POST /api/tamperresistance/tamperresistanceforweb/update` | Updates one monitored site by `id`. |
| `DeleteTamperSites` | `POST /api/tamperresistance/tamperresistanceforweb/remove` | Deletes one or more tamper records by comma-joined IDs. |
| `EnableTamperSites` | `POST /api/tamperresistance/tamperresistanceforweb/enable` | Starts monitoring for one or more records. |
| `DisableTamperSites` | `POST /api/tamperresistance/tamperresistanceforweb/disable` | Stops monitoring for one or more records. |
| `RebuildTamperBackups` | `POST /api/tamperresistance/tamperresistanceforweb/rebuildBackup` | Rebuilds backups for one or more records. |
| `ListIntrusionLogs` | `POST /api/intrusionprevention/intrusionlog/paginate` | Lists intrusion logs in `normal` or `summary` view. |
| `DeleteIntrusionLogs` | `POST /api/intrusionprevention/intrusionlog/remove` | Deletes intrusion logs; normal view uses `id_date`, summary view can use `id_list`. |
| `CountIntrusionLogs` | `POST /api/intrusionprevention/intrusionlog/count?date=...` | Returns intrusion log count for a date. |

## Risk Notes

- `CreateTamperSite`, `UpdateTamperSite`, `DeleteTamperSites`, `EnableTamperSites`, `DisableTamperSites`, and `RebuildTamperBackups` change device state.
- `DeleteIntrusionLogs` deletes audit/security event records. Use a test object or backup/export logs before invoking it.
- Deletion APIs are not reversible through this adapter.
- The adapter does not log request bodies or secrets; avoid putting real credentials or production addresses in tests, README snippets, or PR screenshots.

## Write Operation Semantics

- `CreateTamperSite` defaults to `start=false`, `schedule=1`, `filecharset=gbk`, `connect=1`, `folder=/`, and `parallel=5` when those fields are omitted. `port`, `quickdiff`, and `maxsize` are required to avoid silently creating an unsafe monitor.
- The upstream API document does not describe idempotency keys. Treat create/delete/update/enable/disable/rebuild calls as non-idempotent device operations and retry only after checking the current device state.
- Rollback must be performed with the corresponding device operation, such as disabling a monitor, restoring an exported log backup, or recreating a deleted record from a saved copy.
- Preserve OctoBus request metadata and device-side operation logs when using write methods in production; this adapter does not emit additional audit records by itself.

## Suggested Capsets

- Read-only SOC capset: `ListTamperSites`, `ListIntrusionLogs`, `CountIntrusionLogs`
- WAF operations capset: add `EnableTamperSites`, `DisableTamperSites`, `RebuildTamperBackups`
- Break-glass admin capset: add create/update/delete methods and require stricter token controls

## Local Validation

From the repository root:

```bash
cd services
npm run validate -- --service-dir yxlink__waf
npm test -- --service-dir yxlink__waf
npm run pack:check
```

## Example

```bash
./bin/octobus service import yxlink-waf ./services/yxlink__waf
./bin/octobus instance create yxlink-waf-test \
  --service yxlink-waf \
  --config-json '{"host":"https://waf.example.com","timeoutMs":5000}' \
  --secret-json '{"appId":"demo-app","appSecret":"demo-secret"}'
./bin/octobus capset create waf-ops --name WafOps
./bin/octobus capset add-instance waf-ops yxlink-waf-test
```
