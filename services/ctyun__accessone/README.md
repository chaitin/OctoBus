## ctyun-accessone

天翼云 AccessOne（边缘安全加速平台 ESA）CTAPI 服务包 — 10 个 RPC（8 读 + 2 写），覆盖 6 个产品域。

| 项目 | 内容 |
|------|------|
| 用途 | AccessOne 配置查询 + 访问控制规则管理 |
| 接口数 | 10 个 RPC（8 读 + 2 写），覆盖 6 个产品域 |
| 测试 | 默认 `node --test`：39 pass / 0 fail / 1 skip；`RUN_INTEGRATION=1`：40 pass / 0 fail / 0 skip；真机 16/16 验证通过 |
| 输入 | 域名 + `product_code`（资源包/IPv6 查询另有参数） |
| 输出 | CTAPI 原始 JSON 响应透传（`http_status` + `http_body`） |
| 依赖 | `@chaitin-ai/octobus-sdk ^0.5.0` |
| 鉴权 | EOP HMAC-SHA256 四步链式签名（Stateless） |
| 运行时 | `long-running` |
| 网关 | `accessone-global.ctapi.ctyun.cn` |

### 命令速查

```bash
octobus-tentacles ctyun-accessone --help
ctyun-accessone --help
node --test ctyun__accessone/test/ctyun-accessone.test.js
RUN_INTEGRATION=1 node --test ctyun__accessone/test/ctyun-accessone.test.js
```

### 接口清单

| # | 命令 | HTTP方法 | 路径 | 产品域 | 类型 |
|---|------|----------|------|--------|------|
| 1 | query-domain-list | GET | /ctapi/v2/domain/query | 域名管理 | 读 |
| 2 | query-service-detail | POST | /ctapi/v1/sevice_detail | 域名管理 | 读 |
| 3 | query-domain-rule-act | POST | /ctapi/v1/domainRule/getDomainRuleAct | 防护规则引擎 | 读 |
| 4 | query-domain-rule-config | POST | /ctapi/v1/domainRule/get | 防护规则引擎 | 读 |
| 5 | query-waf-config | POST | /ctapi/v1/scdn/domain/wafConfigQuery | WAF | 读 |
| 6 | query-access-control-switch | POST | /ctapi/v1/scdn/domain/queryAccessControlAct | 访问控制 | 读 |
| 7 | insert-access-control | POST | /ctapi/v1/scdn/domain/accessControlInsert | 访问控制 | 写 |
| 8 | update-access-control-switch | POST | /ctapi/v1/scdn/domain/updateAccessControlAct | 访问控制 | 写 |
| 9 | query-resource-packages | POST | /ctapi/v1/accessone/purchase/queryResourcePackages | 资源包 | 读 |
| 10 | query-ipv6-nosup-link | POST | /ctapi/v1/ipv6/checkResult/getNoSupLink | IPv6检测 | 读 |

### 写操作字段

insert-access-control — 新增访问控制规则（支持批量）

| 参数 | 类型 | 必填 | 约束 | 说明 |
|------|------|------|------|------|
| domains | []string | 是 | 1≤len≤50 | 域名列表 |
| product_code | string | 是 | 如 `020` | 产品代码 |
| configs | []Object | 是 | 1≤len≤20 | 规则配置列表 |
| configs[n].mod | string | 是 | `ON`\|`OFF` | 规则开关 |
| configs[n].act | string | 是 | `LOG`\|`DENY`\|… | 处置动作 |
| configs[n].rule_name | string | 是 | — | 规则名称 |
| configs[n].public_range | []Group | 否 | 双重嵌套 | IP/区域条件 |

public_range 结构：
```json
[
  [
    { "zone": "IP|AREA", "equal": "true|false", "public_content": "192.0.2.1" }
  ]
]
```

update-access-control-switch — 域名级访问控制总开关

| 参数 | 类型 | 必填 | 约束 | 说明 |
|------|------|------|------|------|
| domain | string | 是 | — | 域名 |
| product_code | string | 是 | — | 产品代码 |
| mod | string | 是 | `ON`\|`CLOSE` | 目标开关状态 |

### 运行时配置与密钥

实例配置（`config.schema.json`）：

| 键 | 类型 | 默认值 | 说明 |
|----|------|--------|------|
| ctyun_gateway | string | `accessone-global.ctapi.ctyun.cn` | CTAPI 网关地址 |
| gateway | string | — | `ctyun_gateway` 别名 |
| timeoutMs | integer | `10000` | HTTP 超时（ms） |
| skipTlsVerify | boolean | `false` | 跳过 TLS 证书校验 |
| tlsInsecureSkipVerify | boolean | `false` | `skipTlsVerify` 兼容别名 |
| insecureSkipVerify | boolean | `false` | `skipTlsVerify` 兼容别名 |

密钥配置（`secret.schema.json`）：

| 键 | 类型 | 说明 |
|----|------|------|
| ctyun_ak | string | 天翼云 Access Key |
| ctyun_sk | string | 天翼云 Secret Key |
| ak | string | `ctyun_ak` 别名 |
| sk | string | `ctyun_sk` 别名 |

说明：
- 标准 Node `globalThis.fetch` 不识别自定义 `timeoutMs` / `skipTlsVerify` 字段；当前实现已改为 `AbortController` 控制超时，并在 `skipTlsVerify=true` 时切换到 `node:http` / `node:https` transport。
- `requestWithNodeTransport` 现已补齐压缩响应解码（`gzip` / `deflate` / `br`）与响应流错误传播，避免 TLS fallback 路径出现兼容性回归或悬挂。
- TLS fallback 回归测试默认通过 mock `https.request` 验证，不在仓库内保存任何私钥/证书 fixture；如需真实 HTTPS 回归，应在运行期临时生成测试材料，并确保不入库。

