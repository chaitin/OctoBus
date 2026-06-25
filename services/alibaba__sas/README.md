# Alibaba Cloud Security Center (Container Security) Service Package

OctoBus service package for [Alibaba Cloud Security Center](https://www.aliyun.com/product/security-center) (云安全中心) container security features.

## Supported Version

Alibaba Cloud SAS API version `2018-12-03`.

## Authentication

Uses [Alibaba Cloud RPC HMAC-SHA1](https://help.aliyun.com/zh/security-center/developer-reference/api-1/) signing with `AccessKeyId` and `AccessKeySecret`.

- **access_key_id** / **accessKeyId**: Alibaba Cloud AccessKey ID.
- **access_key_secret** / **accessKeySecret**: Alibaba Cloud AccessKey Secret.

Obtain credentials from [Alibaba Cloud RAM](https://ram.console.aliyun.com/manage/accesskey).

## Package Structure

```
services/alibaba__sas/
  service.json              — OctoBus service manifest
  proto/alibaba_sas.proto   — gRPC API definitions
  config.schema.json        — non-secret configuration schema
  secret.schema.json        — secret credentials schema
  src/service.js            — OctoBus SDK defineService wrapper
  src/alibaba-sas.js        — RPC HMAC-SHA1 signed API implementation
  bin/alibaba-sas.js        — service-local executable entry point
  test/alibaba-sas.test.js  — node:test coverage
  README.md                 — this file
```

## Configuration

### Config (non-secret fields)

```json
{
  "region": "cn-hangzhou",
  "endpoint": "sas.aliyuncs.com",
  "timeoutMs": 10000,
  "skipTlsVerify": false
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `region` | `cn-hangzhou` | Alibaba Cloud region |
| `endpoint` | `sas.aliyuncs.com` | API endpoint hostname |
| `timeoutMs` | `10000` | HTTP request timeout (ms) |
| `skipTlsVerify` | `false` | Skip TLS verification |

### Secret (sensitive fields)

```json
{
  "access_key_id": "your-access-key-id",
  "access_key_secret": "your-access-key-secret"
}
```

Both `snake_case` and `camelCase` field names are accepted.

## Import

```bash
octobus service import --id alibaba-sas ./services//alibaba__sas
```

## RPC Methods

| gRPC Method | CLI Command | Description |
|-------------|-------------|-------------|
| `Alibaba_SAS.Alibaba_SAS/ListContainerInstances` | `list-container-instances` | List container instances |
| `Alibaba_SAS.Alibaba_SAS/ListImageInstances` | `list-image-instances` | List container image instances |
| `Alibaba_SAS.Alibaba_SAS/ListImageVulnerabilities` | `list-image-vulnerabilities` | List container image vulnerabilities |
| `Alibaba_SAS.Alibaba_SAS/GetClusterSuspEventStatistics` | `get-cluster-susp-event-statistics` | Get cluster security event statistics |
| `Alibaba_SAS.Alibaba_SAS/ListClusterInterceptionConfig` | `list-cluster-interception-config` | List cluster interception rules |

### Container Instance Management

**ListContainerInstances** — Query container instances with search criteria:

| Parameter | Type | Description |
|-----------|------|-------------|
| `current_page` | int64 | Page number (1-based) |
| `page_size` | int64 | Page size (default 20, max 200) |
| `criteria` | string | Search criteria (e.g., `cluster:k8s-prod`, `namespace:default`) |
| `logical_exp` | string | Logical operator: `AND` or `OR` |

### Image Management

**ListImageInstances** — Query container image instances:

| Parameter | Type | Description |
|-----------|------|-------------|
| `current_page` | int64 | Page number |
| `page_size` | int64 | Page size |
| `criteria` | string | Search criteria |
| `logical_exp` | string | Logical operator |

### Vulnerability Management

**ListImageVulnerabilities** — Query image vulnerabilities:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `image_uuid` | string | Yes | Image UUID to query |
| `current_page` | int64 | No | Page number |
| `page_size` | int64 | No | Page size |
| `name` | string | No | Filter by vulnerability name |
| `level` | string | No | Filter by level: `high`, `medium`, `low` |
| `vul_type` | string | No | Filter by type: `sca`, `cve` |

### Security Event Statistics

**GetClusterSuspEventStatistics** — Get cluster security event statistics (no parameters).

### Interception Configuration

**ListClusterInterceptionConfig** — List cluster interception rules:

| Parameter | Type | Description |
|-----------|------|-------------|
| `cluster_id` | string | Filter by cluster ID |
| `current_page` | int64 | Page number |
| `page_size` | int64 | Page size |

## Behavior Notes

- All API calls use **POST** to `sas.aliyuncs.com` with HMAC-SHA1 RPC signing.
- HTTP 401 maps to `UNAUTHENTICATED`; HTTP 403 maps to `PERMISSION_DENIED`.
- Other HTTP 4xx maps to `FAILED_PRECONDITION`.
- HTTP 5xx and network errors map to `UNAVAILABLE`.
- Alibaba Cloud API `InvalidAccessKeyId` / `SignatureDoesNotMatch` map to `UNAUTHENTICATED`.
- Non-JSON responses map to `UNKNOWN`.
- Missing credentials map to `FAILED_PRECONDITION`.
- Missing required request parameters (e.g., `image_uuid`) map to `INVALID_ARGUMENT`.

## Risk & Recommended Capset

**Risk**: All operations are read-only queries. No write operations are implemented.

**Recommended `capset`**: `["recon"]`

## Validation

```bash
cd services
npm run validate -- --service-dir alibaba__sas
npm test -- --service-dir alibaba__sas --coverage
npm run pack:check
```

## Known Limitations

1. Pagination results may require multiple calls for large datasets.
2. The `criteria` search syntax depends on the Alibaba Cloud SAS API implementation.
3. Write operations (e.g., vulnerability fix, container block) are not yet implemented.
4. Response field names may vary between Alibaba Cloud SAS API versions.
