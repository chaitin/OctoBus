# Alibaba Cloud DDoS COO (2020-01-01)

OctoBus service package for Alibaba Cloud Anti-DDoS Pro/Premium API v2020-01-01.

## Features

- Query DDoS COO instances
- Query L7 website forwarding rules
- Query L4 port forwarding rules
- Query DDoS attack events
- Enable/disable CC protection for domains
- Configure CC protection template mode

## Import

```bash
octobus service import --id <service-id> packages/aliyun-ddoscoo-20200101
```

## Bindings

### Config

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `regionId` | string | `cn-hangzhou` | Alibaba Cloud region ID |
| `timeoutMs` | integer | 10000 | HTTP request timeout in milliseconds |

### Secret

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `accessKeyId` | string | Yes | Alibaba Cloud AccessKey ID |
| `accessKeySecret` | string | Yes | Alibaba Cloud AccessKey Secret |

## RPC Methods

| Method | Description |
|--------|-------------|
| `DescribeInstances` | Query DDoS COO instances |
| `DescribeDomainResource` | Query L7 website forwarding rules |
| `DescribeNetworkRules` | Query L4 port forwarding rules |
| `DescribeDDosAllEventList` | Query DDoS attack events |
| `EnableWebCC` | Enable/disable CC protection for a domain |
| `ConfigWebCCTemplate` | Set CC protection template mode |

## Error Mapping

| Upstream Error | gRPC Status |
|----------------|-------------|
| 401/403 HTTP | `PERMISSION_DENIED` |
| 400 HTTP | `FAILED_PRECONDITION` |
| 500+ HTTP | `UNAVAILABLE` |
| Network/read failure | `UNAVAILABLE` |
| Missing/invalid params | `INVALID_ARGUMENT` |
| Auth failure | `UNAUTHENTICATED` |
| `Throttling.*` | `UNAVAILABLE` |

## Validation

```bash
cd services
npm run validate -- --service-dir aliyun__ddoscoo_20200101
npm test
```
