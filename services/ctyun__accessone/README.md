## ctyun-accessone

天翼云 AccessOne（边缘安全加速平台 ESA）CTAPI 服务包 — 10 个 RPC（8 读 + 2 写），覆盖 6 个产品域。

| 项目 | 内容 |
|------|------|
| 用途 | AccessOne 配置查询 + 访问控制规则管理 |
| 接口数 | 10 个 RPC（8读+2写），覆盖 6 个产品域 |
| 测试 | 36 pass（含 mock integration EOP 签名验证），真机 16/16 验证通过 |
| 输入 | 域名 + product_code（资源包/IPv6 查询另有参数） |
| 输出 | CTAPI 原始 JSON 响应透传（http_status + http_body） |
| 依赖 | @chaitin-ai/octobus-sdk ^0.5.0 |
| 鉴权 | EOP HMAC-SHA256 四步链式签名（Stateless） |
| 运行时 | long-running |
| 网关 | accessone-global.ctapi.ctyun.cn |

### 命令速查

```bash
octobus-tentacles ctyun-accessone --help
ctyun-accessone --help
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
| 7 | **insert-access-control** | POST | /ctapi/v1/scdn/domain/accessControlInsert | 访问控制 | **写** |
| 8 | **update-access-control-switch** | POST | /ctapi/v1/scdn/domain/updateAccessControlAct | 访问控制 | **写** |
| 9 | query-resource-packages | POST | /ctapi/v1/accessone/purchase/queryResourcePackages | 资源包 | 读 |
| 10 | query-ipv6-nosup-link | POST | /ctapi/v1/ipv6/checkResult/getNoSupLink | IPv6检测 | 读 |

### 写操作字段

**insert-access-control** — 新增访问控制规则（支持批量）

| 参数 | 类型 | 必填 | 约束 | 说明 |
|------|------|------|------|------|
| domains | []string | 是 | 1≤len≤50 | 域名列表 |
| product_code | string | 是 | 如 "020" | 产品代码 |
| configs | []Object | 是 | 1≤len≤20 | 规则配置列表 |
| configs[n].mod | string | 是 | "ON"\|"OFF" | 规则开关 |
| configs[n].act | string | 是 | "LOG"\|"DENY"\|… | 处置动作 |
| configs[n].rule_name | string | 是 | — | 规则名称 |
| configs[n].public_range | []Group | 否 | — | IP/区域条件（双重嵌套） |

public_range 结构:
```
public_range: [
  [                          // Group (组内 AND)
    { zone: "IP"|"AREA", equal: "true"|"false", public_content: "192.0.2.1" }
  ]
]
```

**update-access-control-switch** — 域名级访问控制总开关

| 参数 | 类型 | 必填 | 约束 | 说明 |
|------|------|------|------|------|
| domain | string | 是 | — | 域名 |
| product_code | string | 是 | — | 产品代码 |
| mod | string | 是 | "ON"\|"CLOSE" | 目标开关状态 |

### 真机验证记录

测试域名: `test-jzb.ctcdn.cn`, 产品: `020`（边缘安全加速）

| # | 接口 | HTTP | 说明 |
|---|------|------|------|
| 1 | 域名列表 | 200 ✓ | total=0, API 通路正常 |
| 2 | 服务基本信息 | 200 ✓ | 服务详情正常 |
| 3 | 防护规则引擎总开关 | 200 ✓ | 开关状态正常 |
| 4 | 防护规则引擎配置 | 200 ✓ | total=918, 规则配置详情 |
| 5 | WAF 基础配置 | 200 ✓ | WAF 开关+静态文件后缀 |
| 6 | 访问控制总开关查询 | 200 ✓ | 总开关状态 ON |
| 7 | 新增访问控制规则 | 200 ✓ | EOP 签名验证通过 |
| 8 | 关闭访问控制总开关 | 200 ✓ | 域级开关启停正常 |
| 9 | 开启访问控制总开关 | 200 ✓ | 恢复初始状态 |
| 10 | 资源包列表 | 200 ✓ | 资源包信息正常 |

| # | 回归验证（修复后） | HTTP | 说明 |
|---|------|------|------|
| 11 | query-access-control-switch | 200 ✓ | 回归：读通路正常 |
| 12 | update-access-control-switch CLOSE | 200 ✓ | 回归：写通路正常 |
| 13 | update-access-control-switch ON | 200 ✓ | 回归：恢复开关 |
| 14 | query-resource-packages | 200 ✓ | 回归：资源包通路 |
| 15 | query-ipv6-nosup-link | 200 ✓ | 回归：IPv6 通路 |
| 16 | 修复 MonkeyCode 全部 6 项问题后，5 接口全量回归 | 5/5 ✓ | 通路全部正常 |

### 代码审查修复记录

MonkeyCode 自动扫描共发现 6 项问题（分三轮扫描），已全部修复：

| # | 文件 | 问题 | 修复 | 验证 |
|---|------|------|------|------|
| 1 | src/ctyun-accessone.js | logFlow 对象 payload 输出 [object Object] | 新增 `JSON.stringify` 处理非字符串 payload | 单测 |
| 2 | src/ctyun-accessone.js | requireGateway 不可达死代码分支 | 移除 `if(!g) throw` | 单测 |
| 3 | test/mock_upstream.js | mock 不验证 EOP HMAC-SHA256 签名 | 导入 `makeEopSignature` + 独立计算期望签名比对 | mock integration 10/10 endpoints, 36/36 total |
| 4 | src/ctyun-accessone.js | signedPost/signedGet TLS 选项忽略 config | `ctx.bindings` → `mergedBindings(ctx)` | 单测 + 真机回归 |
| 5 | src/ctyun-accessone.js | resolveTimeoutMs 漏读 ctx.config.timeoutMs | 新增 `mergedBindings(ctx).timeoutMs` 到优先级链 | 单测 |
| 6 | src/ctyun-accessone.js | public_range 无效结构静默降级为空数组 | 无效 grp 改为抛 INVALID_ARGUMENT | 单测 (invalid public_range structure) |

### 已知限制

| 限制 | 影响 | 原因 |
|------|------|------|
| GET 带参签名 | query-domain-list 不支持 page/page_size 等查询参数 | 天翼云 EOP GET 签名 body=empty vs query string 签名算法不一致 |
| 单条规则启停/删除 | 不支持 updateAccessControl / deleteAccessControl | AKSK 缺少 accessControlConf 子模块权限（返回 200003） |
| insert 规则数上限 | 测试域名因频繁测试导致规则条数达配额上限 | 非代码问题，生产域名规则数少不受影响 |
| IPv6 数据依赖 | 需先在控制台创建检测任务获取 requestId | 接口为查询性质，无创建任务能力 |
