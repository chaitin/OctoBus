# Huayulab NGAF OctoBus Service 交付说明

这是 Huayulab NGAF 设备接入 OctoBus 的只读型 Service。它把厂商 API
封装成稳定的 OctoBus RPC，负责登录签名、token 与 session cookie 维护、
固定 endpoint 映射、查询参数边界控制、超时处理和响应归一化。

这个 Service 不做危险写操作，也不是 raw proxy。调用方不能传任意 URL，
只能调用代码中明确 allowlist 的只读接口。

## 当前状态

| 项目 | 内容 |
| --- | --- |
| Service ID | `huayulab-ngaf` |
| 目录 | `services/huayulab__ngaf` |
| 运行模式 | `long-running` |
| 依据文档 | Huayulab NGAF API document，2026-05-27 |
| 操作类型 | 只读 |
| 已实现 RPC | 9 个 |
| 本地测试 | mock upstream 单元测试 |
| 真实设备验证 | 集成测试阶段已验证登录链路和代表性只读调用 |

适用场景：

- 验证 OctoBus 网关是否能连通 Huayulab NGAF 设备；
- 验证 API 账号、签名算法和设备 session 是否可用；
- 给上层 Agent / SOAR 提供受控的日志、指标、统计和对象列表读取能力；
- 在不暴露设备密钥给上层系统的前提下，完成安全运营数据查询。

## 已实现功能

```proto
service HUAYULAB_NGAF {
  rpc GetUserInfo(GetUserInfoRequest) returns (GetUserInfoResponse) {}
  rpc QuerySecurityLog(SecurityLogRequest) returns (NgafJsonResponse) {}
  rpc QueryBehaviorLog(BehaviorLogRequest) returns (NgafJsonResponse) {}
  rpc QueryAuditLog(AuditLogRequest) returns (NgafJsonResponse) {}
  rpc QuerySecurityStatistic(SecurityStatisticRequest)
      returns (NgafJsonResponse) {}
  rpc QueryFlowAnalysis(FlowAnalysisRequest) returns (NgafJsonResponse) {}
  rpc QueryResourceMetric(ResourceMetricRequest) returns (NgafJsonResponse) {}
  rpc QueryReferenceData(ReferenceDataRequest) returns (NgafJsonResponse) {}
  rpc ListPolicyObjects(PolicyObjectListRequest) returns (NgafJsonResponse) {}
}
```

| RPC | 作用 |
| --- | --- |
| `GetUserInfo` | 登录设备并读取当前 API 用户信息，适合做连通性和身份健康检查。 |
| `QuerySecurityLog` | 查询 IPS、DDoS、病毒、WAF、威胁情报、弱口令、主动外联、地域访问、工控安全日志。 |
| `QueryBehaviorLog` | 查询 Web、邮件、IM、账号登录、外发文件、会话、告警、翻墙等行为日志。 |
| `QueryAuditLog` | 查询 HTTP、SSL、FTP、DNS、LDAP、RDP、SSH、数据库、认证、命令、事件、合规访问等审计日志。 |
| `QuerySecurityStatistic` | 查询 IPS、病毒、DDoS、翻墙等安全统计。 |
| `QueryFlowAnalysis` | 查询用户、用户组、服务、网站、终端、位置、在线维度和热点维度分析。 |
| `QueryResourceMetric` | 查询 CPU、内存、会话、在线 IP、在线用户、物理接口等资源指标。 |
| `QueryReferenceData` | 查询报表筛选字典和参考数据。 |
| `ListPolicyObjects` | 查询文档中标记为 `getList` 的只读对象列表，例如用户黑名单、IP 白名单、终端反 VPN 列表。 |

所有查询方法都使用类型枚举映射到固定上游路径，不允许调用方直接指定路径。

## 工作原理

厂商文档中的登录签名规则：

```text
sign = md5(md5(apiSecret) + "-api-!*195")
```

运行流程：

1. 上层 Agent / SOAR / MCP client 调用 OctoBus capset endpoint。
2. OctoBus 根据 instance 找到 `huayulab-ngaf` Service。
3. Service 将 `endpoint` 规范化到 `/api.php`。
4. 如果内存中没有可用 session，则调用
   `POST /api.php/Login/uInterlogin` 登录。
