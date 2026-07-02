# CloudWalker OctoBus Service

长亭科技牧云（CloudWalker）集群与漏洞只读查询适配器。

```bash
octobus service import cloudwalker ./services/chaitin__cloudwalker
```

## Package Files

- `service.json` — OctoBus 服务清单，声明运行模式与 proto 入口。
- `proto/cloudwalker.proto` — gRPC API 定义，6 个 unary 方法。
- `config.schema.json` — 非密配置：`baseUrl`、`referer`。
- `secret.schema.json` — 密钥配置：`token`（必填）、`cookie`（可选）。
- `src/cloudwalker.js` — 上游 REST API 请求映射、响应归一化、错误分类。
- `src/service.js` — OctoBus SDK `defineService` 封装。
- `bin/cloudwalker.js` — 服务本地可执行入口。
- `test/cloudwalker.test.js` — node:test 覆盖：请求映射、响应归一化、错误分类、SDK handler。
- `test/cloudwalker-client.test.js` — 扩展客户端测试：HTML 响应检测、fallback 逻辑、零值保留。
- `test/mock_upstream.js` — 本地 mock 上游，覆盖成功 / 认证失败 / 5xx / 超时。

## 支持版本

- **目标产品**: 长亭科技牧云 CloudWalker
- **适配版本**: VM-S10-26.06.002

## 认证方式

Token + Browser Session Cookie 组合认证：

| 字段 | 必填 | 说明 |
|------|------|------|
| `token` | 是 | API Token，通过牧云控制台「个人中心 → API Token」生成 |
| `cookie` | 视环境 | 浏览器 Session Cookie；Demo 环境需要，正式环境可能仅需 token |

认证头同时发送三种格式以兼容不同牧云版本：`Authorization: Bearer <token>`、`token: <token>`、`x-auth-token: <token>`。

## Configuration

