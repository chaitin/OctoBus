# tophant__xsiem

斗象科技 XSIEM 元数据融合安全管理平台 REST API v1.28 wrapper — 告警查询/详情/聚合统计/状态更新、设备与采集器管理。

## 变更记录

### v0.1.1

- 不再依赖系统 curl，改用 Node.js 原生 `http`/`https` 模块发起请求
- config 新增 `insecure` 字段（boolean），控制是否跳过 TLS 证书验证
- 自动跟随 HTTP 3xx 重定向
- 所有 HTTP 调用改为异步，利用 Node 事件循环实现可靠超时

### v0.1.0

- 初始版本，通过 curl 子进程调用 XSIEM API

## 支持版本

| 组件 | 版本 | 说明 |
|---|---|---|
| XSIEM REST API | v1.28 | `/api/xsiem` |
| SDK | `@chaitin-ai/octobus-sdk` ^0.5.0 | 运行时框架 |
| Node.js | ≥ 16 | 运行环境（v0.1.1 起降低至 16；若使用原生 fetch 推荐 ≥ 18） |

## 配置示例

### config（非敏感）

```json
{
  "xsiemHost": "https://10.192.128.117",
  "timeoutMs": 30000,
  "insecure": true
}
```

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `xsiemHost` | string | (必填) | XSIEM 服务地址，支持 `http://` / `https://` 前缀 |
| `timeoutMs` | integer | 30000 | HTTP 请求超时毫秒数 |
| `insecure` | boolean | false | 是否跳过 TLS 证书验证（自签证书环境设为 true） |
```

### secret（敏感 — 免密 token）

```json
{
  "mmToken": "f3c1922e-67e6-4d65-ac6e-9f16d128daa5"
}
```

mmToken 在 XSIEM 系统管理 → 用户管理 → 免密 token 中生成。每次请求会自动通过 `/api/platform/mmlogin` 交换 JWT。

## 方法说明

### QueryAlerts

分页查询告警列表。

| 字段 | 类型 | 说明 |
|---|---|---|
| **请求** `page` | int32 | 页码（默认 1） |
| `size` | int32 | 每页条数（必填） |
| `alarmName` | string | 告警名称（模糊匹配） |
| `status` | string | 状态：unprocessed/processed/misinformation |
| `severity` | string | 严重程度：highRisk/mediumRisk/lowRisk/info |
| `alarmTypeId` | string | 告警类型 ID |
| `startTime` | int64 | 开始时间（13 位毫秒时间戳） |
| `endTime` | int64 | 结束时间（13 位毫秒时间戳） |
| `sortField` | string | 排序字段 |
| `sortOrder` | string | 排序方式：+ 升序 / - 降序 |
| `ruleId` | string | 规则 ID |
| `ruleTag` | string | 规则标签 |
| `srcAddr` | string | 源地址 |
| `dstAddr` | string | 目标地址 |
| `filterDsl` | string | DSL 过滤条件 |
| **响应** `data` | []AlertItem | 告警列表 |

**错误码**：
- `INVALID_ARGUMENT` — 缺少必填字段（size）或参数格式错误
- `PERMISSION_DENIED` — mmToken 无效或未授权（HTTP 401/403）
- `UNAVAILABLE` — XSIEM 服务不可用（HTTP 5xx）

**请求示例**：

```http
POST /capsets/dev/connect/tophant-xsiem-test/tophant.xsiem.XsiemService/QueryAlerts
Content-Type: application/json

{"page": 1, "size": 10, "severity": "highRisk"}
```

**响应示例**：

```json
{
  "data": [
    {
      "id": "1001",
      "alarmName": "Apache Log4j RCE",
      "severity": "highRisk",
      "status": "unprocessed",
      "srcAddr": "10.0.0.1",
      "dstAddr": "192.168.1.1",
      "srcPort": "443",
      "dstPort": "8080",
      "devRecTime": "2025-06-01 10:00:00",
      "ruleName": "Log4j Exploit Detection",
      "ruleId": "rule-001",
      "alarmTypeName": ["入侵检测", "漏洞利用"],
      "attackPhase": ["初始访问", "执行"],
      "ruleTag": ["CVE-2021-44228"],
      "evtID": "evt-1001"
    }
  ]
}
```

### GetAlertDetail

根据告警 ID 查询详细告警信息。

| 字段 | 类型 | 说明 |
|---|---|---|
| **请求** `id` | string | 告警 ID（必填） |
| **响应** `id` | string | 告警 ID |
| `alarmName` | string | 告警名称 |
| `severity` | string | 严重程度 |
| `status` | string | 处理状态 |
| `srcAddr` | string | 源地址 |
| `dstAddr` | string | 目标地址 |
| `srcPort` | string | 源端口 |
| `dstPort` | string | 目标端口 |
| `devRecTime` | string | 设备接收时间 |
| `logTime` | string | 日志时间 |
| `ruleName` | string | 规则名称 |
| `ruleId` | string | 规则 ID |
| `alarmTypeName` | []string | 告警类型名称 |
| `attackPhase` | []string | 攻击阶段 |
| `ruleTag` | []string | 规则标签 |
| `evtID` | string | 事件 ID |
| `evtBeginT` | string | 事件开始时间 |
| `evtEndT` | string | 事件结束时间 |
| `triggerStatus` | string | 触发状态 |
| `rawLog` | string | 原始日志 |

**请求示例**：

```http
POST /capsets/dev/connect/tophant-xsiem-test/tophant.xsiem.XsiemService/GetAlertDetail
Content-Type: application/json

