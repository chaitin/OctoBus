# Venustech IPS

启明星辰 IPS(入侵防御系统)攻击日志查询的 OctoBus service package。
属于「流量检测 / NIPS」类。设备日志页返回 HTML,本包解析其中的日志表行为结构化条目。

## 支持版本

启明星辰 IPS(web 控制台,日志页 `/log/memorylog/ipslog.php`)。请求/响应按真机抓包对齐。

## 认证方式(web 会话 Cookie)

控制台以 **会话 Cookie** 鉴权(浏览器 `credentials: include`)。请求头 `Cookie: <会话cookie>`,
cookie 经 `secret.cookie` 外部传入。

> ⚠️ cookie 有时效,过期需更换。会话失效时设备会以 200 返回登录页;本包用日志页标记
> (`ips_log_filter`)识别,识别失败时报 `FAILED_PRECONDITION`,避免把登录页当成空结果。

## 配置

```json
// config
{ "host": "https://192.168.1.10", "timeoutMs": 5000, "skipTlsVerify": true }
// secret
{ "cookie": "PHPSESSID=<会话id>" }
```

## 方法

| RPC | 上游接口 |
| --- | --- |
| `QueryIpsLog` | `GET /log/memorylog/ipslog.php` |

### 请求 / 响应

- 请求:`limit`(返回条目上限,客户端侧截断;<=0 表示全部)。
- 响应:`http_status`、`total`(解析到的条目数)、`entries[]`。每条 `entries` 含:
  `name`(名称)、`src_ip`/`src_port`、`dst_ip`/`dst_port`、`protocol`、`time`、`type`(类型)、
  `severity`(事件级别)、`priority`(优先级)、`action`(动作)、`policy_id`(策略ID)、`count`(发生次数)、`content`(内容)。

> 注:当前抓包为不带过滤的全量 GET;按源/目的 IP/时间过滤(设备 `ips_log_filter` 表单)未实现,
> 待补对应抓包后扩展。响应原始 HTML(较大且含内网地址)不回传,仅返回结构化条目。

## 风险边界

- 本方法为**只读查询**,无写操作,风险面低。
- 会话 cookie 等同登录态,泄露即会话失陷;仅放 `secret`,勿写入 `config`、日志或截图。
- 默认校验 TLS;私有自签部署需 `skipTlsVerify: true`。

## 错误映射

| 场景 | gRPC code |
| --- | --- |
| 缺 host/cookie | `INVALID_ARGUMENT` |
| 上游 401/403 | `PERMISSION_DENIED` |
| 其它 4xx / 会话失效(返回登录页) | `FAILED_PRECONDITION` |
| 网络错误/超时/5xx | `UNAVAILABLE` |

## 建议 capset

`query-ips-log`(只读),可直接授权给 AI SOC / 工作流做告警拉取与研判。

## 验证方式

```bash
cd services
npm run validate -- --service-dir venus__ips
npm test -- --service-dir venus__ips --coverage
npm run pack:check
```

真机验证:用一个有效会话 cookie 调 `query-ips-log`,确认返回 IPS 告警条目(名称/源IP/目的IP/时间/级别/动作 等)。
PR 附**真机验证截图**(cookie / host / 响应中的内网 IP 等敏感数据已打码)。**代码/测试/截图里不得出现真实 cookie、内网地址或业务数据。**
