# NSFOCUS IDS V5.6R10F02

绿盟(NSFOCUS)入侵检测/防御系统 IDS/IPS **V5.6R10F02** 告警事件查询的 OctoBus service package。
属「流量检测 / NIPS」类。设备事件页返回 HTML,本包解析事件表行为结构化告警。

> 对应 OctoBus issue [#260](https://github.com/chaitin/OctoBus/issues/260)。

## 支持版本

NSFOCUS IDS/IPS V5.6R10F02(web 控制台,事件页 `/ips/event`)。请求/响应按真机抓包对齐。

## 认证方式(web 会话 Cookie)

控制台以 **会话 Cookie** 鉴权(浏览器 `credentials: include`)。请求带:
`Cookie: <会话cookie>`、`Referer: {host}/ips/event`、`X-Requested-With: XMLHttpRequest`。
cookie 经 `secret.cookie` 外部传入。

> ⚠️ cookie 有时效,过期需更换。会话失效时设备以 200 返回登录页;本包用事件表标记
> (`mytable`)识别,识别失败报 `FAILED_PRECONDITION`,避免把登录页当成空结果。

## 配置

```json
// config
{ "host": "https://192.168.1.10", "timeoutMs": 5000, "skipTlsVerify": true }
// secret
{ "cookie": "<会话cookie>" }
```

## 方法

| RPC | 上游接口 |
| --- | --- |
| `QueryEventList` | `GET /ips/eventList/detail/false/dns/false` |

### 请求 / 响应

- 请求:`limit`(返回条目上限,客户端侧截断;<=0 表示全部)。
- 响应:`http_status`、`total`、`entries[]`。每条 `entries` 含:
  `severity`(危险程度:低/中/高)、`action`(动作:允许/阻断 等)、`time`、`event_id`(事件编号)、
  `event_name`(事件名称)、`src_ip`/`src_port`、`dst_ip`/`dst_port`、`auth_user`(认证用户)、`linked_account`(关联账号)。

> 注:当前抓包为不带过滤的事件列表 GET;按条件过滤、以及「反馈厂商 / 添加例外 / 下载 pcap」等写/导出操作
> 未实现(其 payload 为 base64 编码,待对应抓包后再扩展,避免臆造)。响应原始 HTML(含内网地址)不回传,仅返回结构化条目。

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

`query-event-list`(只读),可直接授权给 AI SOC / 工作流做告警拉取与研判。

## 验证方式

```bash
cd services
npm run validate -- --service-dir nsfocus__ids_v5-6-r10-f02
npm test -- --service-dir nsfocus__ids_v5-6-r10-f02 --coverage
npm run pack:check
```

真机验证:用一个有效会话 cookie 调 `query-event-list`,确认返回 IDS 告警事件(危险程度/动作/时间/事件编号+名称/源/目的)。
PR 附**真机验证截图**(cookie / host / 响应中的内网 IP 等敏感数据已打码)。**代码/测试/截图里不得出现真实 cookie、内网地址或业务数据。**