{"id": "249863197234700288"}
```

**响应示例**：

```json
{
  "id": "249863197234700288",
  "alarmName": "Apache Tomcat httpoxy 安全漏洞",
  "severity": "highRisk",
  "status": "unprocessed",
  "srcAddr": "111.197.156.184",
  "dstAddr": "99.237.1.28",
  "srcPort": "58702",
  "dstPort": "443",
  "devRecTime": "2024-11-20 11:47:08",
  "logTime": "2024-11-20 11:45:09",
  "ruleName": "基础-test-01",
  "ruleId": "249589578520731648",
  "alarmTypeName": ["信息内网安全事件", "Dynamic Resolution"],
  "attackPhase": ["横向移动,远程服务的利用", "防御绕过,颠覆信任控制,绕过 Web 标记"],
  "ruleTag": ["sysmon", "security"],
  "evtID": "1859080516012085249",
  "evtBeginT": "2024-11-20 11:45:09",
  "evtEndT": "2024-11-20 11:45:09",
  "triggerStatus": "basic",
  "rawLog": "{\"devRecTime\":\"2024-11-20 03:45:09\",\"dstAddr\":\"99.237.1.28\",\"dstPort\":443,\"srcAddr\":\"111.197.156.184\",\"srcPort\":58702}"
}
```

**告警不存在时的响应**：

```json
{"code": "invalid_argument", "message": "XSIEM client parameter error"}
```

### AlertAggCount

告警聚合总数查询。

| 字段 | 类型 | 说明 |
|---|---|---|
| **请求** `defAggType` | int32 | 聚合类型（0: 源+目标+端口+告警名, 1: 源地址, 2: 目标地址, 3: 告警名称） |
| `alarmName` | string | 告警名称筛选 |
| `status` | string | 状态筛选 |
| `severity` | string | 严重程度筛选 |
| `startTime` | int64 | 开始时间（13 位毫秒时间戳） |
| `endTime` | int64 | 结束时间（13 位毫秒时间戳） |
| `ruleId` | string | 规则 ID |
| `ruleTag` | string | 规则标签 |
| `filterDsl` | string | DSL 过滤条件 |
| **响应** `count` | int32 | 聚合告警总数 |

**请求示例**：

```http
POST /capsets/dev/connect/tophant-xsiem-test/tophant.xsiem.XsiemService/AlertAggCount
Content-Type: application/json

{"defAggType": 0, "severity": "highRisk", "startTime": 1700000000000, "endTime": 1800000000000}
```

**响应示例**：

```json
{"count": 157720}
```

### AlertAggDetail

告警聚合详情统计（通过 JSON 格式的聚合查询条件）。

| 字段 | 类型 | 说明 |
|---|---|---|
| **请求** `aggQueryJson` | string | 聚合查询条件 JSON 字符串（必填，含 groupCondition/filter/groupFields/dateRange 等字段） |
| **响应** `alarmTypeCount` | int32 | 不同告警类型数量 |
| `alarmCount` | int32 | 告警总数 |
| `attackerCount` | int32 | 攻击者数量 |
| `suffererCount` | int32 | 受害者数量 |
| `topKAlarmName` | []string | 排名靠前的告警名称 |

**请求示例**：

```http
POST /capsets/dev/connect/tophant-xsiem-test/tophant.xsiem.XsiemService/AlertAggDetail
Content-Type: application/json

{"aggQueryJson": "{\"defAggType\":0,\"dateRange\":[1700000000000,1800000000000],\"severity\":\"highRisk\",\"groupFields\":[\"srcAddr\",\"dstAddr\",\"alarmName\",\"severity\",\"status\"]}"}
```

**响应示例**：

```json
{
  "alarmTypeCount": 3,
  "alarmCount": 45,
  "attackerCount": 5,
  "suffererCount": 8,
  "topKAlarmName": ["Apache Log4j RCE", "SQL Injection Attempt", "Brute Force SSH"]
}
```

### BatchUpdateAlertStatus

批量修改告警状态。

| 字段 | 类型 | 说明 |
|---|---|---|
| **请求** `ids` | []string | 告警 ID 列表（必填，至少一个） |
| `status` | string | 新状态（必填）：processed/unprocessed/misinformation |
| **响应** `success` | bool | 操作是否成功 |

**请求示例**：

```http
POST /capsets/dev/connect/tophant-xsiem-test/tophant.xsiem.XsiemService/BatchUpdateAlertStatus
Content-Type: application/json

