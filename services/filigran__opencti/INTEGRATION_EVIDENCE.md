# OpenCTI (Filigran) 联调证据

以下证据来自本地 OctoBus + OpenCTI 7.x 真实环境，所有调用经 OctoBus gRPC gateway 中转。

脱敏说明：

- OctoBus Admin Token 和 OpenCTI API Token 已脱敏为 `<OCTOBUS_ADMIN_TOKEN>` / `<OPENCTI_API_TOKEN>`。
- 本地回环地址 `127.0.0.1` / `localhost` 保留。
- 请求路径、gRPC 方法名、响应结构和业务字段保留。
- 测试数据使用 `10.0.0.99` / `172.16.0.1` / `10.10.10.1` 等非公网 IP。

## 环境信息

| 组件 | 版本 | 地址 |
|------|------|------|
| OctoBus | latest | 127.0.0.1:19000 (admin + gRPC gateway) |
| OpenCTI | 7.x | http://localhost:8080 (GraphQL API) |
| grpcurl | 1.9.3 | — |

## 1. gRPC Reflection — OctoBus proto 注册标识

```bash
grpcurl -plaintext \
  -H "x-octobus-capset: opencti-write" \
  -H "authorization: Bearer <OCTOBUS_ADMIN_TOKEN>" \
  127.0.0.1:19000 list
```

```
Filigran_OPENCTI.Filigran_OPENCTI
```

> **说明**: `Filigran_OPENCTI.Filigran_OPENCTI` 是 OctoBus gRPC gateway 的 proto 注册标识。直连 OpenCTI GraphQL 不会有此输出。

## 2. Service Describe — 6 个 RPC 方法

```bash
grpcurl -plaintext \
  -H "x-octobus-capset: opencti-write" \
  -H "authorization: Bearer <OCTOBUS_ADMIN_TOKEN>" \
  127.0.0.1:19000 describe Filigran_OPENCTI.Filigran_OPENCTI
```

```
Filigran_OPENCTI.Filigran_OPENCTI is a service:
service Filigran_OPENCTI {
  // 创建威胁指标
  rpc CreateIndicator ( .Filigran_OPENCTI.CreateIndicatorRequest ) returns ( .Filigran_OPENCTI.CreateIndicatorResponse );
  // 创建网络可观测对象
  rpc CreateObservable ( .Filigran_OPENCTI.CreateObservableRequest ) returns ( .Filigran_OPENCTI.CreateObservableResponse );
  // 创建威胁报告
  rpc CreateReport ( .Filigran_OPENCTI.CreateReportRequest ) returns ( .Filigran_OPENCTI.CreateReportResponse );
  // 搜索威胁指标（IOC），支持关键字、类型过滤与分页
  rpc SearchIndicators ( .Filigran_OPENCTI.SearchIndicatorsRequest ) returns ( .Filigran_OPENCTI.SearchIndicatorsResponse );
  // 搜索网络可观测对象（IP/域名/Hash/URL 等）
  rpc SearchObservables ( .Filigran_OPENCTI.SearchObservablesRequest ) returns ( .Filigran_OPENCTI.SearchObservablesResponse );
  // 搜索威胁报告
  rpc SearchReports ( .Filigran_OPENCTI.SearchReportsRequest ) returns ( .Filigran_OPENCTI.SearchReportsResponse );
}
```

## 3. Capset 路径 — OctoBus 权限模型

```bash
OCTOBUS_ADMIN_TOKEN=<token> octobus capset list-methods opencti-write --addr 127.0.0.1:19000
```

```json
{
  "methods": [
    { "MethodFullName": "Filigran_OPENCTI.Filigran_OPENCTI/CreateIndicator", "MCPToolName": "opencti__opencti-local__create_indicator" },
    { "MethodFullName": "Filigran_OPENCTI.Filigran_OPENCTI/CreateObservable", "MCPToolName": "opencti__opencti-local__create_observable" },
    { "MethodFullName": "Filigran_OPENCTI.Filigran_OPENCTI/CreateReport", "MCPToolName": "opencti__opencti-local__create_report" },
    { "MethodFullName": "Filigran_OPENCTI.Filigran_OPENCTI/SearchIndicators", "MCPToolName": "opencti__opencti-local__search_indicators" },
    { "MethodFullName": "Filigran_OPENCTI.Filigran_OPENCTI/SearchObservables", "MCPToolName": "opencti__opencti-local__search_observables" },
    { "MethodFullName": "Filigran_OPENCTI.Filigran_OPENCTI/SearchReports", "MCPToolName": "opencti__opencti-local__search_reports" }
  ]
}
```

