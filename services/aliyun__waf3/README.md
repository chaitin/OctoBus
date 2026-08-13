# Aliyun WAF 3.0 OctoBus Service / 阿里云 WAF 3.0

Alibaba Cloud Web Application Firewall (WAF) 3.0 integration for OctoBus — IP blacklist/whitelist management, custom ACL rules, security event query, and resource management.
<br>
阿里云 Web 应用防火墙（WAF）3.0 对接 OctoBus 能力总线，提供 IP 黑名单/白名单管理、自定义 ACL 规则、攻击事件查询和防护资源管理。

## Supported Versions / 支持版本

| Component / 组件 | Version / 版本 | Notes / 说明 |
|---|---|---|
| Alibaba Cloud WAF / 阿里云 WAF | 3.0 (API `2021-10-01`) | ⚠️ 请勿使用 `2019-09-10`（那是 WAF 2.0）|
| OctoBus SDK | `@chaitin-ai/octobus-sdk` ^0.5.0 | 运行时框架 |
| Alibaba Cloud SDK / 阿里云 SDK | `@alicloud/pop-core` ^1.8.0 | RPC 签名 + HTTPS 传输 |
| Node.js | ≥ 20 | 运行环境 |

## Configuration / 配置

### config（非敏感 / non-sensitive）

```json
{
  "endpoint": "https://wafopenapi.cn-hangzhou.aliyuncs.com",
  "regionId": "cn-hangzhou",
  "instanceId": "waf_v2_public_xxxxx",
  "timeoutMs": 10000
}
```

| Field / 字段 | Required / 必填 | Default / 默认 | Description / 说明 |
|---|---|---|---|
| `endpoint` | ❌ | `https://wafopenapi.cn-hangzhou.aliyuncs.com` | WAF OpenAPI 地址。国内站用 cn-hangzhou，国际站用 ap-southeast-1 |
| `regionId` | ❌ | `cn-hangzhou` | WAF 实例所在地域 |
| `instanceId` | ✅ | — | WAF 3.0 实例 ID，如 `waf_v2_public_xxxxx` |
| `timeoutMs` | ❌ | `10000` | API 调用超时（毫秒） |

### secret（敏感 / sensitive）

```json
{
  "accessKeyId": "<your-ram-accesskey-id>",
  "accessKeySecret": "<your-ram-accesskey-secret>"
}
```

**认证方式 / Authentication**：使用 RAM 用户的 AccessKey（AK/SK）+ RPC 签名。需要为 RAM 用户授予 `AliyunYundunWAFv3FullAccess`（读写）或 `AliyunYundunWAFv3ReadOnlyAccess`（只读）权限策略。

## RPC Methods / 方法列表（10 total）

| # | Method / 方法 | Type / 类型 | Description / 说明 | 阿里云 API |
|---|--------|------|-------------|-------------|
| 1 | `BlockIP` | ✍️ 写 | 封禁 IP，加入黑名单 | `CreateDefenseRule` (ip_blacklist) |
| 2 | `UnblockIP` | ✍️ 写 | 解封 IP，从黑名单移除 | `DescribeDefenseRule` + `ModifyDefenseRule` |
| 3 | `DescribeIPBlacklist` | 👁️ 读 | 查询 IP 黑名单规则及 IP 列表 | `DescribeDefenseRules` (ip_blacklist) |
| 4 | `AddIPWhitelist` | ✍️ 写 | IP 加白，绕过指定防护模块 | `CreateDefenseRule` (whitelist) |
| 5 | `CreateACLRule` | ✍️ 写 | 创建自定义 ACL 规则（支持 URL/IP/Header 等条件） | `CreateDefenseRule` (custom_acl) |
| 6 | `DeleteRule` | ✍️ 写 | 删除防护规则 | `DeleteDefenseRule` |
| 7 | `DescribeRule` | 👁️ 读 | 查询单条规则详情 | `DescribeDefenseRule` |
| 8 | `DescribeRules` | 👁️ 读 | 按场景查询规则列表 | `DescribeDefenseRules` |
| 9 | `DescribeSecurityTopNMetric` | 👁️ 读 | 攻击流量 Top N 统计（按源 IP/URL/防护模块） | `DescribeSecurityEventTopNMetric` |
| 10 | `DescribeResources` | 👁️ 读 | 查询防护资源（CNAME 域名 + 云产品接入的 ECS/SLB） | `DescribeDefenseResources` |