### 自动化测试记录

当前测试文件：`test/ctyun-accessone.test.js`

| 模式 | 命令 | 结果 | 说明 |
|------|------|------|------|
| 默认单测 | `node --test ctyun__accessone/test/ctyun-accessone.test.js` | 39 pass / 0 fail / 1 skip | 包含 helper、超时、TLS fallback、压缩响应、响应流错误回归；跳过 mock integration |
| mock integration | `RUN_INTEGRATION=1 node --test ctyun__accessone/test/ctyun-accessone.test.js` | 40 pass / 0 fail / 0 skip | 10/10 endpoint 通路 + EOP 签名校验 |

### 真机验证记录

测试域名：`test-jzb.ctcdn.cn`，产品：`020`（边缘安全加速）

| # | 接口 | HTTP | 说明 |
|---|------|------|------|
| 1 | 域名列表 | 200 ✓ | total=0，API 通路正常 |
| 2 | 服务基本信息 | 200 ✓ | 服务详情正常 |
| 3 | 防护规则引擎总开关 | 200 ✓ | 开关状态正常 |
| 4 | 防护规则引擎配置 | 200 ✓ | total=918，规则配置详情 |
| 5 | WAF 基础配置 | 200 ✓ | WAF 开关 + 静态文件后缀 |
| 6 | 访问控制总开关查询 | 200 ✓ | 总开关状态 ON |
| 7 | 新增访问控制规则 | 200 ✓ | EOP 签名验证通过 |
| 8 | 关闭访问控制总开关 | 200 ✓ | 域级开关启停正常 |
| 9 | 开启访问控制总开关 | 200 ✓ | 恢复初始状态 |
| 10 | 资源包列表 | 200 ✓ | 资源包信息正常 |
| 11 | query-access-control-switch | 200 ✓ | 回归：读通路正常 |
| 12 | update-access-control-switch CLOSE | 200 ✓ | 回归：写通路正常 |
| 13 | update-access-control-switch ON | 200 ✓ | 回归：恢复开关 |
| 14 | query-resource-packages | 200 ✓ | 回归：资源包通路 |
| 15 | query-ipv6-nosup-link | 200 ✓ | 回归：IPv6 通路 |
| 16 | MonkeyCode 修复后 5 接口回归 | 5/5 ✓ | timeout/TLS/资源包/IPv6/访问控制通路全部正常 |

### 代码审查修复记录

MonkeyCode 审查与后续一致性补全已同步到当前实现：

| # | 文件 | 问题 | 修复 | 验证 |
|---|------|------|------|------|
| 1 | src/ctyun-accessone.js | `logFlow` 对象 payload 输出 `[object Object]` | 对非字符串 payload 使用 `JSON.stringify` | 单测 |
| 2 | src/ctyun-accessone.js | `requireGateway` 含不可达死分支 | 简化为 `resolveGateway(bindings)` | 单测 |
| 3 | test/mock_upstream.js | mock 未校验 EOP HMAC-SHA256 签名 | 导入 `makeEopSignature` 计算期望签名比对 | mock integration 10/10 endpoints |
| 4 | src/ctyun-accessone.js | `resolveTimeoutMs` 漏读 `ctx.config.timeoutMs` / alias bindings | 改为统一读取 `mergedBindings(ctx).timeoutMs` | helper 单测 |
| 5 | src/ctyun-accessone.js | TLS 跳过标志读取不一致 | `skipTlsVerify` / `tlsInsecureSkipVerify` / `insecureSkipVerify` 统一走 `mergedBindings(ctx)` | helper 单测 |
| 6 | src/ctyun-accessone.js | 标准 Node `fetch` 忽略自定义 `timeoutMs` / TLS 字段 | 新增 `fetchWithTimeout` + `requestWithNodeTransport`，显式处理超时与 TLS fallback | 单测 + 5 接口真机回归 |
| 7 | test/ctyun-accessone.test.js | TLS fallback 回归原先依赖仓库内私钥/证书 fixture，存在敏感材料入库风险 | 改为默认 mock `https.request` 校验 `rejectUnauthorized=false`，不再提交 TLS fixture | 默认单测 |
| 8 | src/ctyun-accessone.js | `public_range` 非法结构静默降级为空数组 | 无效 group 直接抛 `INVALID_ARGUMENT` | 单测 |
| 9 | src/ctyun-accessone.js | `requestWithNodeTransport` 未处理压缩响应 | 新增 `gzip` / `deflate` / `br` 解码逻辑 | 单测 |
| 10 | src/ctyun-accessone.js | `requestWithNodeTransport` 缺少响应流错误监听 | 为原始响应流与解压流补 `error` 传播 | 单测 |

### 已知限制

| 限制 | 影响 | 原因 |
|------|------|------|
| GET 带参签名 | `query-domain-list` 不支持 `page/page_size` 之外的复杂查询扩展 | 天翼云 EOP GET 签名对 query string 的规范未公开，复杂带参请求易触发签名不一致 |
| 单条规则启停/删除 | 不支持 `updateAccessControl` / `deleteAccessControl` | AKSK 缺少 `accessControlConf` 子模块权限（返回 `200003`） |
| insert 规则数上限 | 高频测试域名可能撞到厂商侧规则配额 | 非代码问题，生产域名规则数较少时通常不受影响 |
| IPv6 数据依赖 | 需先在控制台创建检测任务获取 `requestId` | 接口为查询性质，无创建任务能力 |
