# Chaitin Answer-Platform (全悉) V26.07.002 — OpenAPI / API-Token

OctoBus service package for Chaitin Answer-Platform (全悉) **V26.07.002** read APIs via
OpenAPI JSON-RPC with `API-Token` header.

与 `chaitin__answer-platform_v25-05-001`（cookie 会话，需 Login）不同，本服务针对
OpenAPI 文档（Answer-26.07.002）：**无 Login / 会话概念，每次请求都在 HTTP 头带
`API-Token`**。

## Features（16 个读接口）

| gRPC 方法 | 上游 JSON-RPC 方法 | 说明 |
|-----------|-------------------|------|
| `GetAlarm` | `AlarmService.GetAlarm` | 告警详情 |
| `GetAlarmDocument` | `AlarmService.GetAlarmDocument` | 告警原始数据 |
| `SearchAlarmCustomIntelligenceList` | `AlarmService.SearchAlarmCustomIntelligenceList` | 分页查询自定义情报 |
| `SearchAlarmCustomRuleList` | `AlarmService.SearchAlarmCustomRuleList` | 分页查询自定义规则 |
| `SearchAlarmList` | `AlarmService.SearchAlarmList` | 告警列表（时间范围 + 过滤） |
| `SearchAssetIdentify` | `AssetIdentifyApi.SearchAssetIdentify` | 资产识别列表 |
| `GetAssetInfo` | `AssetService.GetAssetInfo` | 资产详情 |
| `GetAssetList` | `AssetService.GetAssetList` | 资产列表 |
| `SearchAssetTree` | `AssetService.SearchAssetTree` | 资产树搜索 |
| `SearchGroups` | `AssetService.SearchGroups` | 资产组树 |
| `SearchTags` | `AssetService.SearchTags` | 资产标签 |
| `GetPcapDetectAlarm` | `PcapDetectService.GetAlarm` | PCAP 检测告警详情 |
| `GetPcapDetectAlarmDocument` | `PcapDetectService.GetAlarmDocument` | PCAP 检测告警原始数据 |
| `GetPcapDetectTaskList` | `PcapDetectService.GetPcapDetectTaskList` | PCAP 检测任务列表 |
| `SearchPcapDetectAlarmList` | `PcapDetectService.SearchPcapDetectAlarmList` | PCAP 检测告警列表 |
| `SearchTcpdumpProcess` | `TcpdumpService.SearchTcpdumpProcess` | 抓包任务列表 |

## Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `restBaseUrl` | string | yes | 管理平台 base URL（https），例如 `https://192.168.24.60` |
| `timeoutMs` | integer | no | HTTP 超时，默认 30000 |
| `maxResponseBytes` | integer | no | 上游响应上限，默认 4 MiB |
| `skipTlsVerify` | boolean | no | 自签证书时跳过 TLS 校验，默认 false |
| `proxy_url` / `proxyUrl` | string | no | 可选 socks5/http 代理，如 `socks5h://user:pass@host:port` |
| `headers` | object | no | 额外 HTTP 头（协议/鉴权头不可覆盖） |

## Secret

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `api_token` | string | yes | Answer-Platform API Token（个人中心 → API Token 申请） |

> `api_token` 必须配置在 instance secret，不在请求参数里。每次请求都作为
> `API-Token` 头发送。

## 请求参数说明

分页 / 时间 / 关键字等常见字段在 proto 里已显式定义（`count`/`offset`/`time_range_start`/
`time_range_end`/`keyword`/`doc_id`/`id`/`name` 等）。其余可选过滤字段统一放进
`filters`（`google.protobuf.Struct`）透传，条件过滤结构为：

```json
{"oper": "=", "target": "value"}
```

`target` 的类型随字段而定（severity/端口为整数，attacker/victim 等为字符串）。例如：

```json
{
  "time_range_start": "1750550400",
  "time_range_end": "1750723200",
  "count": "10",
  "offset": "0",
  "keyword": ["port scan"],
  "filters": {
    "severity": [{"oper": "=", "target": 1}],
    "result": [{"oper": "=", "target": "success"}]
  }
}
```

## TLS

默认校验 TLS 证书。自签 / 私有 CA 部署可设 `skipTlsVerify: true`（按请求生效，不修改
`process.env`，不影响同进程其他连接）。

## Quick Start

```bash
octobus service import answer-platform-v26 ./services/chaitin__answer-platform_v26-07-002

octobus instance create answer-platform-v26-test \
  --service answer-platform-v26 \
  --config-json '{"restBaseUrl":"https://192.168.24.60","skipTlsVerify":true}' \
  --secret-json '{"api_token":"xxx"}'

octobus capset create customer-a --name customer-a
octobus capset add-instance customer-a answer-platform-v26-test
```

Connect-RPC 调用示例：

```bash
curl -s -X POST \
  "http://octobus_addr:9000/capsets/customer-a/connect/answer-platform-v26-test/Answer_Platform_V26.Answer_Platform_V26/SearchAlarmList" \
  -H "Content-Type: application/json" \
  -d '{"time_range_start":"1750550400","time_range_end":"1750723200","count":"10","offset":"0"}'
```
