# TianYan Analysis Platform — Complete API Reference

> **Platform**: 奇安信天眼威胁监测与分析系统（TianYan Threat Detection & Analysis Platform）  
> **Version**: 30140.sp2 / V3.0.10.0 / V4.0.10.0+  
> **Base URL**: `https://<platform-ip>:443`  
> **All paths below are relative to the base URL. The full path prefix is `/skyeye/v1` for auth endpoints; most business endpoints use paths starting directly with `/alarm/`, `/asset/`, `/analysis/`, etc.**  
> **Compiled**: 2026-06-25  
> **Total APIs documented**: ~600+ (from 26 module doc files + 1 main manual; 22 modules)

---

## Table of Contents

1. [Authentication (3-Step SSO Flow)](#authentication)
2. [告警 / 威胁感知 — Alarm & Threat Detection](#1-告警--威胁感知)
3. [响应处置 / 封禁 — Response & Blocking](#2-响应处置--封禁)
4. [行为分析 — Behavior Analysis](#3-行为分析)
5. [日志检索 — Log Search](#4-日志检索)
6. [全包取证 — PCAP Forensics](#5-全包取证)
7. [威胁狩猎 — Threat Hunting](#6-威胁狩猎)
8. [资产感知 — Asset Management](#7-资产感知)
9. [系统管理 — System Management](#8-系统管理)
10. [报表报告 — Reports](#9-报表报告)
11. [大屏 / 仪表板 — Dashboards & Screens](#10-大屏--仪表板)
12. [API安全 — API Security Module](#11-api安全)
13. [云原生 — Cloud Native](#12-云原生)
14. [扩展程序 / 安全服务 — Plugins & Security Services](#13-扩展程序--安全服务)
15. [GPT 智能助手 — AI Assistant](#14-gpt-智能助手)
16. [消息中心 — Message Center](#15-消息中心)
17. [多源数据治理 — Data Governance](#16-多源数据治理)
18. [全局公共 — Global / Auth APIs](#17-全局公共)
19. [攻击源IP预警 — Attack Source IP Alert](#18-攻击源ip预警)
20. [监测工作台 — Monitoring Workbench](#19-监测工作台)
21. [威胁感知扩展 — Threat Detection Extended](#20-威胁感知--扩展接口)
22. [响应处置工作流 — SOAR Workflow & Orchestration](#21-响应处置--工作流--编排)
23. [重保 — HW Attack Protection Mode](#22-重保-hw-attack-protection-mode)
24. [Common Response Structure](#common-response-structure)

---

## Authentication

### Overview — 3-Step SSO (Password-Free) Flow

TianYan uses a token-based single-sign-on mechanism for third-party API access. The flow has **4 stages**:

```
Stage 1: Derive client_id / client_secret from login_key (local computation)
Stage 2: POST /skyeye/v1/admin/auth  →  obtain access_token
Stage 3: GET  /skyeye/v1/admin/auth?token=<access_token>  →  obtain csrf_token + session cookies
Stage 4: All subsequent business API calls carry csrf_token (query param) + cookies (header)
```

### Stage 1 — Key Derivation (Client-Side Computation)

Obtain `login_key` from: **系统管理 → 账号管理 → 本地账号管理 → 免密LOGIN密钥**

```python
import hashlib

CLIENT_ID_SEED   = "mNSLP9UJCtBHtegjDPJnK3v"
CLIENT_SEC_SEED  = "3460681205014671737"

client_id     = hashlib.sha256((CLIENT_ID_SEED  + "|" + login_key).encode()).hexdigest()
client_secret = hashlib.sha256((CLIENT_SEC_SEED + "|" + login_key).encode()).hexdigest()

# X-Authorization signature
import time, json
timestamp = str(int(time.time()))
raw = json.dumps({"client_id": client_id, "username": "tapadmin"}, separators=(',',': ')) \
      + timestamp + client_secret
x_authorization = hashlib.sha256(raw.encode()).hexdigest()
```

> **Note (Java)**: Use `DigestUtil.sha256Hex()` from hutool. JSON key order must be `client_id` then `username`.  
> **Note**: Platform time and client time must not differ by more than 10 minutes.

### Stage 2 — Obtain access_token

```
POST /skyeye/v1/admin/auth
Content-Type: application/x-www-form-urlencoded

Headers:
  X-Authorization: <x_authorization>
  X-Timestamp:     <10-digit unix timestamp>

Body (form):
  client_id = <derived above>
  username  = tapadmin
```

**Response**:
```json
{
  "access_token": "574reuhta08503asdas5137d7eb4685c25e5f4fuyt",
  "status": 200
}
```

### Stage 3 — Cookie + csrf_token Exchange

```
GET /skyeye/v1/admin/auth?token=<access_token>
```

Response is an **HTML page**. Extract from the HTML:
- `csrf_token` — from `<meta name="csrf-token" content="<TOKEN>">` (regex: `[0-9a-fA-F]{16,32}`)
- `cookies` — from the response `Set-Cookie` headers (session cookies)

### Stage 4 — Business API Requests

All business API requests must include:
- Query parameter: `csrf_token=<csrf_token>`
- Request header: `Cookie: <session_cookies>`
- Optional query parameter: `r=<random_float>` (cache-busting)

> **IP parameter compression**: IP filter parameters (`alarm_sip`, `attack_sip`, etc.) must be gzip-compressed then base64-encoded:
> ```python
> import gzip, io, base64
> def encode_ip(ip_str):
>     buf = io.BytesIO()
>     with gzip.GzipFile(fileobj=buf, mode='w') as f:
>         f.write(ip_str.encode())
>     return base64.b64encode(buf.getvalue()).decode()
> ```

---

## 1. 告警 / 威胁感知

> Base paths: `/alarm/alarm/...`, `/skyeye/v1/alarm/alarm/...`

### 1.1 Core Alarm APIs

| Method | Path | Description | Required Params | Notes |
|--------|------|-------------|-----------------|-------|
| `GET` [AGENT] | `/skyeye/v1/alarm/alarm/list` | **告警列表查询** — Query alarm events | `start_time`, `end_time`, `offset`, `limit`, `csrf_token` | Primary agent entry point; IP params must be gzip+b64 encoded |
| `GET` | `/alarm/alarm/list` | 告警列表查询 (alternative path) | Same as above | Used internally |
| `POST` | `/alarm/alarm/export` | 创建告警导出任务 | `start_time`, `end_time`, `task_type` | Returns `task_id` for async poll |
| `GET` | `/alarm/alarm/export` | 查询导出任务状态 | `task_id` | Poll until complete |
| `GET` [AGENT] | `/skyeye/v1/alarm/alarm/pie` | 告警统计饼图 | `name`, `start_time`, `end_time`, `interval_time` | Used in dashboard overview |
| `GET` | `/alarm/alarm/info/uploadfile/download` | **下载可疑文件** | `alarm_id`, `alarm_sip`, `attack_sip`, `skyeye_type`, `ioc`, `start_time`, `end_time`, `host_state`, `sip_ioc_dip`, `branch_id` | Returns binary file stream |
| `GET` | `/alarm/alarm/info/pcap/download` | **下载PCAP包** | `alarm_sip`, `attack_sip`, `skyeye_type`, `ioc`, `start_time`, `end_time`, `type`, `branch_id`, `alarm_id`, `xff`, `host_state` | Returns binary stream |

#### GET /skyeye/v1/alarm/alarm/list — Full Parameter Reference

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `start_time` | number | Yes | Start time — 13-digit timestamp (ms) |
| `end_time` | number | Yes | End time — 13-digit timestamp (ms) |
| `offset` | int | Yes | Page offset, starts from 1 |
| `limit` | int | Yes | Page size |
| `csrf_token` | string | Yes | CSRF token from auth flow |
| `threat_type` | string | No | Alarm type |
| `hazard_level` | int | No | Threat level: `0`=低危 `1`=中危 `2`=高危 `3`=危急 |
| `host_state` | string | No | Attack result: `-1`=失败 `0`=企图 `1`=成功 `2`=失陷 |
| `status` | string | No | Disposition: `0`=未处置 `1`=已处置 `6`=忽略 `7`=误报 |
| `data_source` | string | No | Source: `0`=全部 `1`=传感器 `2`=沙箱 |
| `alarm_sip` | string | No | Victim IP (gzip+b64 encoded) |
| `attack_sip` | string | No | Attacker IP (gzip+b64 encoded) |
| `ioc` | string | No | Threat intelligence IOC |
| `threat_name` | string | No | Threat name |
| `attack_stage` | string | No | Attack stage |
| `attack_dimension` | string | No | `0`=其他 `1`=横向 `2`=外部攻击 `3`=外联 |
| `serial_num` | string | No | Sensor serial number |
| `branch_id` | string | No | Cascade unit ID |
| `alarm_id` | string | No | Unique alarm ID |
| `focus_label` | string | No | Focus label |
| `file_md5` | string | No | File MD5 |
| `is_white` | int | No | Whitelist filter: `0`=非白 `1`=白名单 |
| `asset_group` | string | No | Asset group |
| `order_by` | string | No | Sort field, e.g. `access_time:desc` |
| `uuid` | string | No | UUID value |
| `confidence` | string | No | Confidence: `0`=低 `1`=中 `2`=高 |
| `user_label` | string | No | Read status: `0`=未读 `1`=已读 |
| `marks` | string | No | Alarm tags |
| `is_alarm_list` | string | No | Set `1` when calling from alarm list page |

**Response key fields**:

| Field | Type | Description |
|-------|------|-------------|
| `data.items[].id` | string | Alarm unique ID |
| `data.items[].access_time` | number | Latest occurrence time (13-digit ms) |
| `data.items[].earliest_time` | number | First occurrence time |
| `data.items[].alarm_sip` | string | Victim IP |
| `data.items[].attack_sip` | string | Attacker IP |
| `data.items[].threat_name` | string | Threat name |
| `data.items[].hazard_level` | string | Threat level (text) |
| `data.items[].host_state` | string | Attack result (text) |
| `data.items[].status` | string | Disposition status (text) |
| `data.items[].repeat_count` | number | Alarm occurrence count |
| `data.items[].type_chain` | string | Alarm type chain code |
| `data.items[].name_type_chain` | string | Full alarm type (display) |
| `data.items[].super_type` | string | Level-1 alarm category |
| `data.items[].type` | string | Level-2 alarm category |
| `data.items[].ioc` | string | IOC / rule ID+name |
| `data.items[].rule_id` | string | Rule ID |
| `data.items[].serial_num` | string | Sensor serial number |
| `data.items[].branch_id` | string | Cascade unit |
| `data.items[].sip_ioc_dip` | string | Sensor merge ID (needed for file/pcap download) |
| `data.items[].skyeye_type` | string | Raw alarm log type / rule name |
| `data.items[].skyeye_id` | string | Raw alarm log ID |
| `data.items[].skyeye_index` | string | Raw alarm log index |
| `data.items[].attack_stage` | string | Attack stage |
| `data.items[].attack_dimension` | string | Attack dimension |
| `data.items[].proto` | string | Protocol |
| `data.items[].dip` | string | Destination IP |
| `data.items[].dport` | string/number | Destination port |
| `data.items[].sip` | string | Source IP |
| `data.items[].sport` | string/number | Source port |
| `data.items[].uri` | string | URI |
| `data.items[].host` | string | Domain |
| `data.items[].x_forwarded_for` | string | XFF proxy chain |
| `data.items[].white_id` | string | Whitelist ID |
| `data.items[].asset_name` | string | Asset name |
| `data.items[].asset_group` | string | Asset group |
| `data.items[].staffname` | string | Responsible person |
| `data.items[].attck` | string | ATT&CK technique |
| `data.items[].attck_tactic` | string | ATT&CK tactic |
| `data.total` | number | Total record count |
| `data.status` | int | `1000` = success |
| `data.token` | string | Refreshed csrf_token |

### 1.2 Alarm Update / Disposition [AGENT]

| Method | Path | Description | Required Params | Notes |
|--------|------|-------------|-----------------|-------|
| `PUT` [AGENT] | `/alarm/alarm/list` | **更新告警处置状态** | `ids`, `status` | `status`: `0`未处置 `1`已处置 `6`忽略 `7`误报 |
| `POST` | `/alarm/alarm/list` | 批量操作告警 | `ids`, `action` | Batch mark/flag |
| `DELETE` | `/alarm/alarm/list` | 删除告警记录 | `ids` | Permanent delete |

### 1.3 Resource Asset Alarm Query [AGENT]

| Method | Path | Description | Required Params | Notes |
|--------|------|-------------|-----------------|-------|
| `GET` [AGENT] | `/asset/asset/manage/alarm-list` | 资产告警列表查询 | `ip` or `serial_number`, `offset`, `limit` | Query alarms for a specific asset IP |

**Response key fields**: `data.data[].alarm_sip`, `.attack_sip`, `.type_chain`, `.hazard_level`, `.host_state`, `.id`, `.repeat_count`, `.status`, `.super_attack_chain`, `.access_time`, `data.total`

### 1.4 Cloud-Native Asset Perspective Alarms

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/alarm/cloud-asset-perspective/list` | 云原生资产视角告警列表 | `start_time`, `end_time`, `limit`, `offset` |
| `GET` | `/alarm/cloud-asset-perspective/top` | Top5 statistics | `start_time`, `end_time` |
| `GET` | `/alarm/cloud-asset-perspective/pie` | Threat category pie chart | `start_time`, `end_time` |
| `GET` | `/alarm/cloud-asset-perspective/count` | Total alarm count | `start_time`, `end_time` |
| `GET` | `/alarm/cloud-asset-perspective/trend` | Alarm trend chart | `start_time`, `end_time` |
| `GET` | `/alarm/cloud-asset-perspective/bar` | Category breakdown bar chart | `start_time`, `end_time` |
| `GET` | `/alarm/cloud-asset-perspective-detail/info` | 基本信息 | `uuid` |
| `GET` | `/alarm/cloud-asset-perspective-detail/history_bar` | 历史变更柱状图 | `uuid`, `start_time`, `end_time` |
| `GET` | `/alarm/cloud-asset-perspective-detail/distribute` | 威胁名称统计 | `uuid`, `start_time`, `end_time` |
| `GET` | `/alarm/cloud-asset-perspective-detail/trend` | 威胁趋势图 | `uuid`, `start_time`, `end_time` |
| `GET` | `/alarm/cloud-asset-perspective-detail/history_list` | 历史变更列表 | `uuid`, `start_time`, `end_time`, `offset`, `limit` |

### 1.5 API Security Alarms

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/alarm/api-alarm/details/sensitive` | 获取告警详情中高亮敏感信息 | `id`, `start_time`, `end_time` |

---

## 2. 响应处置 / 封禁

> Base paths: `/system/rule_cfg/...`, `/skyeye/v1/system/config/...`

### 2.1 IP Blocking / Whitelist Management [AGENT]

| Method | Path | Description | Required Params | Notes |
|--------|------|-------------|-----------------|-------|
| `GET` [AGENT] | `/system/rule_cfg/white_list_action` | **获取白名单列表** | `source` (required) | Query existing whitelists |
| `PUT` [AGENT] | `/system/rule_cfg/white_list_action` | **启用/禁用白名单条目** | `id`, `status` | `status`: `0`=禁用 `1`=启用 |
| `DELETE` [AGENT] | `/system/rule_cfg/white_list_action` | **批量删除白名单** | `id` (comma-separated) | |
| `GET` | `/system/rule_cfg/white_list_template` | 下载白名单样例文件 | — | Returns xlsx template |
| `POST` | `/system/rule_cfg/white_list_loadin` | 批量导入白名单（xlsx） | `fq`(file), `start_time`, `end_time`, `source` | |

**GET `/system/rule_cfg/white_list_action` — Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source` | int | Yes | Whitelist source type |
| `value` | string | No | Filter value |
| `start_time` | int | No | Start time |
| `end_time` | int | No | End time |
| `limit` | int | No | Page size |
| `offset` | int | No | Page offset |
| `remark` | string | No | Remark filter |
| `status_str` | string | No | Status filter |
| `order` | string | No | Sort order |
| `from_source` | string | No | Filter by source |

### 2.2 Flow Sensor Whitelist [AGENT]

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `POST` [AGENT] | `/system/rule_cfg/white_list_flow` | **新增流量传感器白名单** | At least one of: `alarm_sips`, `attack_sips`, `ioc`, `threat_name`, `type_chain` |
| `PUT` [AGENT] | `/system/rule_cfg/white_list_flow` | **编辑流量传感器白名单** | `id` + fields to update |

**POST `/system/rule_cfg/white_list_flow` — Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `alarm_sips` | string | Victim IPs (comma-separated) |
| `attack_sips` | string | Attacker IPs (comma-separated) |
| `ioc` | string | IOC value |
| `threat_name` | string | Threat name |
| `x_forwarded_for` | string | XFF proxy |
| `uri` | string | URI pattern |
| `is_encrypt` | int | Encrypted traffic flag |
| `end_time` | int | Expiry time (timestamp) |
| `start_time` | int | Start time (timestamp) |
| `type_chain` | string | Alarm type chain |

### 2.3 File Threat Whitelist

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `POST` | `/system/rule_cfg/white_list_file` | 新增文件威胁鉴定白名单 | `file_md5`, `start_time`, `end_time` |
| `PUT` | `/system/rule_cfg/white_list_file` | 编辑文件威胁鉴定白名单 | `id`, `file_md5`, `start_time`, `end_time` |

### 2.4 Mail Threat Whitelist

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `POST` | `/system/rule_cfg/white_list_mail` | 新增邮件威胁检测白名单 | `sender` |
| `PUT` | `/system/rule_cfg/white_list_mail` | 编辑邮件威胁检测白名单 | `id`, `sender`, `start_time`, `end_time` |

### 2.5 Server Security Whitelist (网神云锁)

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `POST` | `/system/rule_cfg/white_list_wangshen` | 新增告警白名单 | `alarm_sips` |
| `PUT` | `/system/rule_cfg/white_list_wangshen` | 编辑白名单 | `id`, `alarm_sips`, `start_time`, `end_time` |

### 2.6 Custom Rule / Special Field Configuration

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/system/rule_cfg/customize_alarm_rule/action` | 获取特殊规则配置字段 | — |
| `PUT` | `/system/rule_cfg/customize_alarm_rule/action` | 修改特殊规则配置字段 | `xff_field`, `position`, `status`, `id`, `device` |
| `DELETE` | `/system/rule_cfg/customize_alarm_rule/action` | 删除配置项 | `id` |
| `POST` | `/system/rule_cfg/customize_alarm_rule/action_delivery` | 特殊规则下发到传感器 | `rule_ids`, `device_ids` |
| `POST` | `/system/rule_cfg/customize_alarm_rule/action_priority` | 更新优先级 | `priority_list` |
| `POST` | `/system/rule_cfg/customize_alarm_rule/proxy_ip/action_delivery` | 代理IP下发 | `rule_ids`, `device_ids` |
| `POST` | `/skyeye/v1/system/rule_cfg/customize_alarm_rule/proxy_ip_export` | 批量新增代理IP（文件） | `fp`(file) |
| `GET` | `/skyeye/v1/system/rule_cfg/customize_alarm_rule/proxy_ip_export` | 下载代理IP导入模板 | — |

### 2.7 Custom Rules Manager

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/skyeye/v1/system/config/custom-rules/manager` | 查询自定义规则列表 | `offset`, `limit` |
| `POST` | `/skyeye/v1/system/config/custom-rules/manager` | 新增自定义规则 | `rule_name`, `rule_type`, `level` |
| `PUT` | `/skyeye/v1/system/config/custom-rules/manager` | 编辑自定义规则 | `rid`, `rule_name`, `rule_type`, `level`, `attack_res` |

### 2.8 API Security — Blocklist / Strategy

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/system/rule_cfg/api_threat` | 获取风险检测控制开关 | — |
| `PUT` | `/system/rule_cfg/api_threat` | 更新风险检测开关 | `ids`, `is_enable` (`0`=关/`1`=开) |
| `PUT` | `/system/rule_cfg/api_detect_state` | 更改风险检测总开关 | `switch_state` (`0`/`1`) |
| `GET` | `/system/rule_cfg/api_detect_state` | 获取总开关状态 | — |
| `POST` | `/system/rule_cfg/in_exclude_rule` | 新增API排除/保留名单 | `in_exclude_list`, `code`, `payload`, `position`, `field`, `value`, `is_delay` |
| `PUT` | `/system/rule_cfg/in_exclude_rule` | 更新名单及开关 | `ids`, `in_exclude_list` |
| `GET` | `/system/rule_cfg/in_exclude_rule` | 查询名单列表 | — |
| `DELETE` | `/system/rule_cfg/in_exclude_rule` | 删除名单 | `ids`, `in_exclude_list` |
| `POST` | `/system/rule_cfg/in_exclude_list_loadin` | 导入名单（文件） | `in_exclude_list`, `file` |
| `GET` | `/system/rule_cfg/in_excludelist_template` | 下载黑白名单模板 | — |
| `POST` | `/system/rule_cfg/bwlisttoslave` | 一键下发名单到从节点 | — |
| `GET` | `/system/rule_cfg/api_strategy/desc` | 获取聚合策略左侧配置 | — |
| `POST` | `/system/rule_cfg/APIStrategy_loadin` | 导入API聚合策略 | `file` |
| `GET` | `/system/rule_cfg/APIStrategy_loadin` | 下载聚合策略模板 | — |
| `DELETE` | `/system/rule_cfg/api_strategy/agg` | 删除聚合策略 | `ids` |
| `POST` | `/system/rule_cfg/api_strategy/agg` | 新增聚合策略 | `name`, `host`, `path`, `position`, `before_change`, `after_change`, `is_enable` |
| `PUT` | `/system/rule_cfg/api_strategy/agg` | 更新聚合策略 | `ids` + fields |

---

## 3. 行为分析

> Base path: `/analysis/behavior/...`

### 3.1 Web Behavior — Suspicious Crawler / Scanner

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/analysis/behavior/web/unnormal-web-request-times/info/bar` | 可疑爬虫访问次数柱状图 | `start_time`, `end_time`, `sip`, `dip`, `domain`, `s_group`, `d_group` |
| `GET` | `/analysis/behavior/web/unnormal-web-request-times/white-list` | 获取白名单列表 | `offset`, `limit` |
| `POST` | `/analysis/behavior/web/unnormal-web-request-times/white-list` | 新增白名单条目 | `sip` |
| `PUT` | `/analysis/behavior/web/unnormal-web-request-times/white-list` | 编辑白名单条目 | `sip`, `id` |
| `POST` | `/analysis/behavior/web/unnormal-web-request-times/white-list/batch-delete` | 批量删除白名单 | `ids` |
| `POST` | `/analysis/behavior/web/unnormal-web-request-times/request-frequency` | 保存访问频率阈值配置 | `time_range`, `access_times` |
| `GET` | `/analysis/behavior/web/unnormal-web-request-times/request-frequency` | 获取访问频率阈值配置 | — |

### 3.2 Web Behavior — Backdoor Upload

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/analysis/behavior/web/backdoor-upload/list` | 后门上传利用列表 | `start_time`, `end_time`, `offset`, `limit` |

### 3.3 Web Behavior — Uncommon HTTP Methods

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/analysis/behavior/web/uncommon-request-method/request-methods` | 获取非常用HTTP方法枚举 | — |
| `GET` | `/analysis/behavior/web/uncommon-request-method/list` | 非常用请求方法列表 | `start_time`, `end_time`, `offset`, `limit` |
| `GET` | `/analysis/behavior/web/uncommon-request-method/info` | 非常用请求方法详情 | `start_time`, `end_time`, `sip`, `dip`, `s_group_id`, `d_group_id`, `visit_link`, `request_method`, `status_code`, `domain`, `offset`, `limit` |
| `GET` | `/analysis/behavior/web/uncommon-request-method/info/bar` | 趋势柱状图 | `start_time`, `end_time`, `sip`, `dip`, `s_group_id`, `d_group_id` |

### 3.4 Access Behavior — Internal Host External Connection

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` [AGENT] | `/analysis/behavior/access/internal-access-external/map` | 内部主机外联地理分布地图 | `start_time`, `end_time` |
| `GET` [AGENT] | `/analysis/behavior/access/internal-access-external/list` | 内部主机外联列表 | `start_time`, `end_time`, `country_code`, `offset`, `limit` |
| `GET` | `/analysis/behavior/access/internal-access-external/top` | 外联IP访问量Top排行 | `start_time`, `end_time` |
| `GET` | `/analysis/behavior/access/internal-access-external/white-list` | 获取白名单 | `offset`, `limit` |
| `POST` | `/analysis/behavior/access/internal-access-external/white-list` | 新增白名单 | `sip_cfg`, `dip_cfg` |
| `PUT` | `/analysis/behavior/access/internal-access-external/white-list` | 编辑白名单 | `sip_cfg`, `dip_cfg`, `id` |
| `POST` | `/analysis/behavior/access/internal-access-external/white-list/batch-delete` | 批量删除白名单 | `ids` |

### 3.5 Access Behavior — External Access

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/analysis/behavior/access/external-access/map` | 外部访问分布地图 | `start_time`, `end_time` |
| `GET` | `/analysis/behavior/access/external-access/list` | 外部访问列表 | `start_time`, `end_time`, `offset`, `limit` |
| `GET` | `/analysis/behavior/access/external-access/top` | 资产IP被访次数Top | `start_time`, `end_time` |
| `GET` | `/analysis/behavior/access/external-access/white-list` | 获取白名单 | `offset`, `limit` |
| `POST` | `/analysis/behavior/access/external-access/white-list` | 新增白名单 | `sip_cfg`, `dip_cfg` |
| `PUT` | `/analysis/behavior/access/external-access/white-list` | 修改白名单 | `sip_cfg`, `dip_cfg`, `id` |
| `POST` | `/analysis/behavior/access/external-access/white-list/batch-delete` | 批量删除白名单 | `ids` |

### 3.6 Access Behavior — Lateral Movement (横向访问)

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/analysis/behavior/access/horizontal-access/list` | 横向访问列表 | `start_time`, `end_time`, `offset`, `limit` |
| `GET` | `/analysis/behavior/access/horizontal-access/src-assets-top` | 源资产IP Top | `start_time`, `end_time` |
| `GET` | `/analysis/behavior/access/horizontal-access/dest-assets-top` | 目的资产IP Top | `start_time`, `end_time` |
| `GET` | `/analysis/behavior/access/horizontal-access/white-list` | 获取横向访问白名单 | `offset`, `limit` |
| `POST` | `/analysis/behavior/access/horizontal-access/white-list` | 新增白名单 | `sip_cfg`, `dip_cfg` |
| `PUT` | `/analysis/behavior/access/horizontal-access/white-list` | 编辑白名单 | `sip_cfg`, `dip_cfg`, `id` |
| `POST` | `/analysis/behavior/access/horizontal-access/white-list/batch-delete` | 批量删除白名单 | `ids` |

### 3.7 Access Behavior — Risk Port Access

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/analysis/behavior/access/danger-port-access/list` | 风险端口访问列表 | `start_time`, `end_time`, `offset`, `limit` |
| `GET` | `/analysis/behavior/access/danger-port-access/ports` | 风险端口枚举 | — |
| `GET` | `/analysis/behavior/access/danger-port-access/trend` | 访问趋势图 | `start_time`, `end_time` |
| `GET` | `/analysis/behavior/access/danger-port-access/white-list` | 获取白名单 | `offset`, `limit` |
| `POST` | `/analysis/behavior/access/danger-port-access/white-list/` | 新增白名单 | `sip_cfg`, `dip_cfg`, `port` |
| `PUT` | `/analysis/behavior/access/danger-port-access/white-list` | 编辑白名单 | `id`, `sip_cfg`, `dip_cfg`, `port` |
| `POST` | `/analysis/behavior/access/danger-port-access/white-list/batch-delete` | 批量删除白名单 | `ids` |

### 3.8 Access Behavior — Suspicious Referrer

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/analysis/behavior/access/refer/list` | 可疑来源列表 |
| `GET` | `/analysis/behavior/access/refer/distribute` | 可疑来源地理分布 |
| `GET` | `/analysis/behavior/access/refer/trend` | 可疑来源访问趋势 |
| `GET` | `/analysis/behavior/access/refer/config` | 获取规则配置 |
| `PUT` | `/analysis/behavior/access/refer/config` | 编辑规则配置 |
| `POST` | `/analysis/behavior/access/refer/config/batch-delete` | 批量删除规则配置 |
| `POST` | `/analysis/behavior/access/refer/config/batch-use` | 批量启用/禁用规则 |
| `POST` | `/alarm/alarm/export` | 导出可疑来源数据 |

### 3.9 Black IP Upload

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `POST` | `/system/config/black-ip-upload` | 离线上传黑IP列表 | `fp`(file .txt, one IP per line), `file_name` |

---

## 4. 日志检索

> Base path: `/analysis/log-search/...`

| Method | Path | Description | Required Params | Notes |
|--------|------|-------------|-----------------|-------|
| `GET` [AGENT] | `/analysis/log-search/list` | **获取日志列表（核心检索接口）** | `branch_id`, `start_time`, `end_time`, `index`, `category`, `offset`, `limit`, `mode` | `keyword`=SPL; `mode`=search mode |
| `GET` [AGENT] | `/analysis/log-search/spl-search` | SPL专家模式日志检索 | `category`, `index`, `start_time`, `end_time`, `branch_id` | Returns structured results with field list |
| `GET` | `/analysis/log-search/spl-commands` | 获取SPL支持命令列表 | — | Returns array of command names |
| `GET` | `/analysis/log-search/facets` | 日志时间趋势（分片统计） | `branch_id`, `start_time`, `end_time`, `index`, `category`, `interval`, `mode`, `offset`, `limit` | |
| `GET` | `/analysis/log-search/hits` | 获取命中日志类型 | `branch_id`, `start_time`, `end_time`, `index`, `category`, `mode`, `offset`, `limit` | |
| `GET` | `/analysis/log-search/types` | 获取日志类型字典及字段映射 | — | Returns `data_type` + `ch_map` (field Chinese name map) |
| `GET` | `/analysis/log-search/rank` | 字段值占比排序统计 | `field`, `branch_id`, `start_time`, `end_time`, `index`, `category`, `offset`, `limit`, `interval` | |
| `GET` | `/analysis/log-search/history` | 获取搜索历史记录 | `offset`, `limit` | |
| `POST` | `/analysis/log-search/history` | 写入搜索历史 | `branch_id`, `category`, `start_time`, `index`, `mode`, `end_time`, `asset_group_ids`, `offset`, `limit` | |
| `GET` | `/analysis/log-search/rule-collection` | 获取收藏规则列表 | `offset`, `limit` | |
| `POST` | `/analysis/log-search/rule-collection` | 新增收藏规则 | `branch_id`, `start_time`, `end_time`, `index`, `category`, `interval`, `mode`, `rule_name` | |
| `PUT` | `/analysis/log-search/rule-collection` | 更新收藏规则 | `branch_id`, `index`, `category`, `mode`, `rule_name`, `sid` | |
| `DELETE` | `/analysis/log-search/rule-collection` | 删除收藏规则 | `sid` | |
| `POST` | `/analysis/log-search/rules` | 写入默认收藏规则 | — | Initialize defaults |
| `GET` | `/analysis/log-search/log-create-status` | 查询日志导出任务状态 | `task_id` | `data`: `1`=进行中 `2`=完成 |
| `GET` | `/analysis/log-search/log-create` | 创建日志导出任务 | `branch_id`, `start_time`, `end_time`, `index`, `category`, `filetype`, `task_id` | `filetype`=json/xlsx |
| `GET` | `/analysis/log-search/get-ptree` | 获取进程树信息 | `sip`, `dip`, `proto`, `start_time`, `end_time`, `index` | |
| `GET` | `/analysis/log-search/lock-fields` | 获取锁定字段列表 | `index` | |
| `POST` | `/analysis/log-search/lock-fields` | 新增/修改锁定字段 | `index`, `locked`, `fields` | |
| `GET` | `/analysis/log-search/field-status` | 索引字段状态 | `index_type`, `offset`, `limit` | |
| `PUT` | `/analysis/log-search/field-switch` | 修改字段索引/排序开关 | `index_type`, `opt` | `opt`:`1`=开 `0`=关 |
| `GET` | `/analysis/log-search/asset_group` | 获取资产组树 | — | |
| `GET` | `/analysis/log-search/ti_search` | 威胁情报查询跳转URL | — | Returns external TI platform URL |
| `GET` | `/analysis/log-search/spl_custom_view` | 获取自定义视图列表 | `limit`, `offset` | |
| `POST` | `/analysis/log-search/spl_custom_view` | 保存SPL自定义视图 | `config`, `inherit`, `name` | Returns `data.id` |
| `DELETE` | `/analysis/log-search/spl_custom_view` | 删除自定义视图 | `view_id` | |
| `GET` | `/analysis/log-search/data-desensitize/export-config` | 获取数据脱敏规则列表 | `limit`, `offset` | |
| `POST` | `/analysis/log-search/data-desensitize/export-config` | 新增脱敏规则 | `reg_exp`, `remark` | |
| `PUT` | `/analysis/log-search/data-desensitize/export-config` | 批量更新脱敏规则 | `ids` | |
| `DELETE` | `/analysis/log-search/data-desensitize/export-config` | 批量删除脱敏规则 | `ids` | |

**GET `/analysis/log-search/list` — Key Response Fields**:
- `data.data.search.hits[].\_source` — raw log record
- `data.data.search.total` — total count
- `data.data.fields` — available field list
- `data.data.meta` — field type metadata

**GET `/analysis/log-search/spl-search` — Key Response Fields**:
- `data.data.fields` — field list
- `data.data.results` — query result rows
- `data.data.meta` — field type info

---

## 5. 全包取证

> Base path: `/analysis/pcap-analysis/...`

| Method | Path | Description | Required Params | Notes |
|--------|------|-------------|-----------------|-------|
| `GET` | `/analysis/pcap-analysis/pcap/search` | PCAP流量趋势（查询可用pcap文件） | `mode`(=`fast_model`), `start_time`, `end_time` | Returns file_name list per time bucket |
| `GET` | `/analysis/pcap-analysis/pcap/packet-list` | PCAP会话列表 | `pcap_name`, `limit`, `offset`, `start_time`, `end_time`, `mode` | `filter`=T-Shark filter |
| `GET` | `/analysis/pcap-analysis/pcap/packet/detail` | 会话协议树详情（含hex data） | `packet_no`, `start_time`, `end_time`, `mode`, `pcap_name` | |
| `POST` | `/analysis/pcap-analysis/pcap/create_task` | 创建PCAP异步下载任务 | `names`, `start_time`, `end_time`, `mode`(=`fast_model`) | Returns `task_id` |
| `GET` | `/analysis/pcap-analysis/pcap/task_status` | 查询PCAP下载任务状态 | `task_id` | `task_status`: `0`进行中 `1`完成 `10`失败 |
| `GET` | `/analysis/pcap-analysis/pcap/download` | 直接下载PCAP文件 | `file_path` | Returns binary stream |
| `GET` | `/analysis/pcap-analysis/search-history` | 获取取证查询历史 | `history_type`(`pcap_trend`/`packet_list`) | |
| `POST` | `/analysis/pcap-analysis/search-history` | 保存查询历史 | `history_type`, `history_detail`, `branch_id` | |

---

## 6. 威胁狩猎

> Base path: `/analysis/hunt/...`, `/analysis/hunting/...`

| Method | Path | Description | Required Params | Notes |
|--------|------|-------------|-----------------|-------|
| `GET` [AGENT] | `/analysis/hunting/get-ip` | 狩猎IP查询（输入联想） | `start_time`, `end_time` | Returns IP string array |
| `GET` [AGENT] | `/analysis/hunt/search` | **构建威胁狩猎关联图** | `kwd`, `start_time`, `end_time` | Returns nodes + links graph |
| `GET` [AGENT] | `/analysis/hunt/extend-nodes` | 扩展关联图节点 | `node_value`, `node_type`, `query_type`, `start_time`, `end_time`, `is_fuzzy` | `query_type`: ip/host/uri/md5/mail |
| `GET` | `/analysis/hunt/node_detail` | 获取节点详细信息 | `node_value`, `node_type`, `start_time`, `end_time` | |
| `GET` | `/analysis/hunt/investigation/attack_list` | 调查分析-攻击列表 | `start_time`, `end_time`, `kwd` | |
| `POST` | `/analysis/hunt/investigation/attack_node` | 调查分析-新增攻击节点 | `access_time`, `attack_phase_name`, `attack_ip`, `alarm_sip` | |
| `GET` | `/analysis/hunt/investigation/attack_record` | 调查分析-攻击阶段趋势图 | `start_time`, `end_time`, `interval`, `kwd` | |
| `GET` | `/analysis/hunt/investigation/result` | 调查分析-综合调查结果 | `start_time`, `end_time`, `kwd` | |
| `GET` | `/analysis/hunt/investigation/object` | 调查分析-调查对象详情 | `start_time`, `end_time` | Supports IP/domain/URI/MD5/mail |
| `GET` [AGENT] | `/analysis/hunting/stuck_host/status` | **失陷主机状态** | `start_time`, `end_time`, `asset_ip` | Returns alarm_count, risk_value, ioc_count |
| `GET` [AGENT] | `/analysis/hunting/stuck_host/count` | **失陷主机统计** | `start_time`, `end_time`, `asset_ip` | Returns detailed security stats |

---

## 7. 资产感知

> Base paths: `/asset/asset/manage/...`, `/asset/vul/...`, `/asset/cfg-check/...`

### 7.1 Asset Management [AGENT]

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` [AGENT] | `/asset/asset/manage/info` | **资产列表查询（多条件分页）** | `offset`, `limit` |
| `POST` | `/asset/asset/manage/info` | 新增资产 | — (all optional) |
| `PUT` | `/asset/asset/manage/info` | 更新资产 | `id` |
| `DELETE` | `/asset/asset/manage/info` | 删除资产 | `ids` |
| `GET` [AGENT] | `/asset/asset/manage/alarm-list` | 资产告警列表 | `ip` or `serial_number`, `offset`, `limit` |
| `GET` | `/asset/asset/manage/asset-field-data` | 获取搜索筛选条件（端口/域名/应用/协议） | — |
| `GET` | `/asset/asset/manage/ip-manage` | IP信息查询 | — |
| `GET` | `/asset/asset/manage/ip-check` | 资产IP唯一性校验 | `ip`, `asset_id`, `mask` |
| `GET` [AGENT] | `/asset/asset/manage/search` | 资产分类/责任人查询 | `name`（`分类` or `责任人`） |
| `POST` | `/asset/asset/manage/asset-import` | 批量导入资产（Excel） | `file` |
| `GET` | `/asset/asset/manage/asset-import` | 下载资产导入模板 | — |
| `GET` | `/asset/error_asset/asset_download` | 下载导入错误信息 | — |

**GET `/asset/asset/manage/info` — Key Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `offset` | int | Page offset |
| `limit` | int | Page size |
| `start_time` / `end_time` | long | Time range |
| `ipaddrs` | string | IP filter |
| `sname` | string | Asset name |
| `stype_ids` | string | Asset type IDs |
| `principal_ids` | string | Responsible person IDs |
| `group_ids` | string | Asset group IDs |
| `flag_ids` | string | Tag IDs |
| `origin` | string | Discovery source |
| `host` | string | Domain |
| `port` | string | Port |
| `proto` | string | Protocol |
| `service` | string | Service |
| `hw_mode` | string | HW mode (pass `1`) |
| `branch_id` | string | Cascade unit |
| `web_fw` / `web_lang` / `web_OA` | string | Web framework/language/OA |
| `department` | string | Management department |

**Response**: `data.data[].id`, `.asset_sip`, `.sname`, `.category`, `.stype`, `.group_name`, `.kpi`, `.risk`, `.flag`, `.staffname`, `.origin`, `.create_time`, `.update_time`, `.port`, `.host`, `.asset_service`, `data.total`

### 7.2 Asset Tags

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/asset/asset/manage/tags` | 查询资产标签列表 | — |
| `POST` | `/asset/asset/manage/tags` | 新增标签 | `name` |
| `DELETE` | `/asset/asset/manage/tags` | 删除标签 | `ids` |
| `DELETE` | `/asset/asset/manage/tag-untied` | 解绑资产标签 | `asset_id`, `flag_id` |

### 7.3 Asset Groups

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/asset/asset/manage/group` | 查询资产组列表（树形） | `level`, `offset`, `limit`, `group_ids`, `is_cloud` |
| `POST` | `/asset/asset/manage/group` | 新增资产组 | `name`, `region` (0=其他/1=访客区/2=DMZ/3=办公网/4=IDC/5=内网) |
| `PUT` | `/asset/asset/manage/group` | 更新资产组 | `id` |
| `DELETE` | `/asset/asset/manage/group` | 删除资产组 | `ids` |
| `PUT` | `/asset/asset/manage/group-move` | 将资产移动到指定组 | `group_id`, `asset_ids` |
| `POST` | `/asset/asset/manage/group-import` | 批量导入资产组 | `file` |
| `GET` | `/asset/asset/manage/group-import` | 下载资产组导入模板 | — |
| `GET` | `/asset/asset/manage/group-count` | 查询资产分组树及各组数量 | — |
| `GET` | `/asset/asset/valid/group-region` | 获取资产组区域信息 | — |
| `GET` | `/asset/asset/manage/asset_reflush` | 获取资产组自动同步状态 | — |
| `GET` | `/asset/asset/manage/principal` | 查询责任人列表 | `ip`, `offset`, `limit`, `serial_number` |
| `GET` | `/asset/asset/manage/expire-asset-config` | 查询清理过期资产配置 | — |
| `POST` | `/asset/asset/manage/expire-asset-config` | 保存清理过期资产配置 | — |

### 7.4 Asset Port / Service

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/asset/asset/manage/port-service` | 资产端口服务查询 | `asset_id`, `limit`, `offset` |
| `POST` | `/asset/asset/manage/port-service` | 新增端口服务 | `asset_id` |
| `PUT` | `/asset/asset/manage/port-service` | 编辑端口服务 | `id`, `asset_id` |
| `DELETE` | `/asset/asset/manage/port-service` | 删除端口服务 | `id` |

### 7.5 Vulnerability Management

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` [AGENT] | `/asset/vul/leaks/list` | **漏洞列表查询** | `limit`, `offset` |
| `GET` [AGENT] | `/asset/vul/leaks/info` | 漏洞详情 | `id` |
| `DELETE` | `/asset/vul/leaks/list` | 删除漏洞记录 | `ids` |
| `POST` | `/asset/vul/leaks/import` | 漏洞数据导入 | `file` |
| `GET` | `/asset/vul/asset-leaks/pie-chart` | 资产威胁级别分布饼图 | `start_time`, `end_time` |
| `GET` | `/asset/vul/asset-leaks/bar-chart` | 资产漏洞Top10柱状图 | `start_time`, `end_time` |

### 7.6 Configuration Check

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/asset/cfg-check/tops-bar` | 资产配置核查TOP10 | `start_time`, `end_time` |
| `GET` | `/asset/cfg-check/types-pie` | 配置核查类型分布饼图 | `start_time`, `end_time` |
| `GET` | `/asset/cfg-check/list` | 配置核查列表 | `limit`, `offset`, `start_time`, `end_time` |
| `GET` | `/asset/cfg-check/info` | 配置核查详情 | `id` |

### 7.7 IP Address Management [AGENT]

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` [AGENT] | `/asset/asset/ip-manage/list` | **IP地址管理列表** | `limit`, `offset` |
| `POST` | `/asset/asset/ip-manage/list` | 新增IP地址信息 | `country`, `province`, `city`, `custom_ip`, `serial_number`, `longitude`, `latitude`, `note` |
| `PUT` | `/asset/asset/ip-manage/list` | 编辑IP地址信息 | `id` + all fields from POST |
| `DELETE` | `/asset/asset/ip-manage/list` | 删除IP地址信息 | `id` |
| `POST` | `/asset/asset/ip-manage/asset_ip_manage_import` | 批量导入IP地址信息 | `file` |
| `GET` | `/asset/asset/ip-manage/asset_country_province_info` | 获取攻击IP归属地 | `ip` |

### 7.8 Export

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `POST` | `/alarm/alarm/export` | 创建资产/漏洞列表异步导出任务 | `task_type` | Returns `task_id` |

---

## 8. 系统管理

> Base paths: `/skyeye/v1/system/...`, `/system/device/...`, `/monitor-center/buckets/...`

### 8.1 Process / Device Monitoring

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/skyeye/v1/system/monitor/process` | 查询设备监控进程列表 | `offset`, `limit` |
| `PUT` | `/skyeye/v1/system/monitor/process` | 启停进程 | `process_name`, `switch` |
| `GET` | `/monitor-center/buckets/alarm_monitor` | 告警入库监测 | — |
| `GET` | `/monitor-center/buckets/device_details` | 设备详情 | `type` |
| `GET` | `/monitor-center/buckets/device_list` | 设备列表 | `type`, `limit`, `offset`, `mode` |
| `GET` | `/monitor-center/buckets/device_type` | 全局桶设备类型列表 | — |
| `GET` | `/monitor-center/buckets/device_info` | 全家桶主界面设备信息 | — |
| `GET` | `/monitor-center/buckets/abnormal_log_check` | 异常日志导出检查 | — |
| `GET` | `/monitor-center/buckets/abnormal_log_export` | 导出异常日志 | — |
| `GET` | `/system/device/device-category` | 获取设备分类列表 | — |
| `GET` | `/system/device/sensor_redirect` | 流量传感器跳转URL | `ip` |
| `GET` | `/system/device/mailsanbox_redirect` | 邮件威胁检测系统跳转URL | `ip` |
| `GET` | `/system/device/noah_redirect` | 诺亚页面跳转URL | `ip` |

**Device types** (from `device_type` API): 流量传感器(1) / 文件威胁鉴定器(2) / NGFW(3) / EDR(4) / 天眼分析(5) / 邮件威胁检测(6) / 网神云锁(7) / 蜜罐(20) / 全包取证(21) / 安全DNS(22) / 威胁情报(23) / 云平台(25)

### 8.2 Network Configuration

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/skyeye/v1/system/config/dns` | 获取DNS配置 | — |
| `POST` | `/skyeye/v1/system/config/dns` | 保存DNS配置 | `prior`, `secondary` |
| `GET` | `/skyeye/v1/system/config/nat` | 获取出站NAT策略 | — |
| `POST` | `/skyeye/v1/system/config/nat` | 添加NAT策略 | `policy`, `protocol`, `sip`, `sport`, `dip`, `dport` |
| `DELETE` | `/skyeye/v1/system/config/nat` | 删除NAT策略 | `id` |
| `GET` | `/skyeye/v1/system/config/interface` | 网络接口列表 | — |
| `PUT` | `/skyeye/v1/system/config/interface` | 更新网络接口 | `ifname`, `admin`, `if_type`, `ipaddr`, `mask` |
| `POST` | `/skyeye/v1/system/config/ping` | 网络连通性测试 | `hostname`, `eths` |
| `DELETE` | `/skyeye/v1/system/config/router` | 删除路由 | `gateway`, `destination`, `iface`, `iptype`, `routetype` |
| `GET` | `/skyeye/v1/system/config/bond-hash` | 聚合链路负载均衡算法 | — |
| `GET` | `/skyeye/v1/system/config/bond-mode` | 聚合链路mode选项 | — |
| `GET` | `/skyeye/v1/system/config/bond-manager` | 聚合链路接口列表 | — |
| `POST` | `/skyeye/v1/system/config/bond-manager` | 新增聚合链路接口 | `device`, `slaves`, `mode` |
| `PUT` | `/skyeye/v1/system/config/bond-manager` | 编辑聚合链路接口 | `device`, `slaves`, `mode` |
| `DELETE` | `/skyeye/v1/system/config/bond-manager` | 删除聚合链路接口 | `device` |
| `GET` | `/skyeye/v1/system/config/bond-slave` | 查询可用于聚合的管理口 | — |

### 8.3 Proxy Configuration

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/skyeye/v1/system/config/proxy` | 获取代理配置 | — |
| `POST` | `/skyeye/v1/system/config/proxy` | 保存代理配置 | `host`, `port`, `auth`, `username`, `passwd`, `switch` |
| `GET` | `/skyeye/v1/system/config/proxy/test` | 测试代理连通性 | — |

### 8.4 Bandwidth Allocation

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/skyeye/v1/system/config/bandwidth_allocations/` | 获取带宽分配列表 | — |
| `POST` | `/skyeye/v1/system/config/bandwidth_allocations/` | 新增带宽分配 | `id`, `comment`, `rate`, `ip_ports`, `iface` |
| `PUT` | `/skyeye/v1/system/config/bandwidth_allocations/` | 修改带宽分配 | `id`, `iface` |
| `DELETE` | `/skyeye/v1/system/config/bandwidth_allocations/` | 删除带宽分配 | `id`, `iface` |

### 8.5 Third-Party Log (Noah)

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/config/get_third_log_status` | 获取第三方日志开关状态 | — |
| `PUT` | `/config/get_third_log_status` | 开启/关闭第三方日志 | `switch_status` (`0`=关/`1`=开) |
| `GET` | `/system/device/noah_redirect` | 获取诺亚跳转URL | `ip` |

### 8.6 Account & Auth

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `POST` | `/skyeye/v1/system/login/third/account-list-template` | 第三方账户列表批量导入 | `file` |

---

## 9. 报表报告

> Base paths: `/report/quick_report/...`, `/report/circle_report/...`, `/report/ireport/...`

### 9.1 Quick Reports (快速报表)

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/report/quick_report/report` | 获取快速报表列表 / 下载文件 | `limit`, `offset` |
| `POST` | `/report/quick_report/report` | 新增快速报表 | `name`, `template_id`, `type`, `format`, `stime`, `etime`, `schedule_time`, `status`, `group_id`, `ip`, `threat_type`, `hazard_level`, `safety_incident_analyze`, `attack_dimension`, `report_time_range`, `task_ids`, `serial_num` |
| `PUT` | `/report/quick_report/report` | 编辑快速报表 | `name`, `stime`, `etime`, `format`, `schedule_time`, `template_id`, `task_ids` + filter fields |
| `DELETE` | `/report/quick_report/report` | 删除快速报表 | `task_ids`, `type` |

### 9.2 Periodic Reports (周期报表)

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/report/circle_report/report` | 获取周期报表列表 / 下载 | `limit`, `offset` |
| `POST` | `/report/circle_report/report` | 新增周期报表 | `name`, `type`, `template_id`, `status`, `mail_notify`, `mail_title`, `mail_content`, `format`, `notify_persons`, `mc_notify`, `group_id`, `ip`, `threat_type`, `hazard_level`, `safety_incident_analyze`, `attack_dimension`, `time_type`, `serial_num` |
| `PUT` | `/report/circle_report/report` | 停用/启用/编辑周期报表 | `task_ids` + fields |
| `DELETE` | `/report/circle_report/report` | 删除周期报表 | `task_ids` |

### 9.3 Report Templates

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/report/ireport/template_label/template` | 获取报表模板列表/预览 | `limit`, `offset` |
| `POST` | `/report/ireport/template_label/template` | 新增/复制报表模板 | `name`, `type`, `layout`, `checkedKeys` |
| `PUT` | `/report/ireport/template_label/template` | 编辑报表模板 | `ids`, `name`, `type`, `source`, `layout`, `checkedKeys` |
| `DELETE` | `/report/ireport/template_label/template` | 删除报表模板 | `ids` |
| `GET` | `/report/ireport/view_list` | 报表视图列表 | `task_ids` |

---

## 10. 大屏 / 仪表板

> Base paths: `/skyeye/v1/monitor-center/situation/...`, `/monitor-center/dashboard/...`

### 10.1 Situation Awareness Screens (大屏)

All screen endpoints use `start_time` (long, required) and `end_time` (long, required).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/skyeye/v1/monitor-center/situation/network` | 地球大屏-网络流量 |
| `GET` | `/skyeye/v1/monitor-center/situation/abnormal-behavior` | 地球大屏-异常行为TOP5 |
| `GET` | `/skyeye/v1/monitor-center/situation/total-count` | 地球大屏-告警总数威胁级别 |
| `GET` | `/skyeye/v1/monitor-center/situation/asset-views/assets` | 资产态势-资产组树详情 (`group_id` required) |
| `GET` | `/skyeye/v1/monitor-center/situation/asset-views/lastest-info` | 资产态势-资产风险状态 |
| `GET` | `/skyeye/v1/monitor-center/situation/asset-views/risk-line` | 资产态势-资产变更趋势 |
| `GET` | `/skyeye/v1/monitor-center/situation/asset-views/asset-general` | 资产大屏-资产概况 (`name` required) |
| `GET` | `/skyeye/v1/monitor-center/situation/vul/main` | 脆弱性态势-主视图 (`interval` required) |
| `GET` | `/skyeye/v1/monitor-center/situation/vul/top5` | 脆弱性态势-Top5 (`interval` required) |
| `GET` | `/skyeye/v1/monitor-center/situation/vul/status/pie` | 脆弱性态势-处置状态分布 (`interval` required) |
| `GET` | `/skyeye/v1/monitor-center/situation/vul/monitor/list` | 脆弱性态势-脆弱性监测 (`interval` required) |
| `GET` | `/skyeye/v1/monitor-center/situation/views_screen` | 挖矿/文件/邮件大屏通用接口 (`name` required) |
| `GET` | `/skyeye/v1/monitor-center/situation/threat-views/new-events` | 威胁事件大屏-最新告警事件 |
| `GET` | `/skyeye/v1/monitor-center/situation/threat-views/alarm-ip-relation` | 威胁事件大屏-威胁IP网 |
| `GET` | `/skyeye/v1/monitor-center/situation/threat-views/alarm-ip` | 威胁事件大屏-威胁星云 |
| `GET` | `/skyeye/v1/monitor-center/situation/threat-views/alarm-top` | 威胁事件大屏-威胁事件Top5 |
| `GET` | `/skyeye/v1/monitor-center/situation/ex-access/trend` | 外部访问大屏-访问趋势图 |
| `GET` | `/skyeye/v1/monitor-center/situation/ex-access/diptop` | 外部访问大屏-资源IP被访次数TOP5 |
| `GET` | `/skyeye/v1/monitor-center/situation/ex-access/siptop` | 外部访问大屏-外部IP访问次数TOP5 |
| `GET` | `/skyeye/v1/monitor-center/situation/ex-access/list` | 外部访问大屏-实时流量事件 (`offset`, `limit` required) |
| `GET` | `/skyeye/v1/monitor-center/situation/ex-access/screen` | 外部访问大屏-地图 (`range` required) |
| `GET` | `/skyeye/v1/monitor-center/situation/cross-access/asset-graph` | 横向访问大屏-资产互访态势图 |
| `GET` | `/skyeye/v1/monitor-center/situation/cross-access/list` | 横向访问大屏-实时流量事件 (`offset`, `limit` required) |
| `GET` | `/skyeye/v1/monitor-center/situation/cross-access/trend` | 横向访问大屏-访问趋势图 |
| `GET` | `/skyeye/v1/monitor-center/situation/cross-access/diptop` | 横向访问大屏-目的资产IP Top5 |
| `GET` | `/skyeye/v1/monitor-center/situation/inner-access/list` | 内网外联大屏-实时流量事件 (`limit`, `offset` required) |
| `GET` | `/skyeye/v1/monitor-center/situation/inner-access/screen` | 内网外联大屏-地图 |
| `GET` | `/skyeye/v1/monitor-center/situation/inner-access/dregion` | 内网外联大屏-外联地区TOP5 (`region` required) |
| `GET` | `/skyeye/v1/monitor-center/situation/inner-access/diptop` | 内网外联大屏-外部IP被访Top5 |
| `GET` | `/skyeye/v1/monitor-center/situation/attack-stage` | 综合态势-攻击阶段 |
| `GET` | `/skyeye/v1/monitor-center/dashboard/view` | 综合态势-风险等级/威胁等级/告警趋势 (`name` required) |

### 10.2 Situation Awareness Premium (态势感知高级版)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/skyeye/v1/monitor-center/situation/globe_new` | 地球大屏高级版-地球炮 |
| `GET` | `/skyeye/v1/monitor-center/situation/big_attack_country` | 攻击者TOP5 |
| `GET` | `/skyeye/v1/monitor-center/situation/big_victim_asset` | 受害资产TOP5 |
| `GET` | `/skyeye/v1/monitor-center/situation/big_attack_summary` | 攻击概要 |
| `GET` | `/skyeye/v1/monitor-center/situation/big_alarm_type` | 告警类型TOP5 |
| `GET` | `/skyeye/v1/monitor-center/situation/big_score` | 告警总数风险值 |
| `GET` | `/skyeye/v1/monitor-center/situation/big_alarm_trend` | 告警变化趋势 |
| `GET` | `/skyeye/v1/monitor-center/situation/big_new_alarm` | 最新告警事件 |
| `GET` | `/skyeye/v1/monitor-center/situation_advanced/capsule_download` | 胶囊下载 |

### 10.3 Dashboard (仪表板)

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/monitor-center/dashboard/list` | 查询仪表板类型列表 | — |
| `POST` | `/monitor-center/dashboard/list` | 新增仪表板 | `name`, `isgroup` |
| `PUT` | `/monitor-center/dashboard/list` | 设为首页/修改仪表板 | `id` |
| `DELETE` | `/monitor-center/dashboard/list` | 删除仪表板 | `id` |
| `GET` | `/monitor-center/dashboard/view` | 获取仪表板视图数据 | `start_time`, `end_time`, `name` |
| `GET` | `/monitor-center/dashboard/view-list` | 获取所有可用视图 | — |
| `GET` | `/monitor-center/dashboard/view-config` | 查询仪表板视图配置 | `dashboard_id` |
| `POST` | `/monitor-center/dashboard/view-config` | 新增视图到仪表板 | `dashboard_id`, `content` |
| `PUT` | `/monitor-center/dashboard/view-config` | 配置仪表板视图/恢复默认 | `dashboard_id`, `content` |
| `DELETE` | `/monitor-center/dashboard/view-config` | 从仪表板删除视图 | `dashboard_id`, `content` |
| `GET` | `/monitor-center/dashboard/focus-class/manage` | 获取重点关注配置 | — |
| `POST` | `/monitor-center/dashboard/focus-class/manage` | 修改重点关注类配置 | `spectype_res` |
| `GET` | `/monitor-center/dashboard/autoflush-switch` | 获取自动刷新状态 | `uid` |
| `POST` | `/monitor-center/dashboard/autoflush-switch` | 开启/关闭自动刷新 | `status_flag`, `uid` |

---

## 11. API安全

> Base paths: `/api-asset/...`, `/monitor-center/dashboard/view/api_...`

### 11.1 API Asset List [AGENT]

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` [AGENT] | `/api-asset/asset/list` | **API资产列表** | `limit`, `offset` |
| `POST` | `/api-asset/asset/export` | 创建导出任务 | `start_time`, `end_time` |
| `GET` | `/api-asset/asset/export` | 查询导出状态 | `task_id` |
| `GET` | `/api-asset/asset/export-download` | 下载导出文件 | `task_id` |
| `GET` | `/api-asset/asset/merged-list` | 归并统计列表 | `start_time`, `end_time`, `limit`, `offset`, `dimension`(`host`/`application`) |
| `GET` | `/api-asset/asset/access-count` | 访问次数统计 | `ids`, `start_time`, `end_time` |
| `GET` | `/api-asset/asset/config` | 获取API资产配置 | — |
| `PUT` | `/api-asset/asset/config` | 修改API资产配置 | `expire_time` |
| `GET` | `/api-asset/asset/access-time-range` | 获取API访问时间范围 | — |
| `GET` | `/api-asset/asset/template` | 下载导入模板 | — |
| `POST` | `/api-asset/batch-import-swagger` | 批量导入API资产（Excel/Swagger） | `file`, `file_type`(`excel`/`swagger`) |

### 11.2 API Asset Statistics

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/api-asset/asset/pie` | 标签分布统计图 | `start_time`, `end_time` |
| `GET` | `/api-asset/asset/top5` | 访问次数TOP5 | `start_time`, `end_time` |
| `GET` | `/api-asset/asset/trend` | 新上线趋势图 | `start_time`, `end_time` |
| `GET` | `/api-asset/asset/statistics` | API总数统计 | `start_time`, `end_time` |

### 11.3 API Asset Detail — Request Analysis

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/api-asset/asset/detail/stat-count` | 请求分析/涉敏分析页签总数 | `interval`, `id`, `data_type` |
| `GET` | `/api-asset/asset/detail/drop_params` | 下拉框内容 | `id`, `interval` |
| `GET` | `/api-asset/asset/detail/visit-trend` | 请求分析趋势图 | `id`, `interval` |
| `GET` | `/api-asset/asset/detail/response-code` | 响应码分布 | `id`, `interval` |
| `GET` | `/api-asset/asset/detail/top` | 源IP请求次数Top5 | `id`, `interval` |
| `GET` | `/api-asset/asset/detail/source` | 请求源IP内外网分布 | `id`, `interval` |
| `GET` | `/api-asset/asset/detail/stat_cards` | 请求/响应统计卡片 | `id`, `interval` |
| `GET` | `/api-asset/asset/detail/access-list` | 参数样例获取 | `id`, `start_time`, `end_time`, `method` |

### 11.4 API Asset Detail — Sensitive Data Analysis

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` [AGENT] | `/api-asset/asset/detail/sensitive_info` | 敏感数据明细统计 | `interval`, `id` |
| `GET` [AGENT] | `/api-asset/asset/detail/sensitive_list` | 涉敏数据明细列表 | `interval`, `limit`, `offset`, `id` |
| `GET` | `/api-asset/asset/detail/sensitive_trend` | 涉敏传输趋势 | `interval`, `id` |
| `GET` | `/api-asset/asset/detail/sensitive_top5` | 涉敏分析Top5 | `interval`, `id`, `top_type` |
| `GET` | `/api-asset/asset/detail/sensitive_stat` | 涉敏统计数据 | `interval`, `id` |
| `GET` | `/api-asset/asset/detail/sensitive_cards` | 涉敏分析卡片 | `interval`, `id` |
| `GET` | `/api-asset/asset/detail/log_detail` | 涉敏日志详情 | `id`, `interval` |
| `GET` | `/api-asset/asset/detail/status_update_detail` | 状态变更历史 | `asset_id`, `type`(`api`/`app`/`account`) |

### 11.5 Application Management

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/api-asset/application/api_statistics` | 应用API树型图统计 | `app_id` |

### 11.6 API Security Dashboard

All endpoints: `GET`, params `start_time` (long, required) + `end_time` (long, required).

| Path | Description |
|------|-------------|
| `/monitor-center/dashboard/view/api_app_count` | 应用API数统计 |
| `/monitor-center/dashboard/view/api_count` | API总数统计 |
| `/monitor-center/dashboard/view/api_sensitive_count` | 涉敏API总数 |
| `/monitor-center/dashboard/view/api_sensitive_data` | 敏感数据统计 |
| `/monitor-center/dashboard/view/api_vul_count` | 脆弱性数量 |
| `/monitor-center/dashboard/view/api_abnormal_count` | 异常行为数量 |
| `/monitor-center/dashboard/view/api_threat_count` | 威胁告警数量 |
| `/monitor-center/dashboard/view/api_request_count` | API请求总数 |
| `/monitor-center/dashboard/view/api_response_count` | API响应总数 |
| `/monitor-center/dashboard/view/api_risk_count` | 风险接口总数 |
| `/monitor-center/dashboard/view/api_attack_source_count` | 威胁来源地图 |
| `/monitor-center/dashboard/view/api_abnormal_trend_count` | 风险趋势-异常行为 |
| `/monitor-center/dashboard/view/api_vul_trend_count` | 风险趋势-脆弱性 |
| `/monitor-center/dashboard/view/api_threat_trend_count` | 风险趋势-威胁告警 |
| `/monitor-center/dashboard/view/api_abnormal_type_count` | 风险类型分布-异常行为 |
| `/monitor-center/dashboard/view/api_vul_type_count` | 风险类型分布-脆弱性 |
| `/monitor-center/dashboard/view/api_threat_type_count` | 风险类型分布-威胁告警 |
| `/monitor-center/dashboard/view/api_affect_app_count` | 受影响应用TOP5 |
| `/monitor-center/dashboard/view/api_abnormal_host_state_count` | 攻击结果分布-异常行为 |
| `/monitor-center/dashboard/view/api_vul_host_state_count` | 攻击结果分布-脆弱性 |
| `/monitor-center/dashboard/view/api_threat_host_state_count` | 攻击结果分布-威胁告警 |
| `/monitor-center/dashboard/view/api_threat_tactics_count` | 风险手法分布-威胁告警 |
| `/monitor-center/dashboard/view/api_abnormal_tactics_count` | 风险手法分布-异常行为 |
| `/monitor-center/dashboard/view/api_vul_tactics_count` | 风险手法分布-脆弱性 |
| `/monitor-center/dashboard/view/api_sensitive_transport_count` | 敏感数据传输TOP10 |
| `/monitor-center/dashboard/view/api_attack_addr_count` | 攻击者地址TOP5 |
| `/monitor-center/dashboard/view/api_sensitive_file_count` | 敏感文件类型TOP5 |
| `/monitor-center/dashboard/view/api_in_sensitive_type_count` | 敏感数据类型TOP5-境内 |
| `/monitor-center/dashboard/view/api_out_sensitive_type_count` | 敏感数据类型TOP5-境外 |
| `/monitor-center/dashboard/view/api_victim_count` | 受影响API TOP5 |
| `/monitor-center/dashboard/view/api_status_count` | 响应码TOP5 |
| `/monitor-center/dashboard/view/api_in_sensitive_access_count` | 敏感传输API TOP5-境内 |
| `/monitor-center/dashboard/view/api_out_sensitive_access_count` | 敏感传输API TOP5-境外 |
| `/monitor-center/dashboard/view/api_access_count` | API访问TOP5 |
| `/monitor-center/dashboard/view/api_method_count` | 请求方法TOP5 |
| `/monitor-center/dashboard/view/api_sensitive_sip_count` | 访问IP TOP5 |
| `/monitor-center/dashboard/view/api_sip_count` | 请求地址TOP5 |

---

## 12. 云原生

> Base paths: `/asset/cluster_asset/...`, `/asset/namespace_asset/...`, etc.

### 12.1 Cloud Asset Inventory [AGENT]

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` [AGENT] | `/asset/cluster_asset/list` | 集群列表 | `offset`, `limit` |
| `GET` | `/asset/cluster_asset/detail` | 集群详情 | `id` |
| `GET` | `/asset/cloud_asset/mapping` | 云资产枚举值信息 | — |
| `GET` [AGENT] | `/asset/namespace_asset/list` | 命名空间列表 | `offset`, `limit` |
| `GET` | `/asset/namespace_asset/detail` | 命名空间详情 | `id` |
| `GET` | `/asset/namespace_asset/history_list` | 命名空间变更历史列表 | `id`, `offset`, `limit` |
| `GET` | `/asset/namespace_asset/history_bar` | 命名空间变更历史柱状图 | `id`, `start_time`, `end_time` |
| `GET` [AGENT] | `/asset/node_asset/list` | 节点列表 | `offset`, `limit` |
| `GET` | `/asset/node_asset/detail` | 节点详情 | `id` |
| `GET` | `/asset/cloud_asset/statistics` | 云资产统计 | — |
| `GET` [AGENT] | `/asset/workload_asset/list` | 工作负载列表 | `offset`, `limit` |
| `GET` | `/asset/workload_asset/detail` | 工作负载详情 | `id` |
| `GET` [AGENT] | `/asset/service_asset/list` | 服务列表 | `offset`, `limit` |
| `GET` | `/asset/service_asset/detail` | 服务详情 | `id` |
| `GET` | `/asset/service_asset/history_list` | 服务变更历史列表 | `id`, `offset`, `limit` |
| `GET` | `/asset/service_asset/history_bar` | 服务变更历史柱状图 | `id`, `start_time`, `end_time` |
| `GET` | `/asset/ingress_asset/list` | Ingress列表 | `offset`, `limit` |
| `GET` | `/asset/ingress_asset/detail` | Ingress详情 | `id` |
| `GET` [AGENT] | `/asset/pod_asset/list` | Pod列表 | `offset`, `limit` |
| `GET` | `/asset/pod_asset/detail` | Pod详情 | `id` |
| `GET` | `/asset/pod_asset/history_list` | Pod变更历史列表 | `id`, `offset`, `limit` |
| `GET` | `/asset/pod_asset/history_bar` | Pod变更历史柱状图 | `id`, `start_time`, `end_time` |
| `GET` | `/asset/cloud_asset/trans_ips` | 服务/工作负载资产转Pod IP | `ids` |

---

## 13. 扩展程序 / 安全服务

> Base paths: `/plugin/...`, `/more/plugin`, `/more/safe_service/...`

### 13.1 Plugin (扩展程序) Management

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/plugin/operation` | 扩展程序列表 | `offset`, `limit` |
| `POST` | `/more/plugin` | 上传安装扩展程序 | `fp`(.bin file) |
| `PUT` | `/plugin/operation` | 启用/禁用扩展程序 | `package`, `status`(`0`=关/`1`=开) |
| `DELETE` | `/plugin/operation` | 删除扩展程序 | `package` |
| `PUT` | `/skyeye/home/tool/plugin/option` | 启动扩展程序 | `package`, `status`(=`1`) |
| `POST` | `/plugin/upload` | 新增扩展程序（备用接口） | `file` |

**GET `/plugin/operation` — Response fields**: `.name`, `.package`, `.version`, `.author`, `.status`(`0`未安装/`1`已安装), `.detail`, `.labels`, `.sys_version`, `data.total`

### 13.2 Security Services (安全服务)

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/more/safe_service/tools` | 安全工具列表 | `page`, `pagesize` |
| `POST` | `/more/safe_service/tools` | 上传安全工具 | `fp`(.bin file) |
| `DELETE` | `/more/safe_service/tools` | 删除安全工具 | `id` |
| `GET` | `/more/safe_service/tool_data` | 下载安全工具数据 | `id` |
| `GET` | `/more/safe_service/tool_process` | 获取安全工具采集进度 | `id` |
| `POST` | `/more/safe_service/tool_config` | 配置工具采集时间范围 | `id`, `start_time`, `end_time`, `time_span` |
| `GET` | `/more/safe_service/record` | 获取安全服务记录 | `start_time`, `end_time`, `page`, `pagesize` |
| `GET` | `/more/safe_service/report` | 下载安全服务报告 | `id` |
| `GET` | `/more/safe_service/config` | 获取安全服务授权信息 | — |
| `POST` | `/more/safe_service/config` | 更改授权信息 | — |
| `GET` | `/more/safe_service/status` | 获取云端接收状态 | — |
| `POST` | `/more/safe_service/status` | 更改云端接收状态 | `data`(`1`=开/`0`=关) |

---

## 14. GPT 智能助手

> Base path: `/system/qgpt/...`

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/system/qgpt/chat_list` | 获取所有会话列表 | `offset`, `limit` |
| `POST` | `/system/qgpt/chat` | 创建新会话（获取会话ID） | — |
| `GET` | `/system/qgpt/chat` | 获取历史会话消息 | `message_id`, `limit` |
| `PUT` | `/system/qgpt/chat_list` | 修改会话名称 | `message_id`, `title` |
| `DELETE` | `/system/qgpt/chat_list` | 删除会话 | `message_id` |
| `GET` | `/system/qgpt/chat-default-question` | 获取推荐提问 | `field` |
| `POST` | `/system/qgpt/chat_event` | 注册GPT事件 | `event_id` |
| `GET` | `/system/aibot/query` | AI Bot智能查询 | `query` |

**POST `/system/qgpt/chat` — Response**: `data.data.id` (session ID), `data.data.updated_time`

---

## 15. 消息中心

> Base path: `/message-center/...`

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/message-center/cfg` | 获取消息中心配置 | — |
| `PUT` | `/message-center/cfg` | 设置消息中心配置 | `choose_hazard_level_list`, `choose_host_state_list`, `choose_message_type_list`, `choose_asset_group_list`, `choose_focus_label_list`, `choose_music_config`, `choose_type_chain_list`, `is_sys_warn`, `is_alarm_warn` |
| `GET` | `/message-center/count` | 获取未读消息数量 | — |
| `GET` | `/message-center/list` | 获取消息列表 | `type` |
| `POST` | `/message-center/list` | 标记消息已读 | `type` |
| `DELETE` | `/message-center/list` | 删除消息 | `ids`, `type` |
| `PUT` | `/message-center/music-upload` | 恢复默认提示音 | `type` |
| `POST` | `/message-center/sensor_cfg` | 探针异常提示消息 | `log_type`, `detail`, `serial_num`, `device_ip` |

---

## 16. 多源数据治理

> Base path: `/third_data/...`

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/third_data/switch` | 查询数据治理开关状态 | — |
| `PUT` | `/third_data/switch` | 开启/关闭数据治理 | `switch_status`(`1`=开/`0`=关) |
| `GET` | `/third_data/device_type` | 获取设备类型列表 | `ids`, `name`, `parent_id` |
| `POST` | `/third_data/device_type` | 新增设备类型 | `name`, `parent_id` |
| `PUT` | `/third_data/device_type` | 编辑设备类型 | `ids`, `name`, `parent_id` |
| `DELETE` | `/third_data/device_type` | 删除设备类型 | `ids` |
| `GET` | `/third_data/rule/parse` | 获取解析规则列表 | `offset`, `limit` |
| `POST` | `/third_data/rule/parse` | 创建解析规则 | `name`, `type`, `device_type`, `description`, `sample`, `parse_type`, `parse_rule`, `field_filter`, `parse_result` |
| `PUT` | `/third_data/rule/parse` | 编辑解析规则 | `ids` + all POST fields |
| `DELETE` | `/third_data/rule/parse` | 删除解析规则 | `ids` |
| `POST` | `/third_data/rule/export` | 批量导入解析规则 | `file` |
| `GET` | `/third_data/rule/export` | 批量导出解析规则 | — |
| `POST` | `/third_data/sample/parse/result/preview` | 预览解析结果 | `sample`, `parse_type`, `parse_rule`, `field_filter` |
| `POST` | `/third_data/sample/parse/result` | 获取样本解析结果 | `sample`, `parse_type`, `parse_rule`, `field_filter` |
| `POST` | `/third_data/sample/field` | 获取样本解析后字段 | `sample`, `parse_type`, `parse_rule` |
| `GET` | `/third_data/data-field` | 字段库查询 | `offset`, `limit` |
| `GET` | `/third_data/field-mapping` | 映射表查询 | `offset`, `limit` |
| `POST` | `/third_data/field-mapping` | 新增映射表 | `name`, `device_type` |
| `PUT` | `/third_data/field-mapping` | 编辑映射表 | `ids` |
| `DELETE` | `/third_data/field-mapping` | 删除映射表 | `ids` |
| `GET` | `/third_data/field/relation-mapping` | 映射项查询 | `offset`, `limit` |
| `POST` | `/third_data/field/relation-mapping` | 新增映射项 | `field_map_id`, `src`, `dist` |
| `PUT` | `/third_data/field/relation-mapping` | 编辑映射项 | `field_map_id`, `relation_ids` |
| `DELETE` | `/third_data/field/relation-mapping` | 删除映射项 | `field_map_id`, `relation_ids` |
| `GET` | `/third_data/mapping` | 数据接入枚举值信息 | — |
| `GET` | `/third_data/data-ingestion` | 数据接入配置查询 | `offset`, `limit` |
| `POST` | `/third_data/data-ingestion` | 新增数据接入 | `name`, `working_node`, `device_id`, `rule_id`, `access_type`, `config` |
| `PUT` | `/third_data/data-ingestion` | 编辑/启用/停用数据接入 | `ids`, `action` |
| `DELETE` | `/third_data/data-ingestion` | 删除数据接入配置 | `ids` |
| `GET` | `/third_data/data-ingestion/statistics` | 最近1小时数据量统计 | `offset`, `limit` |
| `GET` | `/third_data/data-ingestion/export` | 导出数据接入配置 | `offset`, `limit`, `name`, `access_type`, `active`, `ids` |
| `POST` | `/third_data/data-ingestion/export` | 导入数据接入配置 | `file` |
| `GET` | `/third_data/data-ingestion/es-node` | 数据接入工作节点查询 | — |

---

## 17. 全局公共

> Base paths: `/admin/...`, `/_perms`, `/config/...`

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/admin/login` | 获取登录页（含验证码） | — |
| `POST` | `/admin/login` | 用户名密码登录 | `username`, `password` |
| `GET` | `/admin/logout` | 注销登录 | — |
| `GET` | `/admin/auth` | 检查认证状态 | — |
| `POST` | `/admin/two-factor-login` | 双因素认证登录 | `code` |
| `GET` | `/admin/two-factor-login` | 获取双因素认证状态 | — |
| `GET` | `/admin/code` | 获取图形验证码 | — |
| `GET` | `/admin/channel_version` | 获取系统渠道版本 | — |
| `GET` | `/_perms` | 获取当前用户权限列表 | — |
| `POST` | `/admin/alertpasswd` | 修改告警密码 | `old_password`, `new_password` |
| `GET` | `/config/get_isSlaveCategory_status` | 查询级联分类状态 | — |

---

## Common Response Structure

All API responses share this outer envelope:

```json
{
  "data": {
    "status": 1000,
    "message": "操作成功描述",
    "token": "<refreshed_csrf_token>",
    "items": [ ... ],
    "total": 100
  }
}
```

**Success indicator**: `data.status == 1000`

**Error response**:
```json
{
  "error": {
    "message": "错误描述",
    "token": "<csrf_token>"
  }
}
```

or

```json
{
  "error": {
    "code": 1001,
    "message": "错误描述",
    "detail": [{"field": "字段名", "description": "错误描述"}]
  }
}
```

### Universal Optional Parameters

Every API call accepts these additional optional parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `csrf_token` | string | CSRF protection token (required in practice) |
| `r` | float | Random number for cache-busting |
| `branch_id` | string | Cascade unit ID (multi-tier deployments) |

### Threat Level Values

| Value | Chinese | Description |
|-------|---------|-------------|
| `0` | 低危 | Low |
| `1` | 中危 | Medium |
| `2` | 高危 | High |
| `3` | 危急 | Critical |

### Attack Result (host_state) Values

| Value | Chinese | Description |
|-------|---------|-------------|
| `-1` | 失败 | Failed |
| `0` | 企图 | Attempt |
| `1` | 成功 | Success |
| `2` | 失陷 | Compromised |

### Alarm Disposition (status) Values

| Value | Chinese | Description |
|-------|---------|-------------|
| `0` | 未处置 | Unhandled |
| `1` | 已处置 | Handled |
| `6` | 忽略 | Ignored |
| `7` | 误报 | False positive |

---

## AI Agent Use-Case Quick Reference

The following are the most useful endpoints for AI Agent automation. All marked `[AGENT]` above.

### Alarm Query & Update

| Priority | Method | Path | Use Case |
|----------|--------|------|----------|
| ★★★ | `GET` | `/skyeye/v1/alarm/alarm/list` | Fetch alarms by severity, time, IP, type |
| ★★★ | `PUT` | `/alarm/alarm/list` | Update alarm disposition (mark handled/false-positive) |
| ★★ | `GET` | `/asset/asset/manage/alarm-list` | Get alarms for a specific asset IP |

### IP Blocking / Whitelist Management

| Priority | Method | Path | Use Case |
|----------|--------|------|----------|
| ★★★ | `POST` | `/system/rule_cfg/white_list_flow` | Add IP to flow sensor whitelist (effectively block/allow) |
| ★★★ | `PUT` | `/system/rule_cfg/white_list_flow` | Edit existing whitelist entry |
| ★★★ | `DELETE` | `/system/rule_cfg/white_list_action` | Remove IP from whitelist |
| ★★ | `GET` | `/system/rule_cfg/white_list_action` | Query current whitelist |
| ★★ | `PUT` | `/system/rule_cfg/white_list_action` | Enable/disable whitelist entry |

### Asset Query

| Priority | Method | Path | Use Case |
|----------|--------|------|----------|
| ★★★ | `GET` | `/asset/asset/manage/info` | Search assets by IP/name/group/type |
| ★★ | `GET` | `/asset/asset/manage/search` | Get asset categories / responsible persons |
| ★★ | `GET` | `/asset/vul/leaks/list` | List vulnerabilities for assets |
| ★★ | `GET` | `/analysis/hunting/stuck_host/status` | Check if a host is compromised |

### Log Search

| Priority | Method | Path | Use Case |
|----------|--------|------|----------|
| ★★★ | `GET` | `/analysis/log-search/list` | Search raw logs (keyword/SPL mode) |
| ★★★ | `GET` | `/analysis/log-search/spl-search` | Expert SPL query with field extraction |
| ★★ | `GET` | `/analysis/log-search/facets` | Time-based log distribution |
| ★★ | `GET` | `/analysis/log-search/types` | Get log type/field dictionaries |

### Threat Hunting

| Priority | Method | Path | Use Case |
|----------|--------|------|----------|
| ★★★ | `GET` | `/analysis/hunt/search` | Build threat relationship graph for an IOC |
| ★★★ | `GET` | `/analysis/hunt/extend-nodes` | Expand graph from a node (IP/domain/MD5/URI) |
| ★★ | `GET` | `/analysis/hunting/stuck_host/status` | Assess host compromise status |
| ★★ | `GET` | `/analysis/hunting/stuck_host/count` | Detailed host security stats |
| ★★ | `GET` | `/analysis/hunt/investigation/result` | Get full investigation summary |

### File & PCAP Download (Post-Alert)

| Priority | Method | Path | Use Case |
|----------|--------|------|----------|
| ★★ | `GET` | `/alarm/alarm/info/uploadfile/download` | Download suspicious file from alert |
| ★★ | `GET` | `/alarm/alarm/info/pcap/download` | Download PCAP from alert |
| ★ | `POST` | `/analysis/pcap-analysis/pcap/create_task` | Create async PCAP download task |

---

*Document compiled from 5+ source extraction reports totaling 500+ API endpoints across 15 modules of the TianYan Analysis Platform v30140.sp2.*

---

## 18. 攻击源IP预警

> Base path: `/analysis/ip-analysis/...`

### 18.1 攻击IP列表 & 统计

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/analysis/ip-analysis/attack-sip/list` | 攻击源IP预警列表（分页） | `start_time`, `end_time`, `offset`, `limit` |
| `GET` | `/analysis/ip-analysis/attack-sip/count` | IP预警列表统计信息（总数/危险等级分布） | `start_time`, `end_time` |
| `GET` | `/analysis/ip-analysis/attack-sip/map` | 攻击源态势地图（地理分布） | `start_time`, `end_time` |
| `GET` | `/analysis/ip-analysis/attack-sip/radar` | 攻击IP雷达图（多维度评分） | `ip`, `start_time`, `end_time` |
| `GET` | `/analysis/ip-analysis/attack-sip/tree` | 攻击IP关联树 | `ip`, `start_time`, `end_time` |
| `GET` | `/analysis/ip-analysis/hot-sip/top` | 热门攻击IP Top排行 | `start_time`, `end_time`, `limit` |

### 18.2 IP预警详情

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/analysis/ip-analysis/details` | IP预警详情-基本信息 | `ip` |
| `GET` | `/analysis/ip-analysis/details/statistical` | IP详情统计信息（攻击次数/类型分布） | `ip`, `start_time`, `end_time` |
| `GET` | `/analysis/ip-analysis/details/distribute` | IP全息画像-行为分析图 | `ip`, `start_time`, `end_time` |
| `GET` | `/analysis/ip-analysis/details/distribute-row` | IP全息画像-行为分析图横向数据 | `ip`, `start_time`, `end_time` |
| `GET` | `/analysis/ip-analysis/network-mapping` | IP网络测绘信息 | `ip` |
| `GET` | `/analysis/ip-analysis/serial-number` | 获取资产序列号 | — |

### 18.3 处置操作

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `POST` | `/analysis/ip-analysis/disposal-state` | 更新处置状态 | `ip`, `state` |
| `POST` | `/analysis/ip-analysis/disposal-advice` | 设置处置建议 | `ip`, `advice` |
| `POST` | `/analysis/ip-analysis/custom-ip/disposal-advice` | 自定义IP处置建议 | `ip`, `advice` |

### 18.4 标签 & 评论管理

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/analysis/ip-analysis/label` | 获取IP标签列表 | `ip` |
| `POST` | `/analysis/ip-analysis/label` | 新增标签 | `ip`, `label_name` |
| `DELETE` | `/analysis/ip-analysis/label` | 删除标签 | `ip`, `label_id` |
| `DELETE` | `/analysis/ip-analysis/delete-local-label` | 删除本地自定义标签 | `label_id` |
| `GET` | `/analysis/ip-analysis/comment` | 获取评论列表 | `ip`, `offset`, `limit` |
| `POST` | `/analysis/ip-analysis/comment` | 添加评论 | `ip`, `content` |
| `PUT` | `/analysis/ip-analysis/comment` | 编辑评论 | `id`, `content` |
| `DELETE` | `/analysis/ip-analysis/comment` | 删除评论 | `id` |
| `GET` | `/analysis/ip-analysis/operating-record` | 操作记录 | `ip`, `offset`, `limit` |

### 18.5 告警导出 & 采集配置

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/analysis/ip-analysis/alarm/alert-rule` | 获取预警规则配置 | — |
| `GET` | `/analysis/ip-analysis/alarm/attack_victim_export` | 导出攻击受害者数据 | `task_id` |
| `GET` | `/analysis/ip-analysis/alarm/export_status` | 查询导出任务状态 | `task_id` |
| `GET` | `/analysis/ip-analysis/alarm/file_status` | 查询导出文件状态 | `task_id` |
| `GET` | `/analysis/ip-analysis/alarm/collect_switch` | 获取采集开关状态 | — |
| `POST` | `/analysis/ip-analysis/alarm/collect_switch` | 开启/关闭数据采集 | `switch` (`0`=关/`1`=开) |

### 18.6 攻击IP导入 & 安全服务

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `POST` | `/analysis/ip-analysis/attack-sip-upload` | 导入攻击源IP列表 | `fp`(file) |
| `GET` | `/analysis/ip-analysis/attack-sip-upload` | 查询导入任务状态/已导入IP列表 | `task_id` |
| `DELETE` | `/analysis/ip-analysis/attack-sip-upload` | 删除已导入的攻击IP | `ids` |
| `GET` | `/analysis/ip-analysis/safe-service-agreement` | 查询安全服务协议状态 | — |
| `POST` | `/analysis/ip-analysis/safe-service-agreement` | 更新安全服务协议状态 | `is_agree` |
| `GET` | `/analysis/ip-analysis/safe-service-config` | 获取安全服务配置 | — |
| `POST` | `/analysis/ip-analysis/safe-service-config` | 保存安全服务配置 | — |
| `GET` | `/analysis/ip-analysis/secret-key` | 获取API密钥 | — |

---

## 19. 监测工作台

> Base path: `/monitor-center/monitor/...`

### 19.1 工作台设置 & 控制

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/monitor-center/monitor/auto-refresh` | 获取自动刷新开关状态 | `uid` |
| `POST` | `/monitor-center/monitor/auto-refresh` | 修改自动刷新开关状态 | `uid`, `status` |
| `GET` | `/monitor-center/monitor/monitor-settings` | 获取选项卡配置数据（重点监测模块数据） | — |
| `POST` | `/monitor-center/monitor/monitor-settings` | 新增重点监测卡片 | `type`, `config` |
| `DELETE` | `/monitor-center/monitor/monitor-settings` | 删除重点监测卡片 | `ids` |
| `POST` | `/monitor-center/monitor/click-clear-num` | 点击清空数量（清除未读计数） | `type` |
| `POST` | `/monitor-center/monitor/import` | 导入监测工作台配置 | `file` |
| `GET` | `/monitor-center/monitor/export` | 导出选项卡片内容 | `type` |
| `GET` | `/monitor-center/monitor/card-nums` | 获取卡片数量数据 | `start_time`, `end_time` |
| `GET` | `/monitor-center/monitor/name-to-id` | 名称转内部ID（监测选项映射） | `name` |

### 19.2 外部攻击监测

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/monitor-center/monitor/external-attack/chart-bar` | 外部攻击源TOP10柱状图 | `start_time`, `end_time` |
| `GET` | `/monitor-center/monitor/external-attack/chart-pie` | 外部攻击源分布饼图 | `start_time`, `end_time` |
| `GET` | `/monitor-center/monitor/external-attack/chart-line` | 外部攻击趋势折线图 | `start_time`, `end_time`, `interval` |

### 19.3 横向攻击监测

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/monitor-center/monitor/horizontal-attack/chart-line` | 横向攻击趋势折线图 | `start_time`, `end_time`, `interval` |
| `GET` | `/monitor-center/monitor/horizontal-attack/attack-asset` | 横向攻击源资产列表 | `start_time`, `end_time`, `offset`, `limit` |
| `GET` | `/monitor-center/monitor/horizontal-attack/suffer-asset` | 横向攻击受害资产列表 | `start_time`, `end_time`, `offset`, `limit` |

### 19.4 超权访问监测

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/monitor-center/monitor/exceeds-authorized/chart-pie` | 超权访问分布饼图 | `start_time`, `end_time` |
| `GET` | `/monitor-center/monitor/exceeds-authorized/chart-bar` | 超权访问分布柱状图 | `start_time`, `end_time` |

---

## 20. 威胁感知 — 扩展接口

> Additional endpoints for the threat detection module not covered in Section 1.

### 20.1 告警高级检索 & 场景管理

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/alarm/alarm/ti_search` | 威胁情报查询跳转URL | `ioc` |
| `POST` | `/alarm/alarm/advanced-search` | 告警高级检索（结构化条件组合） | `conditions`, `offset`, `limit` |
| `GET` | `/alarm/alarm/search_scene` | 获取检索场景列表 | `offset`, `limit` |
| `POST` | `/alarm/alarm/search_scene` | 保存检索场景 | `name`, `conditions` |
| `DELETE` | `/alarm/alarm/search_scene` | 删除检索场景 | `ids` |
| `PUT` | `/alarm/alarm/search_scene` | 检索场景置顶/重命名 | `id`, `name`, `is_top` |
| `PUT` | `/alarm/alarm/search_scene_drag` | 检索场景拖拽排序 | `ids`(ordered list) |
| `GET` | `/alarm/alarm/scene_search_conditions` | 获取检索场景中的检索条件 | `scene_id` |
| `GET` | `/alarm/alarm/search_scene_conditions` | 获取全部可用检索条件枚举 | — |
| `GET` | `/alarm/alarm/desc` | 获取告警描述详情 | `id` |
| `GET` | `/alarm/alarm/history-search/fav-name/list` | 历史检索收藏名称列表 | `offset`, `limit` |
| `GET` | `/alarm/alarm/history-search/fav-content/info` | 历史检索收藏内容详情 | `id` |

### 20.2 威胁视角 — 勒索专项

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/alarm/threat/ransomware/list` | 勒索软件告警列表 | `start_time`, `end_time`, `offset`, `limit` |
| `GET` | `/alarm/threat/ransomware/pie` | 勒索软件类型分布饼图 | `start_time`, `end_time` |
| `GET` | `/alarm/threat/ransomware/trend` | 勒索软件趋势图 | `start_time`, `end_time`, `interval` |
| `GET` | `/alarm/threat/ransomware/stage` | 勒索攻击阶段分布 | `start_time`, `end_time` |
| `GET` | `/alarm/threat/ransomware/top` | 勒索软件 Top 排行 | `start_time`, `end_time` |
| `GET` | `/alarm/threat/ransomware/count` | 勒索软件告警总数 | `start_time`, `end_time` |

### 20.3 威胁视角 — 情报关联 (TI)

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/alarm/threat/ti/list` | 情报关联告警列表 | `start_time`, `end_time`, `offset`, `limit` |
| `GET` | `/alarm/threat/ti/bar` | 情报关联类型柱状图 | `start_time`, `end_time` |
| `GET` | `/alarm/threat/ti/pie` | 情报关联分布饼图 | `start_time`, `end_time` |
| `GET` | `/alarm/threat/ti/info` | 情报关联详情 | `ioc`, `start_time`, `end_time` |
| `GET` | `/alarm/threat/ti/asset/list` | 受影响资产列表（情报关联维度） | `start_time`, `end_time`, `offset`, `limit` |
| `GET` | `/alarm/threat/ti/asset/info` | 受影响资产详情 | `asset_ip`, `start_time`, `end_time` |
| `GET` | `/alarm/threat/ti/behaviour/list` | IOC行为日志列表 | `ioc`, `start_time`, `end_time`, `offset`, `limit` |
| `GET` | `/alarm/threat/ti/behaviour/trend` | IOC行为趋势图 | `ioc`, `start_time`, `end_time` |

### 20.4 威胁视角 — 中间件漏洞

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/alarm/threat/app/middleware/list` | 中间件漏洞告警列表 | `start_time`, `end_time`, `offset`, `limit` |
| `GET` | `/alarm/threat/app/middleware/trend` | 中间件漏洞趋势图 | `start_time`, `end_time`, `interval` |

### 20.5 IOC中心 / 沙箱分析

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/alarm/ioc-center/sandbox-ioc` | 获取沙箱IOC列表 | `offset`, `limit` |
| `PUT` | `/alarm/ioc-center/sandbox-ioc` | 更新沙箱IOC状态 | `ids`, `status` |
| `DELETE` | `/alarm/ioc-center/sandbox-ioc` | 删除沙箱IOC | `ids` |
| `GET` | `/alarm/ioc-center/sandbox-ioc-judge` | 获取IOC人工研判列表 | `offset`, `limit` |
| `POST` | `/alarm/ioc-center/sandbox-ioc-judge` | 提交IOC研判结论 | `ioc`, `judge_result`, `reason` |
| `DELETE` | `/alarm/ioc-center/sandbox-ioc-judge` | 撤销研判结论 | `ids` |
| `GET` | `/alarm/ioc-center/sandbox-ioc-white` | 获取IOC白名单列表 | `offset`, `limit` |
| `POST` | `/alarm/ioc-center/sandbox-ioc-white` | 新增IOC白名单 | `ioc`, `reason` |
| `PUT` | `/alarm/ioc-center/sandbox-ioc-white` | 编辑IOC白名单条目 | `id`, `reason` |
| `DELETE` | `/alarm/ioc-center/sandbox-ioc-white` | 删除IOC白名单 | `ids` |
| `GET` | `/alarm/ioc-center/sandbox-ioc-status` | 查询IOC沙箱状态 | `ioc` |
| `GET` | `/alarm/ioc-center/rule-ioc-count` | 规则IOC命中数量统计 | `start_time`, `end_time` |
| `GET` | `/alarm/ioc-center/operator-history` | IOC操作历史记录 | `ioc`, `offset`, `limit` |
| `GET` | `/alarm/ioc-center/judge-sandbox-report` | 获取沙箱分析报告 | `ioc` |

### 20.6 椒图/云锁联动

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/skyeye/v1/rsp_handle/yunsuo/block/list` | 云锁阻断规则有效策略列表 | `offset`, `limit` |
| `DELETE` | `/skyeye/v1/rsp_handle/yunsuo/block/list` | 删除云锁阻断策略 | `ids` |
| `GET` | `/asset/asset-perspective/alarm-params` | 资产视角告警参数 | `ip` |

---

## 21. 响应处置 — 工作流 & 编排

> Base paths: `/rsp_handle/...`, `/soar-alarm-input`, `/alarm/alarm/history-search/...`

### 21.1 工作流管理 (SOAR Playbook)

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `POST` | `/rsp_handle/execution/redirect` | **运行工作流** | `workflow_id`, `input` |
| `POST` | `/rsp_handle/workflow/redirect?server=playbook&api=workflows` | 创建工作流 | `name`, `input`, `output`, `steps` |
| `PUT` | `/rsp_handle/workflow/redirect?api=workflow/<id>&server=playbook` | 更新工作流 | `id`, `name`, `steps` |
| `DELETE` | `/rsp_handle/workflow/redirect?api=workflow/<id>&server=playbook` | 删除工作流 | `id` |
| `POST` | `/rsp_handle/import` | 导入工作流（ZIP包） | `file` |
| `GET` | `/rsp_handle/export` | 导出工作流 | `ids` |

### 21.2 任务脚本管理

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `POST` | `/rsp_handle/scripts/redirect?api=scripts/&server=workflow` | 新增任务脚本 | `name`, `type`, `input`, `output`, `image` |
| `PUT` | `/rsp_handle/scripts/redirect?api=scripts/<id>&server=workflow` | 编辑任务脚本 | `id`, `name`, `input`, `output` |
| `DELETE` | `/rsp_handle/scripts/redirect?api=scripts/<id>&server=workflow` | 删除任务脚本 | `id` |

> **Task script image**: Default Python image is `docker.arp.defer.cn/skyeye-workflow/python:2.7.16.286`. Script `input`/`output` follow JSON Schema format with `properties`, `required`, `propertyOrder` fields.

### 21.3 云锁阻断 & 联动处置

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/rsp_handle/yunsuo_block/list` | 云锁阻断规则列表（处置记录维度） | `offset`, `limit` |
| `POST` | `/soar-alarm-input` | 响应处置告警传入（SOAR触发入口） | `alarm_id`, `alarm_sip`, `attack_sip`, `threat_name` |

### 21.4 历史检索收藏

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/alarm/alarm/history-search/fav-name/list` | 历史检索收藏名称列表 | `offset`, `limit` |
| `GET` | `/alarm/alarm/history-search/fav-content/info` | 历史检索收藏内容详情 | `id` |

---

## 22. 重保 (HW Attack Protection Mode)

> Base paths: `/alarm/hw/...`, `/alarm/attack/...`, `/alarm/alarm/alarm-black-count`  
> HW mode = 重要保障 period, enhanced security operation mode

### 22.1 重保任务管理

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/alarm/hw/attack-team-list` | 重保任务列表 | `offset`, `limit` |
| `PUT` | `/alarm/hw/attack-team-list` | 修改重保对象（是否为靶标） | `id`, `is_target` (`0`/`1`) |
| `DELETE` | `/alarm/hw/attack-team-list` | 删除重保任务 | `ids` |
| `POST` | `/alarm/hw/attack-team-list` | 开始/暂停重保任务 | `id`, `action` (`start`/`pause`) |
| `GET` | `/alarm/hw/attack-stage-total` | 攻击阶段总计统计 | `start_time`, `end_time` |
| `GET` | `/alarm/alarm/alarm-black-count` | 威胁检测告警数量（重保统计视图） | `start_time`, `end_time` |
| `GET` | `/alarm/attack/hw-attack-stage` | HW攻击阶段分布（阶段 vs 数量） | `start_time`, `end_time` |

**`/alarm/hw/attack-team-list` — Response fields**: `.id`, `.task_name`, `.start_time`, `.end_time`, `.status`(`running`/`paused`/`stopped`), `.is_target`, `.target_total`, `.alarm_count`, `.attack_ip_count`

### 22.2 重保对象 & 资产

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/alarm/hw/attack-team-list` (with `object_type=target`) | 获取当前重保对象 | `task_id` |
| `POST` | `/alarm/hw/attack-team-list` (with action body) | 新增/撤销重保对象 | `task_id`, `asset_ids`, `is_delete_old` |
| `GET` | `/alarm/hw/attack-team-list` (asset query) | 获取全部资产（重保范围选择） | `keyword`, `offset`, `limit` |

### 22.3 重保图片 & 提示

| Method | Path | Description | Required Params |
|--------|------|-------------|-----------------|
| `GET` | `/alarm/hw/attack-team-list` (image) | 获取重保图片 | `task_id`, `type`(`background`/`logo`) |
| `POST` | `/alarm/hw/attack-team-list` (image upload) | 上传重保图片 | `fp`(file), `type` |
| `GET` | `/alarm/hw/attack-team-list` (tips) | 获取提示列表 | `task_id` |
| `POST` | `/alarm/hw/attack-team-list` (tips) | 设置提示内容 | `task_id`, `content` |

---

*Document compiled from 26 source .doc files + API manual — totaling 600+ API endpoints across 22 modules of the TianYan Analysis Platform v30140.sp2. Last updated: 2026-06-25.*