> **说明**: `MCPToolName` 含 `opencti__opencti-local__` 前缀，是 OctoBus MCP 适配标识。

## 4. protoCamelCase 对比 — OctoBus gRPC 序列化铁证

### 直连 OpenCTI GraphQL（snake_case）

```bash
curl -s -X POST http://localhost:8080/graphql \
  -H "Authorization: Bearer <OPENCTI_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"query":"query { stixCyberObservables(first:1) { edges { node { standard_id entity_type observable_value } } } }"}'
```

```json
{
  "standard_id": "ipv4-addr--89a954e4-4a87-540a-85b6-22f844037f1c",
  "entity_type": "IPv4-Addr",
  "observable_value": "192.168.0.1"
}
```

### OctoBus 中转（protoCamelCase）

```bash
grpcurl -plaintext \
  -H "x-octobus-capset: opencti-write" \
  -H "x-octobus-instance: opencti-local" \
  -H "authorization: Bearer <OCTOBUS_ADMIN_TOKEN>" \
  -d '{"search":"172","first":1}' \
  127.0.0.1:19000 Filigran_OPENCTI.Filigran_OPENCTI/SearchObservables
```

```json
{
  "standardId": "ipv4-addr--f9784b79-ee1f-5b27-920e-874a96bb742e",
  "entityType": "IPv4-Addr",
  "observableValue": "172.16.0.1"
}
```

> **说明**: 同一类型数据，直连返回 `standard_id`/`entity_type`/`observable_value` (snake_case)，经 OctoBus 中转变为 `standardId`/`entityType`/`observableValue` (protoCamelCase)。这是 OctoBus gRPC gateway proto→JSON 序列化的铁证。

## 5. access.log NDJSON — OctoBus 中转日志

文件: `/tmp/octobus-text-verify/access.log`

```json
{
  "ts": "2026-06-27T13:25:06.441964Z",
  "protocol": "grpc",
  "capset": "opencti-write",
  "service": "opencti",
  "instance": "opencti-local",
  "method": "Filigran_OPENCTI.Filigran_OPENCTI/CreateIndicator",
  "route": "/Filigran_OPENCTI.Filigran_OPENCTI/CreateIndicator",
  "grpc_code": "OK",
  "duration_ms": 136,
  "remote_addr": "127.0.0.1:51887",
  "user_agent": "grpcurl/1.9.3 grpc-go/1.61.0"
}
```

> **说明**: NDJSON 日志含 `capset`/`service`/`instance`/`method` 等 OctoBus 特有字段，直连 OpenCTI 不产生此格式日志。

## 6. 六个 RPC 方法中转调用结果

### SearchIndicators

```bash
grpcurl -plaintext \
  -H "x-octobus-capset: opencti-write" \
  -H "x-octobus-instance: opencti-local" \
  -H "authorization: Bearer <OCTOBUS_ADMIN_TOKEN>" \
  -d '{"search":"OctoBus","first":3}' \
  127.0.0.1:19000 Filigran_OPENCTI.Filigran_OPENCTI/SearchIndicators
```

```json
{
  "total": "3",
  "items": [
    { "id": "15ee31f6-d1e7-4d58-a67c-d9c7761d47b2", "name": "OctoBus-Screenshot-IOC", "pattern": "[ipv4-addr:value = '172.16.0.1']" },
    { "id": "7b101f8f-d866-4c4a-b955-7b0f4b0d67bb", "name": "OctoBus-Test-Malicious-IP", "pattern": "[ipv4-addr:value = '10.0.0.99']" },
    { "id": "ed498089-1f5c-4454-8bde-f2ace763772b", "name": "OctoBus-Screenshot-IOC-v2", "pattern": "[ipv4-addr:value = '192.168.0.1']" }
  ]
}
```

