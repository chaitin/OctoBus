# WD K01 V9.0.2

网盾 K01 威胁情报联防阻断系统 **V9.0.2** RESTful API(V9 新增接口)的 OctoBus service package。
覆盖只读告警/名单查询与私有情报(攻击类)的增删查。

> 与已有 `wd__k01`(BlockIP / UnblockIP,基于 `/api/v1/security/iplist/save`)互补:本包聚焦
> **查询与情报管理**,不与其封禁写操作重叠。

## 支持版本

网盾 K01 V9.0.2(北京中盾网空防务技术有限公司)。文档中标注「V9 新增接口」的接口。

## 认证方式

仅支持 api 组用户(默认 `apiuser`)。每次方法调用是一段无状态会话:

1. `POST /api/cms/user/login`,body `{username, password}`,成功返回 `token.access_token`。
2. 业务请求带 `Authorization: Bearer <access_token>`。
3. `POST /api/cms/user/logout` 注销。

会话不跨调用缓存;`登出失败不影响主结果`(失败信息写入 `logout_raw_text`)。

## 配置

`config.schema.json`(非敏感):

```json
{ "host": "https://192.168.10.10", "timeoutMs": 1500, "skipTlsVerify": true }
```

`secret.schema.json`(敏感):

```json
{ "user": "apiuser", "password": "<password>" }
```

## 方法

| RPC | 上游接口 | 说明 | 写操作 |
| --- | --- | --- | --- |
| `QueryAttackLog` | `POST /api/v1/logsystem/atkmntlog/query` | 攻击监测日志查询 | 否 |
| `QueryIPList` | `POST /api/v1/security/iplist/query` | IP 黑/白名单查询 | 否 |
| `QueryThreatIntel` | `POST /api/v1/threatintelligence/attack/query` | 私有情报(攻击类)查询 | 否 |
| `AddThreatIntel` | `POST /api/v1/threatintelligence/attack/save` | 添加私有情报(攻击类) | 是 |
| `DeleteThreatIntel` | `POST /api/v1/threatintelligence/attack/delete` | 按 id 删除私有情报 | 是 |

### 关键输入

- `QueryAttackLog`:`page`/`count`,以及 `type_mask[]`(情报类型，如 256=IP黑名单)、`severity_mask[]`(0低/1中/2高)、`party_3rd_mask[]`(0公有/1私有)、`action_mask[]`(1监控/2阻断)、`r_sip`/`r_dip`/`r_s_time`/`r_e_time` 等过滤项;未提供的可选项不下发。
- `QueryIPList`:`color`(0黑/1白,默认0)、`dir`(0源/1目的/2两者,默认2)、`page`/`count`、`ip_search`/`comment_search`/时间过滤。
- `AddThreatIntel`:`ip`(IPv4,必填)、`type`(攻击类型,>0)、`severity`(优先级,>0)。`method` 固定 `add`。
- `DeleteThreatIntel`:`id`(>0)。`method` 固定 `delete`。

### 输出

- 查询类返回 `success/msg_type/msg/total/page/count/raw_json`(完整业务 JSON 透传)+ `login_raw_json`/`logout_raw_text`。
- 写类返回 `success/msg_type/msg/id/raw_json` + 同上会话字段。

## 风险边界

- **写操作**:`AddThreatIntel`、`DeleteThreatIntel`。私有情报增删会即时影响联防阻断决策——误加会导致正常 IP 被研判为威胁,误删会降低检出。无自动回滚:`Add` 用 `Delete`(凭返回 id)还原,`Delete` 需重新 `Add`。
- 设备 `success/msgType` 非成功一律映射为 `FAILED_PRECONDITION` 并带原始 `msg`,不静默吞错。
- 默认校验 TLS;私有自签部署需显式 `skipTlsVerify: true`。

## 错误映射

| 场景 | gRPC code |
| --- | --- |
| 缺 host/账号/密码、ip 非法、type/severity/id ≤0、color/dir 越界 | `INVALID_ARGUMENT` |
| 登录失败 / 业务 msgType 非 success | `FAILED_PRECONDITION` |
| 上游 401 / 403 | `PERMISSION_DENIED` |
| 网络错误 / 超时 / 5xx | `UNAVAILABLE` |
| 响应空体 / 非 JSON | `UNKNOWN` |

## 建议 capset

只读核查:`query-attack-log` + `query-ip-list` + `query-threat-intel`。
情报维护(写,需授权与审计):追加 `add-threat-intel` + `delete-threat-intel`。

## 验证方式

```bash
cd services
npm run validate -- --service-dir wd__k01_v9-0-2
npm test -- --service-dir wd__k01_v9-0-2 --coverage
npm run pack:check
```

真机验证:`query-attack-log`/`query-ip-list` 直接读;情报写操作用测试 IP(如 `198.51.100.x`)
执行 `add-threat-intel` → `query-threat-intel` 确认 → `delete-threat-intel` 清理。
PR 附设备版本、认证方式、调用截图与已知限制。**截图/代码里不得出现真实账号、密码、token 或生产地址。**
