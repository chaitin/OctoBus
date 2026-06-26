# QIANXIN FW SecGate3600 V3.6.6.0

奇安信网神 SecGate3600 防火墙 **V3.6.6.0** RESTful API 的 OctoBus service package，覆盖
登录、IP 地址黑名单封禁 / 解禁 / 查询、注销。

## 支持版本

| 产品系列 | 版本 |
| --- | --- |
| NSG2000 & NSG4000 | V3.6.6.0（-6.91.13.156124） |
| NSG3000 & 5000 & 7000 & 9000 | V3.6.6.0（-6.1.13.156124） |
| NSG6000 | V3.6.6.0（-6.90.13.156124） |

> 与已有的 `qianxin__fw-secgate3600`（Login / UpdateAddressGroup / Logout）相比，本 package
> 面向 V3.6.6.0 的 `addr_blacklist` 模块，提供 SOC 高频的 IP 黑名单封禁 / 解禁原语。

## 认证方式

设备需在【系统配置】>【设备管理】>【本机设置】开启 RESTful API 服务，并把联动方 IP
加入可信主机。鉴权流程：

1. `POST /v1.0/login`，body `{username, password}`，成功返回 `result.token`。
2. 后续业务请求 `POST /v1.0/rest/`，携带 `Cookie: PHPSESSID=...; token=<token>`。
3. `POST /v1.0/out` 注销，token 立即失效。

会话（token + cookie）按 `instance_id + host` 缓存在进程内，`BlockIP/UnblockIP/QueryBlacklist`
前必须先 `Login`。

## 配置

`config.schema.json`（非敏感）：

```json
{
  "host": "https://198.51.100.10:8443",
  "timeoutMs": 5000,
  "skipTlsVerify": true
}
```

`secret.schema.json`（敏感，勿写入 config）：

```json
{
  "user": "api_user",
  "password": "<password>"
}
```

## 方法

| RPC | module / function | 说明 | 写操作 |
| --- | --- | --- | --- |
| `Login` | `/v1.0/login` | 登录并缓存会话 | 否 |
| `BlockIP` | `addr_blacklist` / `add_blacklist_ip` | 逐条加入 IP 黑名单（设备单次仅支持 1 条） | 是 |
| `UnblockIP` | `addr_blacklist` / `del_blacklist_by_id` | 按 `ip_start`/`ip_end` 逐条删除 | 是 |
| `QueryBlacklist` | `addr_blacklist` / `get_blacklist_config` | 按 `search_key` 查询 | 否 |
| `Logout` | `/v1.0/out` | 注销并清除会话 | 是 |

### 输入 / 输出（关键字段）

- `BlockIPRequest.items[]`：`ip_start`（必填）、`ip_end`（缺省=ip_start）、`enable`（默认 `enable`）、`desc`、`schedule`。
- `UnblockIPRequest.targets[]`：`ip_start`（必填）、`ip_end`（缺省=ip_start）。
- `BlockIP/UnblockIP` 返回 `results[]`，与请求条目一一对应，含 `error_code`（设备 `head.error_code`，0=成功）、`error_string`、`http_status` 与 `raw_json` 透传。
- `QueryBlacklistResponse`：`error_code`、`total`、`data`（黑名单明细透传）、`raw_json`。

## 风险边界

- **写操作**：`BlockIP`、`UnblockIP`、`Logout`。`BlockIP` 幂等——同一 `ip_start` 重复下发覆盖原配置；`UnblockIP` 删除不存在的条目不报错。无自动回滚：误封后需调用 `UnblockIP` 还原。
- 单台设备 IP/MAC 黑名单**最大规格 1000 条**，且**不支持批量**，本 package 通过循环逐条下发。
- `addr_blacklist` 封禁为全局阻断，建议先 `QueryBlacklist` 评估命中范围再下发。
- 默认校验 TLS 证书；私有部署自签名证书需显式设置 `skipTlsVerify: true`。

## 错误映射

| 场景 | gRPC code |
| --- | --- |
| 参数缺失 / 非法 | `INVALID_ARGUMENT` |
| 未先 `Login` | `FAILED_PRECONDITION` |
| 上游 401 / 403（会话失效，自动清会话） | `PERMISSION_DENIED` |
| 网络错误 / 超时 | `UNAVAILABLE` |
| 响应非 JSON / 空体 | `UNKNOWN` |

## 建议 capset

最小集：`login` + `query-blacklist`（只读核查）。
处置集：追加 `block-ip` + `unblock-ip`（写操作，需授权与审计）。`logout` 视会话生命周期管理需要加入。

## 验证方式

```bash
cd services
npm run validate -- --service-dir qianxin__fw-secgate3600_v3-6-6
npm test -- --service-dir qianxin__fw-secgate3600_v3-6-6
npm run pack:check
```

真实设备验证：用测试 IP（如文档保留段 `198.51.100.0/24`）执行 `login → block-ip → query-blacklist`
确认命中，再 `unblock-ip` 清理，最后 `logout`。提交 PR 时附设备版本、认证方式、调用截图与已知限制；
**不要提交真实账号、密码、token、cookie、生产地址或业务数据。**
