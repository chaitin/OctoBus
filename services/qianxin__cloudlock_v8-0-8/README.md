# QIANXIN CloudLock V8.0.8

奇安信网神云锁服务器安全管理系统(椒图 / JiaoTu)**V8.0.8 Hotfix1** 的 OctoBus service package。
主机安全 / HIDS 类产品。当前实现**服务器列表查询**(只读),请求/响应已按真机抓包对齐。

> 对应 OctoBus issue [#240](https://github.com/chaitin/OctoBus/issues/240)。

## 支持版本

奇安信网神云锁服务器安全管理系统 V8.0.8 Hotfix1。

## 认证方式(web 会话 token)

控制台请求使用 **web 会话 token**:请求头 `token: <会话token>`,并按页面带 `menuCode`
(服务器列表页 = `5101`),同时携带 `Origin` / `Referer`。token 由外部登录后获取、经 `secret.token` 传入。

> ⚠️ **token 有时效**,过期需更换。本包不做自动登录(云锁登录常带验证码/公钥加密,自动化不稳),
> 采用「外部传入 token」模式;后续若提供稳定登录流程可再加自动续期。

## 配置

```json
// config
{ "host": "https://192.168.10.10", "timeoutMs": 5000, "skipTlsVerify": true }
// secret
{ "token": "<web 会话 token>" }
```

## 方法

| RPC | 上游接口 | menuCode |
| --- | --- | --- |
| `QueryMachineList` | `POST /api/assetSrv/machineController/searchMachineList` | 5101 |

### 请求 / 响应

- 请求(字段名对齐设备 camelCase,未设置的过滤项以空串下发,与真机一致):
  `current_page`(默认 1)、`max_results`(默认 20)、`group_uuid`、`if_show_current_group_info`(默认 0)、
  `search_info_list`,以及 `machine_group`/`online_status`/`run_status`/`os_type`/`operation_system`/
  `department`/`direct_person`/`asset_level`/`os_category`/`arch`/`system_language`/`memory_size`/
  `disk_size`/`disk_usage`/`kernel_version`/`machine_tags` 等过滤项。
- 响应:`code`(成功为 `"1"`)、`msg`(成功为 `"成功"`)、`total`、`http_status`、`raw_json`(含 `data.list`)。

## 风险边界

- 本方法为**只读查询**,无写操作,风险面低。
- 会话 token 等同登录态,泄露即会话失陷;仅放 `secret`,勿写入 `config`、日志或截图。
- 默认校验 TLS;私有自签部署需 `skipTlsVerify: true`。

## 错误映射

| 场景 | gRPC code |
| --- | --- |
| 缺 host/token | `INVALID_ARGUMENT` |
| 上游 401/403 / `code != "1"`(会话失效等) | `PERMISSION_DENIED` / `FAILED_PRECONDITION` |
| 其它 4xx | `FAILED_PRECONDITION` |
| 网络错误/超时/5xx | `UNAVAILABLE` |
| 空体/非 JSON | `UNKNOWN` |

## 建议 capset

`query-machine-list`(只读),可直接授权给 AI SOC / 工作流做资产核查。

## 验证方式

```bash
cd services
npm run validate -- --service-dir qianxin__cloudlock_v8-0-8
npm test -- --service-dir qianxin__cloudlock_v8-0-8 --coverage
npm run pack:check
```

真机验证:用一个有效会话 token 调 `query-machine-list`,确认返回 `code:"1"` 且 `data.list` 为服务器列表。
PR 附**真机验证截图**(token / host / 响应中的敏感数据已打码)。**代码/截图里不得出现真实 token 或生产地址。**

## 后续

webshell 告警(`/api/eventSrv/webshellController/webshellList`)、病毒(`/api/cloudScanSrv/virus/file`)、
漏洞(`/api/scanSrv/scanOverviewController/listVulnRisks`)等查询接口待补真机抓包(各自 menuCode + body)后扩展。
