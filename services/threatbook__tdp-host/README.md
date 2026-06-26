# ThreatBook TDP Host

微步在线 **TDP（威胁检测平台）** web 控制台 API 的 OctoBus service package，提供失陷主机
（失陷/威胁事件）汇总列表查询能力。

> 与已有的 `threatbook__tdp`（联动封禁 `BlockDomain`/`UnblockDomain`，`/api/v1` + api_key/HMAC）
> 相比，本 package 面向 web 控制台 `/api/web` 接口、以 `tdp-authentication` 头部令牌鉴权，
> 提供 SOC 高频的失陷主机检索原语（只读）。

## 认证方式

控制台调用通过 `tdp-authentication` 请求头携带会话令牌（非 api_key / HMAC 签名）。令牌从
登录后的浏览器请求中获取，作为 secret 配置；过期需重新获取。

## 配置

`config.schema.json`（非敏感）：

```json
{
  "restBaseUrl": "https://192.0.2.13",
  "timeoutMs": 5000,
  "skipTlsVerify": true
}
```

`secret.schema.json`（敏感，勿写入 config）：

```json
{
  "tdp_authentication": "<token>"
}
```

## 方法

| RPC | path | 说明 | 写操作 |
| --- | --- | --- | --- |
| `QueryFallHostList` | `POST /api/web/host/getFallHostSumList` | 查询失陷主机汇总列表 | 否 |

### 输入（关键字段，均可缺省）

- `direction[]`：威胁方向，缺省 `["in","lateral","out"]`。
- `threat_type[]`：威胁类型，缺省覆盖设备全量类型。
- `time_from` / `time_to`：Unix 秒，缺省取最近 7 天。
- `keyword`：模糊关键字（命中 `threat.name`/`external_ip`/`machine` 等）。
- `result` / `status[]` / `disposal_status[]`：处置结果 / 事件状态 / 处置状态筛选。
- `cur_page`（默认 1）/ `page_size`（默认 20）/ `sort_by`（默认 `severity`）/ `sort_flag`（默认 `desc`）。
- `extra_condition`：`Struct`，透传 / 覆盖 `condition` 内任意字段（高级用法）。

### 输出

- `response_code`：设备业务码，0=成功（非 0 抛 `FAILED_PRECONDITION`）。
- `item_count`：本页条目数。
- `data`：`data` 段透传（`items` + `page`）。
- `raw_json`：完整响应体透传。

## 错误映射

| 场景 | gRPC code |
| --- | --- |
| 参数 / binding 缺失 | `INVALID_ARGUMENT` |
| 上游 401 / 403（令牌失效） | `PERMISSION_DENIED` |
| 上游 4xx / `response_code != 0` | `FAILED_PRECONDITION` |
| 网络错误 / 超时 / 5xx | `UNAVAILABLE` |
| 响应非 JSON / 空体 | `UNKNOWN` |

## 验证方式

```bash
cd services
npm run validate -- --service-dir threatbook__tdp-host
npm test -- --service-dir threatbook__tdp-host
npm run pack:check
```

真实设备验证：登录控制台后从浏览器请求中取得 `tdp-authentication` 令牌，调用
`query-fall-host` 检索失陷主机列表，比对控制台【失陷主机】页面结果。提交 PR 时附设备版本、
认证方式与调用截图，**不要提交真实令牌、生产地址或业务数据**。