---

### BlockIP — 封禁 IP

将 IP 或 CIDR 网段加入黑名单。每次调用创建一条新规则。

```json
// Request / 请求
{ "ips": ["1.2.3.4", "5.6.7.0/24"], "ruleName": "block-malicious", "action": "block" }
// Response / 响应
{ "ruleId": "1024" }
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `ips` | ✅ | IP 地址或 CIDR 网段列表，如 `["1.2.3.4", "5.6.7.0/24"]` |
| `ruleName` | ❌ | 规则名称，默认 `"octobus-block"` |
| `action` | ❌ | `"block"`（拦截）或 `"monitor"`（观察），默认 `"block"` |
| `templateId` | ❌ | 防护模板 ID，不传则自动获取 |

> **幂等性注意**：每次调用创建**新**规则。多次调用会创建多条规则。如需幂等，先用 `DescribeIPBlacklist` 查已有规则再决定。

### UnblockIP — 解封 IP

从黑名单规则中移除指定 IP。所有 IP 被移除后自动删除规则。

```json
// Request / 请求
{ "ruleId": "1024", "ips": ["1.2.3.4"] }
// Response / 响应
{ "success": true }
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `ruleId` | ✅ | 目标规则 ID |
| `ips` | ✅ | 要移除的 IP 列表 |

### DescribeIPBlacklist — 查询黑名单

```json
{ "pageNumber": 1, "pageSize": 20 }
// → { "rules": [{ "ruleId": "1024", "name": "...", "ips": ["1.2.3.4"], "action": "block", "status": 1 }], "total": 5 }
```

### AddIPWhitelist — IP 加白

```json
{ "ips": ["10.0.0.1"], "ruleName": "internal-ip", "tags": ["waf"] }
// → { "ruleId": "2048" }
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `ips` | ✅ | 要加白的 IP 列表 |
| `ruleName` | ❌ | 规则名称，默认 `"octobus-whitelist"` |
| `tags` | ❌ | 加白模块列表，默认 `["waf"]`（全部模块）。可选：`waf`、`blacklist`、`customrule`、`cc`、`region_block`、`antiscan`、`dlp` |

### CreateACLRule — 创建自定义 ACL

基于 URL、IP、Header 等匹配条件创建访问控制规则，最多支持 5 个条件。

```json
{
  "ruleName": "block-admin-url",
  "conditions": [
    { "key": "URL", "opValue": "contain", "values": "/admin" },
    { "key": "IP", "opValue": "ne", "values": "10.0.0.0/8" }
  ],
  "action": "block",
  "status": 1
}
// → { "ruleId": "3072" }
```

**conditions 支持的匹配字段 / Supported match keys**：

| `key` | 说明 | 支持的操作符 |
|-------|------|-------------|
| `URL` | URL 路径 | contain, not-contain, eq, ne, prefix-match, suffix-match, regex |
| `IP` | 来源 IP | eq, ne |
| `Referer` | Referer 请求头 | contain, not-contain, eq, ne |
| `User-Agent` | UA 请求头 | contain, not-contain, eq, ne |
| `Header` | 自定义 Header | contain, not-contain, eq, ne（需 `subKey` 指定 Header 名） |
| `Cookie` | Cookie | contain, not-contain, eq, ne（需 `subKey`） |
| `Params` | 请求参数 | contain, not-contain, eq, ne（需 `subKey`） |
| `Http-Method` | 请求方法 | eq, ne |
| `X-Forwarded-For` | XFF 头 | eq, ne |

| 参数 | 必填 | 说明 |
|------|------|------|
| `ruleName` | ✅ | 规则名称 |
| `conditions` | ✅ | 1-5 个匹配条件 |
| `action` | ❌ | `block`/`monitor`/`js`/`captcha`/`captcha_strict`，默认 `block` |
| `status` | ❌ | `0`（禁用）或 `1`（启用），默认 `1` |

### DeleteRule — 删除规则

```json
{ "ruleId": "3072" }
// → { "success": true }
```

> ⚠️ **风险提示**：删除操作不可逆，删除后无法恢复。

### DescribeRule / DescribeRules — 查询规则

```json
{ "ruleId": "1024" }
// → { "ruleId": "1024", "name": "...", "defenseScene": "ip_blacklist", "rulesJson": "[...]" }
```

### DescribeSecurityTopNMetric — 攻击 Top N 统计

统计攻击流量按维度（源 IP、URL、防护模块等）聚合后的 Top N 数据。

```json
{
  "startTime": 1719705600,
  "endTime": 1719792000,
  "metric": "real_client_ip",
  "limit": 5
}
// → { "items": [{ "name": "45.33.32.156", "value": 23 }, ...] }
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `startTime` | ✅ | 开始时间（Unix 秒） |
| `endTime` | ✅ | 结束时间（Unix 秒） |
| `metric` | ❌ | 统计维度，默认 `real_client_ip`。可选：`http_user_agent`、`request_path`、`matched_host`、`defense_scene`、`block_defense_scene` |
| `limit` | ❌ | 返回条数（1-10），默认 5 |