{"ids": ["121323123123", "213123123"], "status": "processed"}
```

**响应示例**：

```json
{"success": true}
```

### QueryDevices

分页查询设备信息。

| 字段 | 类型 | 说明 |
|---|---|---|
| **请求** `page` | int32 | 页码（默认 1） |
| `size` | int32 | 每页条数（必填） |
| **响应** `total` | int32 | 设备总数 |
| `items` | []DeviceItem | 设备列表 |

**请求示例**：

```http
POST /capsets/dev/connect/tophant-xsiem-test/tophant.xsiem.XsiemService/QueryDevices
Content-Type: application/json

{"page": 1, "size": 20}
```

**响应示例**：

```json
{
  "total": 2,
  "items": [
    {
      "id": "210040564342546432",
      "name": "银联测试CEF",
      "sourceName": "syslog",
      "flowStatus": "on",
      "port": 20001,
      "tlp": "tcp",
      "categoryBelongName": "未分组",
      "updatedTime": "2024-08-08 15:03:15"
    }
  ]
}
```

### QueryCollectors

分页查询采集器信息。

| 字段 | 类型 | 说明 |
|---|---|---|
| **请求** `page` | int32 | 页码（默认 1） |
| `size` | int32 | 每页条数（必填） |
| `name` | string | 采集器名称（可选） |
| `sourceName` | string | 采集方式（可选） |
| `flowStatus` | string | 启停状态（可选）：on/off |
| **响应** `total` | int32 | 采集器总数 |
| `items` | []CollectorItem | 采集器列表 |

**请求示例**：

```http
POST /capsets/dev/connect/tophant-xsiem-test/tophant.xsiem.XsiemService/QueryCollectors
Content-Type: application/json

{"page": 1, "size": 10, "flowStatus": "on"}
```

**响应示例**：

```json
{
  "total": 5,
  "items": [
    {
      "id": "40633704448",
      "name": "2333",
      "sourceName": "syslog",
      "flowStatus": "on",
      "port": 20001,
      "tlp": "udp",
      "connectorName": "",
      "updatedTime": "2024-03-14 10:59:25",
      "logCount": "1500",
      "failCount": "3"
    }
  ]
}
```

## 风险说明

- mmToken 为长期凭证，请妥善保管；泄露后可重新生成
- 每次 on-demand 调用需要两次 HTTP 请求（token 交换 + 业务 API），会增加延迟
- 写入操作（BatchUpdateAlertStatus）通过 XSIEM 业务审计日志追溯，OctoBus 不额外记录变更内容
- XSIEM `/alert/query` 接口返回的是数组而非分页对象，本服务已做标准化包装

## 建议 capset

```bash
# 1. 解压并安装
tar -xzf tophant-xsiem-0.1.1.tgz && cd package && npm install

# 2. 导入服务
octobus service import tophant-xsiem .

# 3. 创建实例
octobus instance create tophant-xsiem-test --service tophant-xsiem \
  --config-json '{"xsiemHost":"https://192.168.1.100:443","timeoutMs":30000,"insecure":true}' \
  --secret-json '{"mmToken":"your-mm-token-uuid"}'

# 4. 创建 capset 并关联实例
octobus capset create xsiem-ops
octobus capset add-instance xsiem-ops tophant-xsiem-test
```

## 操作说明

### 默认参数

| 参数 | 默认值 |
|---|---|
| `timeoutMs` | 30000 |

### 幂等语义

- `QueryAlerts` / `GetAlertDetail` / `AlertAggCount` / `AlertAggDetail` / `QueryDevices` / `QueryCollectors` 为**只读查询**，天然幂等
- `BatchUpdateAlertStatus` 为**置值操作**，多次相同调用结果一致（告警状态不变），属于幂等写入

### 回滚方式

- `BatchUpdateAlertStatus` 可再次调用并将 `status` 设回原值进行回滚

### 审计字段

OctoBus daemon 自动记录每次调用的 `ts`、`method`、`capset`、`instance`、`http_status`、`grpc_code`、`duration_ms`。可通过 `octobus logs --instance <id>` 查看。

XSIEM 自身通过系统管理 → 操作日志提供完整的审计追踪。

## 文件结构

```
tophant__xsiem/
├── service.json
├── config.schema.json
├── secret.schema.json
├── package.json
├── proto/xsiem.proto
├── src/service.js
├── src/tophant-xsiem.js
├── bin/tophant-xsiem.js
├── test/mock_upstream.js
├── test/tophant-xsiem.test.js
└── README.md
```