5. 登录请求使用 `application/x-www-form-urlencoded`，body 为
   `username=<用户名>&sign=<签名>`。
6. Service 在内存中缓存 token 和 `ci_session` cookie。
7. Service 调用固定 allowlist 内的只读接口，并附带 `Authorization`、
   `Cookie`、`Lan` 请求头。
8. 如果设备返回认证失败，Service 会清理 session，重新登录一次，并只重试一次原只读请求。

## 文件结构

```text
services/huayulab__ngaf/
├── README.md
├── README.zh-CN.md
├── package.json
├── service.json
├── config.schema.json
├── secret.schema.json
├── proto/
│   └── huayulab_ngaf.proto
├── bin/
│   └── huayulab-ngaf.js
├── src/
│   ├── service.js
│   └── huayulab-ngaf.js
└── test/
    ├── huayulab-ngaf.test.js
    └── mock_upstream.js
```

| 文件 | 作用 |
| --- | --- |
| `service.json` | OctoBus manifest，声明 Service ID、proto、schema 和 CLI command。 |
| `proto/huayulab_ngaf.proto` | 向上层暴露的 RPC contract。 |
| `config.schema.json` | 非敏感配置 schema，例如 endpoint、语言、超时、TLS 开关。 |
| `secret.schema.json` | 敏感配置 schema，例如 username、apiSecret。 |
| `src/huayulab-ngaf.js` | 核心逻辑：签名、登录、session 缓存、请求、重试和响应处理。 |
| `src/service.js` | 按 OctoBus SDK 方式导出 Service。 |
| `bin/huayulab-ngaf.js` | long-running entrypoint。 |
| `test/mock_upstream.js` | 本地模拟 Huayulab NGAF API。 |
| `test/huayulab-ngaf.test.js` | 自动化测试。 |

## 配置

`config.schema.json` 示例：

```json
{
  "endpoint": "https://DEVICE_HOST:PORT/api.php",
  "lan": "zh_CN",
  "timeoutMs": 5000,
  "skipTlsVerify": false,
  "allowInsecureHttp": false
}
```

| 字段 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `endpoint` | 是 | 无 | Huayulab NGAF API 地址。粘贴 `/index.php` 控制台地址时会自动规范化为 `/api.php`。 |
| `lan` | 否 | `zh_CN` | 设备语言请求头，可选 `zh_CN`、`zh_TW`、`en_US`。 |
| `timeoutMs` | 否 | `5000` | 上游 HTTP 超时，schema 限制为 500 到 30000 毫秒。 |
| `skipTlsVerify` | 否 | `false` | 仅实验室自签证书设备建议开启。 |
| `allowInsecureHttp` | 否 | `false` | 仅隔离测试环境允许 HTTP，生产不要开启。 |

`secret.schema.json` 示例：

```json
{
  "username": "API_USERNAME",
  "apiSecret": "API_SECRET"
}
```

注意：不要把真实 endpoint、用户名、API secret、capset token、设备 cookie
提交到 GitHub 或交付包之外的公开文档。

## 本地测试

在仓库根目录执行：

```bash
node --check services/huayulab__ngaf/src/huayulab-ngaf.js
node --check services/huayulab__ngaf/src/service.js
node --check services/huayulab__ngaf/bin/huayulab-ngaf.js
node --test services/huayulab__ngaf/test/huayulab-ngaf.test.js
```

测试覆盖范围：

- 登录签名算法；
- endpoint 规范化；
- 默认拒绝明文 HTTP；
- 登录、token 和 cookie 转发；
- 认证失败后只刷新一次 token；
- 必填配置和密钥校验；
- 日志、指标、对象列表的固定 endpoint allowlist；
- 分页和 `filters_json` 形状约束；
- 上游请求超时处理。

## OctoBus 导入与验证

导入 Service：

```bash
octobus service import huayulab-ngaf services/huayulab__ngaf
```

创建真实设备 instance：