### DescribeResources — 查询防护资源

同时支持 CNAME 域名接入和云产品接入（ECS/SLB）模式。

```json
{ "pageSize": 20 }
// → { "resources": [{ "resource": "i-bp1-8080-ecs", "pattern": "instance_port", "product": "ecs", ... }], "total": 1 }
```

## Error Mapping / 错误码映射

| 阿里云 API 错误 | gRPC 状态 | 说明 |
|---|---|---|
| `InvalidAccessKeyId`, `SignatureDoesNotMatch` | `UNAUTHENTICATED` | AK/SK 无效或签名不匹配 |
| `Forbidden`, `NoPermission` | `PERMISSION_DENIED` | RAM 用户无权限 |
| `InvalidParameter`, `MissingParameter` | `INVALID_ARGUMENT` | 参数无效或缺失 |
| `Throttling`, `LimitExceeded` | `RESOURCE_EXHAUSTED` | API 调用频率超限 |
| 网络错误 / 5xx / 未知错误 | `UNAVAILABLE` | 服务不可用 |

## Suggested Capset / 建议能力集

- **`security-ops`**（安全运营）：`BlockIP`, `UnblockIP`, `AddIPWhitelist`, `DescribeSecurityTopNMetric` — 安全分析师使用
- **`waf-admin`**（WAF 管理）：所有方法 — WAF 管理员使用
- **`waf-readonly`**（只读）：所有 `Describe*` 方法 — 审计/报表使用

## Import & Test / 导入和测试

```bash
# 1. 导入 service
octobus service import aliyun-waf3 ./services/aliyun__waf3

# 2. 创建 instance
octobus instance create aliyun-waf \
  --service aliyun-waf3 \
  --config-json '{"instanceId":"waf_v2_public_xxxxx","regionId":"cn-hangzhou"}' \
  --secret-json '{"accessKeyId":"<AK-ID>","accessKeySecret":"<AK-SECRET>"}'

# 3. 加入 capset
octobus capset create dev
octobus capset add-instance dev aliyun-waf

# 4. 测试：查询防护资源（只读，安全）
curl -X POST "http://127.0.0.1:9000/capsets/dev/connect/aliyun-waf/Aliyun_Waf3.Waf3/DescribeResources" \
  -H "Content-Type: application/json" \
  -d '{}'

# 5. 测试：查询 Top N 攻击统计
curl -X POST "http://127.0.0.1:9000/capsets/dev/connect/aliyun-waf/Aliyun_Waf3.Waf3/DescribeSecurityTopNMetric" \
  -H "Content-Type: application/json" \
  -d '{"startTime":1719705600,"endTime":1719792000,"metric":"real_client_ip","limit":5}'
```

## Local Checks / 本地校验

```bash
cd services
npm run validate -- --service-dir aliyun__waf3
npm test -- --service-dir aliyun__waf3
npm run pack:check
```

## Known Limitations / 已知限制

- **IP 黑名单**：操作粒度为防护规则级别，非地址簿级别。每次 `BlockIP` 创建新规则。
- **UnblockIP**：需指定 `rule_id`。先调用 `DescribeIPBlacklist` 找到对应规则。
- **API 限流**：阿里云 WAF API 约 5 QPS。本服务不实现客户端限流，依赖服务端返回 `Throttling` 错误。
- **模板发现**：首次调用时缓存默认模板 ID，实例运行期间不自动刷新。
- **写操作**：所有写操作（Create/Modify/Delete）使用 POST 方法，读操作使用 GET。
- **模板按场景匹配**：initialize 时自动按 `defenseScene` 查找对应模板。如无对应模板需预先在 WAF 控制台创建。
