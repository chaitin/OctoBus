# TopSec WAF OctoBus Service

TopSec（天融信）WAF RESTful API 封装，支持 IP 黑名单管理和 URL 自定义策略（ACL）操作。

## 支持版本

- **设备型号**: TopSec WAF（天融信 Web 应用防火墙）
- **设备版本**: `v3.2294.20238_waf`
- **API 版本**: `v1`（RESTful API）
- **认证方式**: Session-based（登录获取 PHPSESSID + token）

> 其他版本或型号的天融信 WAF 可能需要调整 API 路径或认证流程。如有适配需求请提交 issue 或 PR。

## 导入

```bash
octobus service import topsec-waf ./services/topsec__waf_v3-2294-20238
```

## 配置

### 连接配置（config）

```json
{
  "host": "https://waf.example.com:8443",
  "skipTlsVerify": false,
  "timeoutMs": 5000
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `host` | string | 是 | TopSec WAF 基础 URL，需包含 https:// |
| `skipTlsVerify` | boolean | 否 | 跳过 TLS 证书验证（自签证书场景），默认 false |
| `timeoutMs` | integer | 否 | HTTP 请求超时（毫秒），默认 5000 |

旧版别名 `baseUrl`、`base_url`、`endpoint` 也受支持。

### 认证配置（secret）

```json
{
  "username": "superman",
  "password": "your-password"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `username` | string | 是 | WAF 管理员用户名 |
| `password` | string | 是 | WAF 管理员密码 |

## 创建实例

```bash
octobus instance create my-waf \
  --service topsec-waf \
  --config-json '{"host":"https://你的WAF地址:8443","skipTlsVerify":true}' \
  --secret-json '{"username":"superman","password":"你的密码"}'
```

## 创建 Capset 并绑定

```bash
octobus capset create security-agent --name 安全运营助手
octobus capset add-instance security-agent my-waf
```

## RPC 方法

### IP 黑名单管理

| 方法 | CLI 命令 | 说明 | 类型 |
|------|---------|------|------|
| `AddBlacklistIP` | `add-blacklist-ip` | 添加 IP 地址到黑名单组 | 写 |
| `DeleteBlacklistIP` | `delete-blacklist-ip` | 按名称删除黑名单组 | 写 |
| `ListBlacklistIPs` | `list-blacklist-ips` | 查询黑名单 IP 列表 | 读 |

### URL 拦截规则

| 方法 | CLI 命令 | 说明 | 类型 |
|------|---------|------|------|
| `AddUrlBlock` | `add-url-block` | 添加 URL 拦截规则（自定义策略） | 写 |
| `DeleteUrlBlock` | `delete-url-block` | 按名称删除 URL 拦截规则 | 写 |
| `ListUrlBlocks` | `list-url-blocks` | 查询 URL 拦截规则列表 | 读 |
| `SetUrlBlockStatus` | `set-url-block-status` | 启用或禁用 URL 拦截规则 | 写 |

## 写操作说明

### AddBlacklistIP

- **默认参数**: `ip_addresses` 为必填，格式 `"IP,black"` 或 `"IP/掩码,black"`（如 `"192.168.1.1,black"`）
- **幂等语义**: 同一名称组重复添加会覆盖组内 IP 列表（非追加）
- **回滚方式**: 调用 `DeleteBlacklistIP` 传入相同 `name` 删除该组
- **审计字段**: `name`（组名）、`ip_addresses`（IP 列表）

### DeleteBlacklistIP

- **默认参数**: `name` 为必填，指定要删除的黑名单组名称
- **幂等语义**: 删除不存在的组名将在 WAF 侧返回失败
- **回滚方式**: 重新调用 `AddBlacklistIP` 创建同名组
- **审计字段**: `name`（被删除的组名）

### AddUrlBlock

- **默认参数**:
  - `action`: `"deny"`（可选值: `deny`, `allow`, `alert`, `continue`, `deny-nlog`, `temp-redirect`, `perm-redirect`）
  - `operator`: `"contains"`（URL 匹配方式）
  - `phase`: `"request_header"`（拦截阶段）
  - `enable`: 新建规则默认为 `"on"`
- **幂等语义**: 同一 `security_policy` 下不允许重名规则；重复调用会失败
- **回滚方式**: 调用 `DeleteUrlBlock` 传入相同 `security_policy` 和 `name`
- **审计字段**: `security_policy`、`name`、`url`、`action`、`phase`

### DeleteUrlBlock

- **默认参数**: `security_policy` 和 `name` 均为必填
- **幂等语义**: 删除不存在的规则将在 WAF 侧返回失败
- **回滚方式**: 重新调用 `AddUrlBlock` 创建同名规则
- **审计字段**: `security_policy`、`name`

### SetUrlBlockStatus

- **默认参数**: `enable`: `"on"`（可选值: `"on"`, `"off"`）
- **幂等语义**: 重复设置相同状态无副作用
- **回滚方式**: 再次调用 `SetUrlBlockStatus` 恢复原状态
- **审计字段**: `security_policy`、`name`、`enable`

## 错误码映射

| 场景 | gRPC 状态码 | 说明 |
|------|-----------|------|
| SDK 参数校验（缺必填字段等） | `INVALID_ARGUMENT` | 调用前拦截 |
| 缺少 `action_data`（redirect） | `INVALID_ARGUMENT` | 客户端校验 |
| 登录 401 | `UNAUTHENTICATED` | 用户名或密码错误 |
| 登录 / WAF API 403 | `PERMISSION_DENIED` | 帐号禁用或 token 过期 |
| WAF API 401（session 过期） | `PERMISSION_DENIED` | 自动清除 session 并重试登录 |
| WAF 400 / `result: failed` | `FAILED_PRECONDITION` | 请求参数错误或业务失败 |
| HTTP 请求超时 | `DEADLINE_EXCEEDED` | fetch 超时（config.timeoutMs） |
| WAF 5xx / 网络错误 | `UNAVAILABLE` | WAF 服务不可用 |
| 非 JSON 响应 | `UNKNOWN` | 非预期响应格式 |

## 风险说明

> ⚠️ **安全警告**

1. **写操作影响生产流量**: `AddBlacklistIP`、`DeleteBlacklistIP`、`AddUrlBlock`、`DeleteUrlBlock`、`SetUrlBlockStatus` 会直接修改 WAF 策略，误操作可能导致正常流量被拦截或恶意流量被放行。
2. **认证凭证保护**: 密码通过 aes-128-cbc 加密传输，请在配置中妥善保管 `secret`，不要在代码或日志中打印。
3. **TLS 证书**: 建议在生产环境中使用有效证书，仅在测试环境使用 `skipTlsVerify`。
4. **会话管理**: 服务会缓存登录会话，如 WAF 侧 session 失效会自动重新登录。
5. **幂等性限制**: 写操作并非全部幂等，多次执行可能产生不同结果，请在自动化流程中做好状态检查。

## 建议 Capset

```bash
# 安全运营读权限（最小权限）
octobus capset create security-agent-ro --name 安全运营只读
octobus capset add-instance security-agent-ro my-waf \
  --methods ListBlacklistIPs,ListUrlBlocks

# 安全运营完整权限
octobus capset create security-agent --name 安全运营助手
octobus capset add-instance security-agent my-waf \
  --methods AddBlacklistIP,DeleteBlacklistIP,ListBlacklistIPs,AddUrlBlock,DeleteUrlBlock,ListUrlBlocks,SetUrlBlockStatus
```

## 调用示例

### 通过 OctoBus CLI

```bash
# 添加 IP 黑名单
octobus call security-agent add-blacklist-ip \
  --json '{"name":"blocklist","ip_addresses":["19.1.1.1,black","10.0.0.0/24,black"]}'

# 查看 IP 黑名单
octobus call security-agent list-blacklist-ips --json '{}'

# 添加 URL 拦截规则
octobus call security-agent add-url-block \
  --json '{"security_policy":"default-policy","name":"block-admin","url":"/admin/login.php"}'

# 查看 URL 拦截规则
octobus call security-agent list-url-blocks \
  --json '{"security_policy":"default-policy"}'

# 禁用 URL 拦截规则
octobus call security-agent set-url-block-status \
  --json '{"security_policy":"default-policy","name":"block-admin","enable":"off"}'

# 删除 URL 拦截规则
octobus call security-agent delete-url-block \
  --json '{"security_policy":"default-policy","name":"block-admin"}'

# 删除 IP 黑名单
octobus call security-agent delete-blacklist-ip --json '{"name":"blocklist"}'
```

### 通过 curl（直接调用本地网关）

```bash
# 添加 IP 黑名单
curl -s -X POST \
  http://127.0.0.1:9000/capsets/security-agent/connect/my-waf/TopSec_WAF.TopSec_WAF/AddBlacklistIP \
  -H 'Content-Type: application/json' \
  -d '{"name":"blocklist","ip_addresses":["192.168.99.1,black"]}'

# 查看 IP 黑名单
curl -s -X POST \
  http://127.0.0.1:9000/capsets/security-agent/connect/my-waf/TopSec_WAF.TopSec_WAF/ListBlacklistIPs \
  -H 'Content-Type: application/json' \
  -d '{}'
```

## Package 文件

| 文件 | 说明 |
|------|------|
| `service.json` | OctoBus service 清单 |
| `proto/topsec_waf.proto` | gRPC 接口定义 |
| `config.schema.json` | 连接配置 schema（host、TLS、超时） |
| `secret.schema.json` | 认证配置 schema（username、password） |
| `src/topsec-waf-v3-2294-20238.js` | TopSec WAF REST proxy 实现 |
| `src/service.js` | OctoBus SDK `defineService` 封装 |
| `bin/topsec-waf-v3-2294-20238.js` | Service 可执行入口 |
| `test/topsec-waf-v3-2294-20238.test.js` | node:test 测试覆盖 |
| `test/mock_upstream.js` | TopSec WAF HTTP mock |

## 本地检查

```bash
cd services

# 验证 package 结构
npm run validate -- --service-dir topsec__waf_v3-2294-20238

# 运行测试
npm test -- --service-dir topsec__waf_v3-2294-20238

# 检查打包
npm run pack:check
```

## 已知限制

1. 当前仅支持 Session-based 认证（PHPSESSID + token），不支持 API Key 方式
2. IP 黑名单不支持部分 IP 删除，只能整个组删除再重建
3. URL 拦截规则的 condition 仅支持 `contains` 操作符（URL 包含匹配）
4. `m_type` 字段在 WAF 返回中始终为 `"__"`，未能区分 black/white 类型
5. URL 拦截规则列表使用 `waf_url_rewrite_show_name` 接口（非 `user_policy_show`），接口名称与功能不完全匹配（为 TopSec WAF 实际 API 行为）
