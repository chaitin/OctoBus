# DBAudit

OctoBus service package for DBAudit OpenAPI operations.

## Configuration

- `baseUrl` / `base_url` / `endpoint`: DBAudit platform base URL, for example `https://demodbauditor.das-security.cn`.
- `apiVersion` / `api_version`: DBAudit OpenAPI version, default `2.0`.
- `timeoutMs` / `timeout_ms`: HTTP timeout in milliseconds, default `5000`.

## Secrets

- `accessKeyId` / `access_key_id` / `accessKey` / `access_key`: DBAudit OpenAPI AccessKey ID.
- `accessKeySecret` / `access_key_secret` / `accessSecret` / `access_secret`: DBAudit OpenAPI AccessKey Secret.

Requests are signed with DBAudit OpenAPI parameters: `data`, `accessKeyId`, `accessTime`, and `accessSign`, where `accessSign = md5(accessTime + "_" + accessKeySecret)`.

## Methods

- `ListIPFilters`: calls DBAudit `DescribeSipFilter`.
- `CreateIPFilter`: calls DBAudit `CreateSipFilter`.
- `GetSystemResource`: calls DBAudit `getSystemResource` and returns the raw upstream response.
- `QuerySystemResourceHistory`: calls DBAudit `GetAllSystemResourceByTimeRange`, `GetOneSystemResourceByTimeRange`, or `getSystemResource` for `realtime`.

Supported `time_preset` values are `realtime`, `last_1h`, `last_6h`, `last_1d`, `last_7d`, `last_14d`, `last_30d`, `today`, `this_week`, `this_month`, and `custom`.

Connect JSON responses use lowerCamel field names, so proto fields such as `ip_filter_list`, `total_count`, and `time_preset` appear as `ipFilterList`, `totalCount`, and `timePreset` over Connect/MCP.
