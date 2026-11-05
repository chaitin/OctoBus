# SafeLine WAF (Login) OctoBus Service

雷池 SafeLine WAF 控制台账号密码登录版只读查询适配器，适用于无 OpenAPI / API-Token 的部署场景。

```bash
octobus service import safeline-waf-login ./services/chaitin__safeline-waf-login
```

## Package Files

- `service.json` — OctoBus 服务清单。
- `proto/safeline_waf_login.proto` — gRPC API 定义，5 个方法。
- `config.schema.json` — 非密配置：`endpoint`、`skipTlsVerify`、`proxy_url` 等。
- `secret.schema.json` — 密钥配置：`bindUser`、`bindPassword`（必填）。
- `src/safeline-waf-login.js` — 登录会话、请求映射、响应归一化、错误分类。
- `src/service.js` — OctoBus SDK `defineService` 封装。
- `test/safeline-waf-login.test.js` — node:test 覆盖登录与只读方法。

## 认证方式

Django CSRF + session 会话认证：

1. `GET /api/CSRFTokenAPI` 获取 `csrftoken` cookie
2. `POST /api/LoginAPI` 登录，下发 `sessionid` cookie
3. 后续只读接口携带 `Cookie: sessionid=...`

| 字段 | 必填 | 说明 |
|------|------|------|
| `bindUser` | 是 | SafeLine 控制台登录用户名 |
| `bindPassword` | 是 | SafeLine 控制台登录密码 |

## Configuration

```json
{
  "endpoint": "https://safeline.example.com",
  "skipTlsVerify": false
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `endpoint` | string | 是 | SafeLine 控制台 base URL |
| `skipTlsVerify` | boolean | 否 | 跳过 TLS 证书校验（私有部署） |
| `proxy_url` / `proxyUrl` | string | 否 | 可选 HTTP/SOCKS 代理 URL |
| `timeoutMs` | integer | 否 | HTTP 超时毫秒数 |

## RPC Methods

| 方法 | 说明 |
|------|------|
| `Chaitin_WAF_SAFELINE_LOGIN.Chaitin_WAF_SAFELINE_LOGIN/Login` | 登录获取会话 |
| `Chaitin_WAF_SAFELINE_LOGIN.Chaitin_WAF_SAFELINE_LOGIN/GetProfile` | 查询当前用户信息 |
| `Chaitin_WAF_SAFELINE_LOGIN.Chaitin_WAF_SAFELINE_LOGIN/GetOverview` | 查询概览信息 |
| `Chaitin_WAF_SAFELINE_LOGIN.Chaitin_WAF_SAFELINE_LOGIN/SearchDetectLog` | 查询检测日志 |
| `Chaitin_WAF_SAFELINE_LOGIN.Chaitin_WAF_SAFELINE_LOGIN/GetESIndices` | 查询 ES 索引状态 |

## Risk Boundary

- **风险等级**: `read-only`
- 除 `Login` 外均为只读查询，不修改 SafeLine 平台任何数据。
