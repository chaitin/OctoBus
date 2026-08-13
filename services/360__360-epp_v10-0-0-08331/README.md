# 360终端安全管理系统 (EPP) OctoBus Service

360 Enterprise Endpoint Protection Platform (EPP) v10.0.0.08331 的 OctoBus 适配服务，提供终端管理、告警查询、病毒扫描统计、漏洞修复统计等 API。

## 导入 OctoBus

```bash
octobus service import --id epp-360 ./services/360__360-epp_v10-0-0-08331
```

## 包文件说明

- `service.json`: OctoBus 服务描述文件
- `proto/360_epp.proto`: gRPC API 定义
- `config.schema.json`: 非敏感配置（endpoint、超时、TLS）
- `secret.schema.json`: 敏感配置（管理员账号密码）
- `src/360-epp.js`: 360 EPP REST API 代理实现
- `src/service.js`: OctoBus SDK `defineService` wrapper
- `bin/360-epp.js`: 服务入口
- `test/360-epp.test.js`: 单元测试（参数校验、API 映射、错误映射）
- `test/mock_upstream.js`: 本地 mock 服务器

## 配置

### Config（非敏感配置）

```json
{
  "endpoint": "https://192.168.0.109",
  "timeoutMs": 30000,
  "skipTlsVerify": true
}
```

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `endpoint` | 360 EPP 管理控制台地址 | 必填 |
| `timeoutMs` | HTTP 请求超时（毫秒） | 30000 |
| `skipTlsVerify` | 跳过 TLS 证书验证 | true |

### Secret（敏感配置）

```json
{
  "username": "eppadmin",
  "password": "your-password"
}
```

| 字段 | 说明 |
|------|------|
| `username` | 360 EPP 管理员账号 |
| `password` | 360 EPP 管理员密码（明文） |

## RPC 方法

| 方法 | 说明 |
|------|------|
| `Qihoo360_EPP.Qihoo360_EPP/GetDashboardInfo` | 获取仪表盘概览信息 |
| `Qihoo360_EPP.Qihoo360_EPP/ListTerminals` | 查询终端列表（分页、关键词搜索） |
| `Qihoo360_EPP.Qihoo360_EPP/GetTerminalDetail` | 获取终端详细信息 |
| `Qihoo360_EPP.Qihoo360_EPP/ListAlarms` | 查询告警日志列表 |
| `Qihoo360_EPP.Qihoo360_EPP/GetVirusStats` | 获取病毒扫描统计数据 |
| `Qihoo360_EPP.Qihoo360_EPP/GetLeakFixStats` | 获取漏洞修复统计数据 |
| `Qihoo360_EPP.Qihoo360_EPP/GetTerminalHardware` | 获取终端硬件配置信息 |

## 认证流程

本服务使用 360 EPP 的 Web 管理后台认证流程：

1. 调用 `GET /user/getPubKey?username=xxx` 获取 RSA 公钥
2. 使用 RSA 公钥加密密码，同时对密码做 MD5 哈希
3. 调用 `POST /user/login` 提交 `username` / `password`(MD5) / `rPassword`(RSA加密)
4. 获取会话 Cookie (`PN`) 用于后续 API 调用

会话 Cookie 在服务运行期间缓存复用。若会话过期（errno=10401），会自动重新登录。

## 错误映射

| 场景 | gRPC Status |
|------|-------------|
| 认证失败 | `UNAUTHENTICATED` |
| 参数无效 | `INVALID_ARGUMENT` |
| 会话过期 | `UNAUTHENTICATED` |
| 上游 API 错误 | `FAILED_PRECONDITION` |
| 网络/超时 | `UNAVAILABLE` / `DEADLINE_EXCEEDED` |

## 支持版本

- 360终端安全管理系统 v10.0.0.08331
- 认证方式：Web 管理后台 RSA 加密登录

## 注意事项

- 本服务使用 Web 管理后台的认证接口，需要具有管理权限的账号
- 密码通过 RSA 非对称加密传输，不在网络中明文传递
- 会话 Cookie 在内存中缓存，实例重启后需要重新登录
- 建议为 OctoBus 创建专用的管理员账号
- 写操作（如终端隔离、策略下发）暂未实现，仅提供查询能力

## 本地验证

```bash
cd services
npm run validate -- --service-dir 360__360-epp_v10-0-0-08331
npm test -- --service-dir 360__360-epp_v10-0-0-08331
npm run pack:check
```