### SearchObservables

```json
{
  "total": "1",
  "items": [
    { "standardId": "ipv4-addr--f9784b79-ee1f-5b27-920e-874a96bb742e", "entityType": "IPv4-Addr", "observableValue": "172.16.0.1" }
  ]
}
```

### SearchReports

```json
{
  "total": "3",
  "items": [
    { "standardId": "report--1ff144c3-250a-56cc-85e8-09d48d8fe5e2", "name": "OctoBus Screenshot Verification Report", "reportTypes": ["threat-report"] },
    { "standardId": "report--43a7bae9-8cfd-5ed9-986a-e18efac89f54", "name": "OctoBus Integration Test Report", "reportTypes": ["threat-report"] },
    { "standardId": "report--dcdd0d8d-e622-57c1-ad54-ef0c718e391c", "name": "OctoBus Screenshot Verification Report v2", "reportTypes": ["threat-report"] }
  ]
}
```

### CreateIndicator

```bash
grpcurl -plaintext \
  -H "x-octobus-capset: opencti-write" \
  -H "x-octobus-instance: opencti-local" \
  -H "authorization: Bearer <OCTOBUS_ADMIN_TOKEN>" \
  -d '{"name":"OctoBus-Verify","pattern_type":"stix","pattern":"[ipv4-addr:value = '\''10.10.10.1'\'']","indicator_types":["malicious-activity"],"description":"OctoBus gateway verification","valid_from":"2026-06-27T13:30:00Z"}' \
  127.0.0.1:19000 Filigran_OPENCTI.Filigran_OPENCTI/CreateIndicator
```

```json
{
  "indicator": { "id": "ca481578-8f13-4805-983c-c79755bf7107", "name": "OctoBus-Verify", "pattern": "[ipv4-addr:value = '10.10.10.1']" }
}
```

### CreateObservable

```bash
grpcurl -plaintext \
  -H "x-octobus-capset: opencti-write" \
  -H "x-octobus-instance: opencti-local" \
  -H "authorization: Bearer <OCTOBUS_ADMIN_TOKEN>" \
  -d '{"type":"IPv4-Addr","value":"10.10.10.1"}' \
  127.0.0.1:19000 Filigran_OPENCTI.Filigran_OPENCTI/CreateObservable
```

```json
{
  "observable": { "standardId": "ipv4-addr--03fbac19-abce-55d2-addc-d865a9ea3d41", "entityType": "IPv4-Addr", "observableValue": "10.10.10.1" }
}
```

### CreateReport

```bash
grpcurl -plaintext \
  -H "x-octobus-capset: opencti-write" \
  -H "x-octobus-instance: opencti-local" \
  -H "authorization: Bearer <OCTOBUS_ADMIN_TOKEN>" \
  -d '{"name":"OctoBus Verify Report","description":"Created via OctoBus gRPC","published":"2026-06-27T13:30:00Z","report_types":["threat-report"]}' \
  127.0.0.1:19000 Filigran_OPENCTI.Filigran_OPENCTI/CreateReport
```

```json
{
  "report": { "standardId": "report--dcd1dda6-61f8-5c3e-96f4-865d81ff85cd", "name": "OctoBus Verify Report", "reportTypes": ["threat-report"] }
}
```

## 截图索引

| 文件 | 内容 | OctoBus 标识 |
|------|------|-------------|
| `docs/screenshots/npm-test-48-pass.jpg` | npm test 48/48 通过 | — |
| `docs/screenshots/octobus-four-identifiers.jpg` | gRPC Reflection + capset + NDJSON + protoCamelCase | 四大标识 |
| `docs/screenshots/capset-ndjson-detail.jpg` | capset 路径和 NDJSON 详情 | 权限模型 + 中转日志 |
| `docs/screenshots/six-rpc-calls.jpg` | 6 个 RPC 中转调用结果 | protoCamelCase 字段名 |
| `docs/screenshots/verification-summary.jpg` | 验证完成汇总 | — |
