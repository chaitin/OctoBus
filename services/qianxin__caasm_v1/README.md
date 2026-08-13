# QiAnXin CAASM OctoBus Service

奇安信网络资产攻击面管理系统 (CAASM) API 封装。支持资产查询、漏洞查询和系统管理数据查询，共 12 个 RPC 方法。

Import it into OctoBus with:

```bash
octobus service import qianxin-caasm ./services/qianxin__caasm_v1
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/caasm.proto`: gRPC API definition (3 services, 12 methods).
- `config.schema.json`: non-secret base URL, path prefix, timeout, and TLS settings.
- `secret.schema.json`: CAASM appKey and appSecret fields.
- `src/auth.js`: HMAC-SHA256 signature generation for CAASM Zeus authentication.
- `src/client.js`: HTTP/HTTPS client with configurable TLS verification.
- `src/mappers.js`: Request/response mapping and pagination logic.
- `bin/qianxin-caasm.js`: OctoBus SDK `defineService` entry point with handler factories.
- `test/mappers.test.js`: Unit tests for request building, response wrapping, and pagination.
- `test/auth.test.js`: Unit tests for HMAC-SHA256 signature generation.

## Supported Version

- **Platform**: 奇安信网络资产攻击面管理系统 (CAASM)
- **Auth Scheme**: Zeus HMAC-SHA256 (`appKey`, `appSecret`)
- **API Path Prefix**: `/caasm/v1/biz-service`

## Configuration

Use `config` for base URL and HTTP settings:

```json
{
  "baseUrl": "https://caasm.example.com",
  "pathPrefix": "/caasm/v1/biz-service",
  "timeoutMs": 30000
}
```

For self-signed certificates (common in internal deployments):

```json
{
  "baseUrl": "https://caasm.example.com",
  "insecureTls": true
}
```

Use `secret` for the CAASM API credentials:

```json
{
  "appKey": "your-caasm-app-key",
  "appSecret": "your-caasm-app-secret"
}
```

> **凭据获取方式**: 联系 CAASM 平台管理员获取 `appKey` 和 `appSecret`。

## RPC Methods

### AssetService (资产)

| Method | Description | Notes |
|--------|-------------|-------|
| `GetDevices` | 查询硬件资产 | 155K+ records |
| `GetSoftware` | 查询已安装软件 | 5M+ records, large table |
| `GetServices` | 查询网络服务 | 15M+ records, large table ⚠️ may timeout |
| `GetComponents` | 查询软件组件 | 19M+ records, large table |
| `GetWebsites` | 查询 Web 应用 | 4K+ records |

### VulnerabilityService (漏洞)

| Method | Description | Notes |
|--------|-------------|-------|
| `GetSysVulnerabilities` | 查询系统漏洞 | 167K+ records |
| `GetSysWeakPasswords` | 查询系统弱口令 | 4K+ records |
| `GetWebVulnerabilities` | 查询 Web 漏洞 | |
| `GetWebWeakPasswords` | 查询 Web 弱口令 | |

### AdminService (管理)

| Method | Description | Notes |
|--------|-------------|-------|
| `GetUsers` | 查询用户列表 | Client-side pagination (CAASM ignores offset/limit) |
| `GetOrganizations` | 查询组织架构树 | Client-side pagination (CAASM ignores offset/limit) |
| `GetRoles` | 查询角色列表 | |

## Pagination

All methods accept `offset`, `limit`, and optional `filter` (JSON string) parameters.

- **Normal endpoints**: Offset and limit are forwarded to CAASM. Max limit is 100.
- **Large-table endpoints** (software, services, components): Max limit is clamped to 10 to avoid CAASM gateway timeouts.
- **Admin endpoints** (users, organizations): CAASM ignores pagination entirely, so the handler sends an empty body and applies client-side slicing. The `total` field always reflects the real upstream count.

## Response Format

All methods return a JSON string in the `json` field:

```json
{
  "items": [
    { "asset_code": "Dev-001", "hostname": "web-server-01", ... }
  ],
  "total": 155951
}
```

This format avoids proto Struct's verbose `{kind:{oneofKind:"stringValue",...}}` wrapper, making MCP `structuredContent` directly readable by AI tools.

## Error Mapping

| Scenario | gRPC Status |
|----------|-------------|
| Missing `baseUrl` in config | `UNAUTHENTICATED` |
| Missing `appKey` or `appSecret` | `UNAUTHENTICATED` |
| Invalid filter JSON string | `INVALID_ARGUMENT` |
| HTTP 401 / 403 | `UNAUTHENTICATED` |
| HTTP 5xx | `UNAVAILABLE` |
| Network / timeout / DNS / TLS error | `UNAVAILABLE` |
| Non-JSON response body | `UNAVAILABLE` |

## Risk Notes

- **只读操作**: 本 service 仅提供查询，不涉及任何写入/修改/删除操作。
- **API 凭据安全**: `appKey` 和 `appSecret` 通过 `secret.schema.json` 管理，创建实例时由管理员填入，不在代码/日志中暴露。
- **大表查询限制**: `GetServices` (15M+)、`GetComponents` (19M+)、`GetSoftware` (5M+) 查询需要精确的过滤条件，无条件全量查询可能导致 CAASM nginx 网关超时。
- **分页不一致**: `GetUsers` 和 `GetOrganizations` 的 CAASM API 不接受 offset/limit，handler 通过客户端切片补偿。

## Suggested Capsets

- `caasm-asset`: 暴露 AssetService 全部 5 个方法，适用于资产盘点 Agent。
- `caasm-vuln`: 暴露 VulnerabilityService 全部 4 个方法，适用于漏洞扫描 Agent。
- `caasm-admin`: 暴露 AdminService 全部 3 个方法，适用于用户/组织管理 Agent。
- `caasm-full`: 暴露全部 12 个方法，适用于需要完整 CAASM 能力的综合安全 Agent。

## Local Checks

```bash
cd services/qianxin__caasm_v1
npm install
npx octobus-sdk validate --strict
node --test
npm pack --dry-run
```

## Usage Example

```bash
# Import service
octobus service import qianxin-caasm ./services/qianxin__caasm_v1

# Create instance
octobus instance create caasm-prod --service qianxin-caasm \
  --config-json '{"baseUrl":"https://caasm.example.com","timeoutMs":30000}' \
  --secret-json '{"appKey":"your-app-key","appSecret":"your-app-secret"}'

# Create capset and bind
octobus capset create asset-search --name "Asset Search Agent"
octobus capset add-instance asset-search caasm-prod

# Call via Connect RPC
curl -X POST http://127.0.0.1:9000/capsets/asset-search/connect/caasm-prod/AssetService/GetDevices \
  -H 'Content-Type: application/json' \
  -d '{"offset":0,"limit":10}'

# Call via MCP (AI Agent)
curl -X POST http://127.0.0.1:9000/capsets/asset-search/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"caasm_service__caasm_prod__get_devices","arguments":{"limit":10}}}'
```
