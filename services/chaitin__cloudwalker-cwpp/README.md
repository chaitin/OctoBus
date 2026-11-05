# CloudWalker CWPP OctoBus Service

牧云 CloudWalker CWPP（主机安全）主机/agent 状态与实时威胁事件只读查询适配器。

```bash
octobus service import cloudwalker-cwpp ./services/chaitin__cloudwalker-cwpp
```

## Package Files

- `service.json` — OctoBus 服务清单。
- `proto/cloudwalker_cwpp.proto` — gRPC API 定义，3 个 unary 方法。
- `config.schema.json` — 非密配置：`baseUrl`、`skipTlsVerify`、`proxy_url` 等。
- `secret.schema.json` — 密钥配置：`token`（必填）。
- `src/cloudwalker-cwpp.js` — 上游 JSON-RPC 请求映射、响应归一化、错误分类。
- `src/service.js` — OctoBus SDK `defineService` 封装。
- `test/cloudwalker-cwpp.test.js` — node:test 覆盖请求映射、响应归一化、错误分类。

## 认证方式

JSON-RPC 2.0 over HTTP `POST /rpc`，认证头为 Cookie：

| 字段 | 必填 | 说明 |
|------|------|------|
| `token` | 是 | 牧云 API Token，以 `Cookie: API-Token=<token>` 发送 |

## Configuration

```json
{
  "baseUrl": "https://<ip>",
  "skipTlsVerify": false
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `baseUrl` | string | 是 | 牧云 CWPP 设备 base URL |
| `skipTlsVerify` | boolean | 否 | 跳过 TLS 证书校验（设备自签证书） |
| `proxy_url` / `proxyUrl` | string | 否 | 可选 SOCKS/HTTP 代理 URL |
| `timeoutMs` | integer | 否 | HTTP 超时毫秒数，默认 30000 |

Secret：

```json
{ "token": "<API-Token>" }
```

## RPC Methods

| 方法 | 上游 API | 说明 |
|------|----------|------|
| `Chaitin_CloudWalker_CWPP.Chaitin_CloudWalker_CWPP/ListRealTimeEvents` | `ThreatOverviewService.ListRealTimeEvents` | 查询实时威胁事件 |
| `Chaitin_CloudWalker_CWPP.Chaitin_CloudWalker_CWPP/GetHostAssetList` | `HostAssetService.GetHostAssetList` | 查询主机资产列表（在线状态） |
| `Chaitin_CloudWalker_CWPP.Chaitin_CloudWalker_CWPP/GetAgentGroupTree` | `AgentService.GetAgentGroupTree` | 查询 agent 分组树 |

## Risk Boundary

- **风险等级**: `read-only`
- 3 个方法均为只读查询，不修改牧云平台任何数据。
