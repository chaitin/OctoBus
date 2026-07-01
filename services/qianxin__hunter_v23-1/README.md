# QiAnXin Hunter OctoBus Service

QiAnXin Hunter (鹰图) 网络空间测绘平台 API 封装。支持 IP 反查、域名搜索、组件识别、证书搜索等网络空间资产探测能力。

Import it into OctoBus with:

```bash
octobus service import --id qianxin-hunter ./services/qianxin__hunter_v23-1
```

## Service Metadata

- Vendor/product/version: QiAnXin Hunter openApi v1.
- Service name: `qianxin-hunter`.
- Service dir: `services/qianxin__hunter_v23-1`.
- Runtime mode: `long-running`.
- Runtime inspect: `node bin/qianxin-hunter.js --runtime inspect --json`.

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/hunter.proto`: gRPC API definition.
- `config.schema.json`: non-secret base URL, timeout, page size, and TLS settings.
- `secret.schema.json`: Hunter API Key field.
- `src/hunter.js`: Hunter REST API proxy implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/qianxin-hunter.js`: service-local executable entrypoint.
- `test/hunter.test.js`: node:test coverage for request validation, REST mapping, error mapping, and SDK handler invocation.
- `test/mock_upstream.js`: optional local Hunter HTTP mock.

## Supported Version

- **Platform**: QiAnXin Hunter (鹰图) network space search engine
- **API Base**: `https://hunter.qianxin.com/openApi/search`
- **API Version**: v1 (openApi)

## Configuration

Use `config` for base URL and HTTP settings:

```json
{
  "baseUrl": "https://hunter.qianxin.com",
  "timeoutMs": 15000,
  "defaultPageSize": 10,
  "skipTlsVerify": false
}
```

Use `secret` for the Hunter API Key:

```json
{
  "apiKey": "REDACTED"
}
```

Deprecated compatibility only: `config.apiKey` and `config.api_key` are still accepted as lower-priority fallbacks for older instances, but `secret` values always take precedence. Request `api_key` is ignored by the service.

> **API Key 获取方式**: 登录 `hunter.qianxin.com` → 个人中心 → API 管理。

## RPC Methods

- `qianxin.hunter.v1.HunterService/Search` - read, searches Hunter network space assets. It does not write to Hunter or managed assets.

## Search Query Syntax

> **编码说明**: `search` 参数使用 **RFC 4648 base64url** 编码（非标准 Base64），即 `+` → `-`, `/` → `_`。Node.js: `Buffer.from(query).toString('base64url')`

| Operator | Meaning | Example |
|----------|---------|---------|
| `=` | Fuzzy match | `ip="1.1.1.1"` |
| `==` | Exact match | `web.title=="login"` |
| `!=` | Fuzzy exclude | `ip!="1.1.1.1"` |
| `!==` | Exact exclude | `domain!=="test.com"` |
| `&&` | AND | `domain="example.com" && port="443"` |
| `\|\|` | OR | `(web.title="admin" \|\| web.title="login")` |

### Common Search Fields

| Field | Description |
|-------|-------------|
| `ip` | IP address |
| `domain` | Domain name |
| `port` | Port number |
| `protocol` | Protocol |
| `web.title` | Web page title |
| `web.body` | Web page body content |
| `web.status_code` | HTTP status code |
| `component` | Application component |
| `os` | Operating system |
| `cert_sha256` | SSL certificate SHA256 |
| `country` / `province` / `city` | Geographic location |
| `isp` | ISP operator |
| `as_org` | AS organization |
| `icp` | ICP record info |

### Query Examples

```
ip="1.1.1.1"
domain="example.com"
domain="example.com" && web.status_code="200"
port="443" && protocol="https"
component="nginx" && country="CN"
```

## Request Parameters

| Parameter | Required | Description | Default |
|-----------|----------|-------------|---------|
| `query` | Yes | Hunter search query string | — |
| `page` | No | Page number (starting from 1) | 1 |
| `page_size` | No | Results per page (10/50/100) | 10 |
| `is_web` | No | Asset type: 1=web, 2=non-web, 3=all | 3 |
| `status_code` | No | HTTP status code filter (e.g. "200,301") | — |
| `fields` | No | Comma-separated return fields | all |
| `start_time` | No | Start time (YYYY-MM-DD) | — |
| `end_time` | No | End time (YYYY-MM-DD) | — |

> **Credit Note**: Queries beyond 30 days consume extra credits.

## Error Mapping

| Scenario | gRPC Status |
|----------|-------------|
| Missing/invalid `query` parameter | `INVALID_ARGUMENT` |
| Missing/invalid secret `apiKey` | `INVALID_ARGUMENT` |
| Invalid page/page_size/is_web | `INVALID_ARGUMENT` |
| HTTP 401 (upstream auth failure) | `UNAUTHENTICATED` |
| HTTP 403 (upstream permission denied) | `PERMISSION_DENIED` |
| HTTP 5xx / network failure / TLS error | `UNAVAILABLE` |
| Non-JSON response body | `UNKNOWN` |
| Upstream business error (code != 200) | Returned in `error` field, not thrown |

## Risk Notes

- **只读操作**: 本 service 仅提供搜索查询，不涉及任何写入/修改/删除操作。
- **积分消耗**: 查询 30 天以外的数据会额外消耗 Hunter 平台积分。
- **数据时效**: 返回的资产数据为 Hunter 平台最近一次扫描的快照，非实时数据。
- **API Key 安全**: API Key 通过 secret.schema.json 管理，创建实例时由管理员填入，不在代码/日志中暴露。
- `timeoutMs` is enforced with `AbortSignal.timeout`; `skipTlsVerify` uses a per-request undici dispatcher and does not change global TLS settings.
- Upstream HTTP, non-JSON, read, and business errors are mapped without returning the API key or request credentials.
- Known limitation: this package only exposes Hunter search. It does not mutate Hunter data or verify asset freshness beyond Hunter's response fields.

## Suggested Capset

- `hunter-search`: 仅暴露 Search 方法，适用于需要网络空间测绘能力的 Agent。
- 可与封禁类 service（如防火墙 WAF）组合使用，形成"搜索资产 → 封禁 IP"的自动化链路。

## Local Checks

```bash
cd services
npm run validate -- --service-dir qianxin__hunter_v23-1
npm test -- --service-dir qianxin__hunter_v23-1
npm run pack:check
```

## Usage Example

```bash
# Import service
./bin/octobus service import --id qianxin-hunter ./services/qianxin__hunter_v23-1

# Create instance with API key
./bin/octobus instance create hunter-prod --service qianxin-hunter \
  --config-json '{"baseUrl":"https://hunter.qianxin.com","timeoutMs":15000}' \
  --secret-json '{"apiKey":"REDACTED"}'

# Create capset and bind
./bin/octobus capset create asset-search --name "Asset Search Agent"
./bin/octobus capset add-instance asset-search hunter-prod

# Call via Connect RPC
curl -X POST http://127.0.0.1:9000/capsets/asset-search/connect/hunter-prod/qianxin.hunter.v1.HunterService/Search \
  -H 'Content-Type: application/json' \
  -d '{"query":"domain=\"example.com\"","page":1,"page_size":10}'

# Call via MCP (AI Agent)
curl -X POST http://127.0.0.1:9000/capsets/asset-search/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"qianxin_hunter__hunter_prod__search","arguments":{"query":"ip=\"1.1.1.1\""}}}'
```
