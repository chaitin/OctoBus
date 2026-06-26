# DongTai IAST

OctoBus service package for [Huoxian DongTai IAST](https://github.com/HuoxianPub/dongtai-iast) — an open-source Interactive Application Security Testing (IAST) platform.

## 支持版本

- DongTai IAST >= 1.14.0（测试验证版本：1.14.0）
- 兼容所有基于 Token 认证的 DongTai IAST 版本

## 认证方式

DongTai IAST 使用 REST Framework Token 认证。在请求头中携带 `Authorization: Token <token>` 进行认证。

Token 获取方式：
1. 通过 DongTai Web UI 的"个人设置 > API Token"页面生成
2. 通过 `/api/v1/user/token` API 端点获取
3. 通过 Django Admin 后台创建

## 配置示例

```json
{
  "endpoint": "http://dongtai.example.com:9090",
  "timeoutMs": 5000,
  "skipTlsVerify": false
}
```

### Secret 配置

```json
{
  "apiToken": "your-dongtai-api-token-here"
}
```

| 字段 | 说明 |
|------|------|
| `endpoint` | DongTai IAST REST API 基础地址（必填），如 `http://192.168.1.100:9090` |
| `timeoutMs` | HTTP 请求超时时间，默认 5000ms |
| `skipTlsVerify` | 是否跳过 TLS 证书验证，默认 false |
| `headers` | 额外 HTTP 请求头（可选） |
| `apiToken` | DongTai API Token（必填，放在 secret 中） |

## 方法说明

### 漏洞管理

| 方法 | 说明 | 风险说明 |
|------|------|----------|
| `ListVulnerabilities` | 查询漏洞列表，支持按项目/等级/类型/状态筛选 | 只读操作，无风险 |
| `GetVulnerability` | 获取漏洞详情（含请求/响应/调用栈） | 只读操作，可能包含敏感请求数据 |
| `UpdateVulnStatus` | 更新漏洞状态（confirmed/ignored/recheck/fake） | 写操作，改变漏洞处置状态 |
| `GetVulnSummary` | 获取漏洞汇总统计（按等级/类型） | 只读操作，无风险 |

### 项目管理

| 方法 | 说明 | 风险说明 |
|------|------|----------|
| `ListProjects` | 获取项目列表 | 只读操作，无风险 |
| `GetProject` | 获取项目详情 | 只读操作，无风险 |
| `CreateProject` | 创建项目 | 写操作，幂等（同名会创建新项目） |
| `DeleteProject` | 删除项目 | 写操作，不可回滚，会删除项目及相关数据 |

### Agent 管理

| 方法 | 说明 | 风险说明 |
|------|------|----------|
| `ListAgents` | 获取 Agent 列表 | 只读操作，无风险 |

### 其他

| 方法 | 说明 | 风险说明 |
|------|------|----------|
| `GetSystemInfo` | 获取系统信息 | 只读操作，无风险 |
| `ListStrategies` | 获取检测策略列表 | 只读操作，无风险 |
| `GetScaDetail` | 获取 SCA 组件漏洞详情 | 只读操作，无风险 |

### 写操作详细说明

#### UpdateVulnStatus
- **默认参数**: 无默认值，`id` 和 `status` 均为必填
- **幂等语义**: 幂等操作，重复设置相同状态结果一致
- **回滚方式**: 可通过再次调用设置原状态恢复
- **审计字段**: 操作会记录在漏洞日志中

#### CreateProject
- **默认参数**: `mode` 默认为"插桩模式"，`version_name` 默认为 "V1.0"
- **幂等语义**: 非幂等，同名项目会创建多个
- **回滚方式**: 使用 `DeleteProject` 删除创建的项目
- **审计字段**: 项目记录 `owner` 和 `latest_time`

#### DeleteProject
- **默认参数**: 无
- **幂等语义**: 幂等，删除已删除项目返回成功
- **回滚方式**: 不可回滚，需重新创建项目
- **审计字段**: 删除操作不可逆

## 建议 Capset

```json
{
  "name": "dongtai-iast-readonly",
  "description": "DongTai IAST 只读能力集",
  "methods": [
    "ListVulnerabilities",
    "GetVulnerability",
    "GetVulnSummary",
    "ListProjects",
    "GetProject",
    "ListAgents",
    "GetSystemInfo",
    "ListStrategies",
    "GetScaDetail"
  ]
}
```

```json
{
  "name": "dongtai-iast-full",
  "description": "DongTai IAST 完整能力集（含写操作）",
  "methods": [
    "ListVulnerabilities",
    "GetVulnerability",
    "UpdateVulnStatus",
    "GetVulnSummary",
    "ListProjects",
    "GetProject",
    "CreateProject",
    "DeleteProject",
    "ListAgents",
    "GetSystemInfo",
    "ListStrategies",
    "GetScaDetail"
  ]
}
```

## 本地开发与测试

```bash
# 设置环境变量进行本地调试
export OCTOBUS_SERVICE_CONTEXT='{"config":{"endpoint":"http://localhost:9090"},"secret":{"apiToken":"your-token"}}'

# 调用 ListVulnerabilities
node bin/dongtai-iast.js call --data-json '{"page":1,"page_size":10}'

# 调用 GetVulnSummary
node bin/dongtai-iast.js get-vuln-summary --data-json '{}'

# 运行测试
cd services
npm test -- --service-dir huoxian__dongtai-iast

# 验证
npm run validate -- --service-dir huoxian__dongtai-iast
```

## 已知限制

1. DongTai IAST 登录接口需要验证码（captcha），OctoBus service 使用 Token 认证绕过此限制
2. 漏洞列表返回字段可能因 DongTai 版本差异略有不同，service 做了字段兜底处理
3. 项目删除为不可逆操作，建议在 capset 中谨慎授权
4. 暂不支持 Agent 的启停操作（需要 Agent 端配合）
5. SCA 详情依赖 DongTai Pro 版本的功能，开源版可能返回空数据