```bash
octobus instance create huayulab-ngaf-readonly \
  --service huayulab-ngaf \
  --config-json '{"endpoint":"https://DEVICE_HOST:PORT/api.php","lan":"zh_CN","timeoutMs":5000,"skipTlsVerify":true,"allowInsecureHttp":false}' \
  --secret-json '{"username":"API_USERNAME","apiSecret":"API_SECRET"}'
```

加入 capset：

```bash
octobus capset add-instance local huayulab-ngaf-readonly
```

如果重新导入 Service 后新增方法看不到，刷新 capset membership：

```bash
octobus capset remove-instance local huayulab-ngaf-readonly
octobus capset add-instance local huayulab-ngaf-readonly
```

生成测试 token：

```bash
TOKEN="$(openssl rand -hex 32)"
printf '%s' "$TOKEN" | octobus capset add-token local "huayulab-test-$(date +%s)" --token-stdin
```

调用用户信息接口：

```bash
curl -sS -X POST \
  'http://127.0.0.1:9000/capsets/local/connect/huayulab-ngaf-readonly/HUAYULAB_NGAF.HUAYULAB_NGAF/GetUserInfo' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  --data '{}'
```

调用资源指标接口：

```bash
curl -sS -X POST \
  'http://127.0.0.1:9000/capsets/local/connect/huayulab-ngaf-readonly/HUAYULAB_NGAF.HUAYULAB_NGAF/QueryResourceMetric' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  --data '{"type":"RESOURCE_METRIC_CPU","query":{"page":1,"pageSize":10}}'
```

调用 IPS 安全日志接口：

```bash
curl -sS -X POST \
  'http://127.0.0.1:9000/capsets/local/connect/huayulab-ngaf-readonly/HUAYULAB_NGAF.HUAYULAB_NGAF/QuerySecurityLog' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  --data '{"type":"SECURITY_LOG_IPS","query":{"page":1,"pageSize":5,"order":"desc"}}'
```

## 安全边界

本 Service 的安全策略：

- 只读优先，不实现危险写操作；
- 只允许固定 endpoint allowlist；
- 不提供 raw proxy；
- 不允许调用方传上游 URL；
- 不接入封禁、解封、增删改、清空、重启、关机、升级、网络配置、VPN 配置等高风险 API；
- 默认要求 HTTPS；
- HTTP 需要显式开启，仅用于隔离测试；
- 跳过 TLS 校验需要显式开启，仅用于实验室自签证书；
- 上游请求有超时限制；
- `pageSize` 最大 200；
- `filters_json` 只允许扁平对象，不允许嵌套对象；
- token 与 cookie 只在进程内存缓存，不写入日志和文件。

## 常见问题

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| `method is not exposed by capset` | capset 在 Service 重新导入前已绑定旧 descriptor。 | 对 instance 执行 remove/add 刷新 capset。 |
| `upstream request failed: fetch failed` | endpoint、端口、路由、TLS 或可信主机配置错误。 | 在 OctoBus 所在机器上用 `curl -k` 直接验证 API 地址。 |
| `管理员登录失败` | 用户名、API secret、端口或表单格式不正确。 | 使用 form-urlencoded 方式单独验证登录接口。 |
| 返回成功但数据为空 | 设备当前模块无数据或时间范围太窄。 | 扩大时间范围，或换一个已产生数据的只读类型。 |
| 请求超时 | 设备 API 慢或网络不可达。 | 先排查网络，再在 schema 范围内调大 `timeoutMs`。 |

## 交付前检查

```bash
node --test services/huayulab__ngaf/test/huayulab-ngaf.test.js
rg -n 'REAL_DEVICE_IP|REAL_API_USERNAME|REAL_API_SECRET|[A-Fa-f0-9]{64}' services/huayulab__ngaf || true
tar --exclude='node_modules' -czf huayulab-ngaf.tar.gz -C services huayulab__ngaf
sha256sum huayulab-ngaf.tar.gz
```

归档包应包含 Service 全部代码和配置：manifest、schema、proto、runtime
source、bin entrypoint、测试、mock upstream、README。不要把真实密钥或真实
设备会话文件打入归档。