```json
{
  "baseUrl": "https://cnapp.demo.chaitin.cn",
  "referer": "https://cnapp.demo.chaitin.cn/profile/apitoken"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `baseUrl` | string | 是 | 牧云 API 基础 URL |
| `referer` | string | 否 | 浏览器 Referer 头，部分环境需要 |

Secret：

```json
{
  "token": "TMCpan#2VB44wwF...",
  "cookie": "_c_WBKFRo=...; veinmind=..."
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `token` | string | 是 | API Token |
| `cookie` | string | 否 | 浏览器 Session Cookie（含 httpOnly 的 veinmind） |

Handler 优先使用 `ctx.config` / `ctx.secret`，其次回退到环境变量 `CLOUDWALKER_BASE_URL`、`CLOUDWALKER_TOKEN`、`CLOUDWALKER_COOKIE`、`CLOUDWALKER_REFERER`。

## RPC Methods

| 方法 | 上游 API | 说明 |
|------|----------|------|
| `Chaitin_CloudWalker.Chaitin_CloudWalker/ListClusters` | `GET /cluster/cluster_list` | 查询集群列表，支持 name / status 过滤与分页 |
| `Chaitin_CloudWalker.Chaitin_CloudWalker/GetClusterInfo` | `GET /cluster/cluster_info` | 按集群 ID 获取详情 |
| `Chaitin_CloudWalker.Chaitin_CloudWalker/ListClusterVulnEvents` | `GET /cluster_vuln/vuln_event_list` | 查询集群漏洞事件列表，支持 CVE / CNVD / risk / state 等过滤 |
| `Chaitin_CloudWalker.Chaitin_CloudWalker/GetClusterVulnEvent` | `GET /cluster_vuln/vuln_event_info` | 按事件 ID 获取集群漏洞详情 |
| `Chaitin_CloudWalker.Chaitin_CloudWalker/ListMicroserviceVulnEvents` | `GET /cluster_microservice/vuln_event_list` | 查询微服务漏洞事件列表，支持 serviceName / clusterName 等过滤 |
| `Chaitin_CloudWalker.Chaitin_CloudWalker/GetMicroserviceVulnEvent` | `GET /cluster_microservice/vuln_event_info` | 按事件 ID 获取微服务漏洞详情 |

## Behavior Notes

- **Proto3 零值参数跳过**：gRPC 反序列化后 int32 字段（如 `status`、`order`）默认值为 0，`appendScalarQuery` 主动跳过值为 0 的数字参数，避免发送 `status=0` 导致上游 "Validation Failed"。
- **Fallback 过滤**：`clusterName`、`cnvd`、`cnnvd` 等参数在 Demo 上游不稳定，客户端先尝试直接查询，失败后自动降级为全量扫描 + 客户端过滤。
- **HTML 响应检测**：Session 过期时上游返回 200 + HTML 页面而非 JSON，客户端识别 `<!doctype html>` 并触发 fallback 或抛出 `UNAVAILABLE` 错误。
- **snake_case → camelCase**：上游 API 返回 snake_case 字段，客户端自动转换为 camelCase 以匹配 proto JSON 格式。
- **非 JSON 内容守卫**：响应 Content-Type 非 JSON 时直接拒绝，防止将 HTML 误解析为业务数据。

### 错误映射

| 上游 HTTP 状态 | gRPC 状态码 |
|----------------|-------------|
| 400 | `INVALID_ARGUMENT` |
| 401 | `UNAUTHENTICATED` |
| 403 | `PERMISSION_DENIED` |
| 404 | `NOT_FOUND` |
| 409 | `ALREADY_EXISTS` |
| 412 | `FAILED_PRECONDITION` |
| 429 | `RESOURCE_EXHAUSTED` |
| 504 | `DEADLINE_EXCEEDED` |
| 其他 5xx / 网络错误 | `UNAVAILABLE` |

## Risk Boundary

- **风险等级**: `read-only`
- **写操作**: 本版本无写操作，所有 6 个方法均为只读查询。
- 本适配器不修改牧云平台任何数据。

## Suggested Capset

- `prod` — 生产环境只读查询

```bash
octobus capset create prod
octobus capset add-instance prod --service cloudwalker --instance cloudwalker-demo
```

## Known Limitations

- 第一版仅覆盖 6 个只读查询能力，不支持漏洞处置、集群纳管等写操作。
- Demo 环境的 `clusterName`、`cnvd`、`cnnvd` 过滤参数不稳定，需通过 fallback 机制兜底。
- Cookie 中的 `veinmind` 为 httpOnly，需通过浏览器 CDP 获取，无法从 `document.cookie` 读取。
- `ListClustersRequest.status` 为 int32 类型，proto3 默认值为 0，不支持通过 0 值筛选集群状态；需传正整数（如 1=运行中、2=异常）。
- Fallback 模式下（`clusterName`/`cnvd`/`cnnvd` 触发客户端过滤），`collectFilteredItems` 在命中 `pageSize` 数量后提前中断当前页扫描，返回的 `nextPageToken` 为上游最后一页的全局 token，可能跳过当前页剩余未扫描项。建议一次性拉取较大 `pageSize` 以减少分页遗漏风险。

## Local Checks

```bash
cd services
npm run validate -- --service-dir chaitin__cloudwalker
npm test -- --service-dir chaitin__cloudwalker
npm run pack:check
```

## OctoBus Runtime Validation

```bash
# 导入服务
octobus service import cloudwalker ./services/chaitin__cloudwalker

# 创建实例
octobus instance create cloudwalker-demo \
  --service cloudwalker \
  --config-json '{"baseUrl":"https://cnapp.demo.chaitin.cn","referer":"https://cnapp.demo.chaitin.cn/profile/apitoken"}' \
  --secret-json '{"token":"<TOKEN>","cookie":"<COOKIE>"}'

# 创建 capset 并绑定实例
octobus capset create prod
octobus capset add-instance prod --service cloudwalker --instance cloudwalker-demo

# 验证方法注册
octobus catalog prod --all --json

# 调用测试
curl -X POST http://127.0.0.1:9000/capsets/prod/connect/cloudwalker-demo/CloudWalker.CloudWalker/ListClusters \
  -H 'Content-Type: application/json' \
  -d '{"pageSize": 5}'
```

**注意**：方法路径格式为 `Chaitin_CloudWalker.Chaitin_CloudWalker/<Method>`，与 proto `package Chaitin_CloudWalker` 保持一致。
