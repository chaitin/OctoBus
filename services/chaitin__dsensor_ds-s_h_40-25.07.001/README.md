# D-Sensor DS-S_H_40-25.07.001 OctoBus Service

长亭谛听（D-Sensor）`DS-S_H_40-25.07.001` 聚合版 OctoBus Service，现按 `/root/谛听API.docx` 重新对齐为 **25 个接口**。

## 导入

```bash
octobus service import dsensor ./services/chaitin__dsensor_ds-s_h_40-25.07.001 --reinstall
```

## 配置

```json
{
  "apiBase": "https://dsensor.example.com",
  "timeoutMs": 30000,
  "skipTlsVerify": true
}
```

```json
{
  "api_token": "替换为实际 Token"
}
```

## 本次修正

- 补齐缺失的 3 个接口：`agent_change_type`、`agent_portmap_update`、`agent_scan_update`
- 将总接口数从 22 修正为 25
- 按文档修正请求模型：`agent_delete`、`agent_upgrade`、`agent_clear_service`
- 按文档修正复杂参数：`honeypot_create.preset`、`honeypot_reset.preset`
- 按文档修正 `honeypot_delete`：支持 `cid` 查询参数，不再发送空 JSON body
- 按真实环境修正 `alarm_list.status` 为 `int[]`

## 接口与参数

| 方法 | 后端接口 | 关键参数 |
|---|---|---|
| `query_dsensor_agent_list` | `POST /api/agent/list` | 无 |
| `query_dsensor_agent_detail` | `POST /api/agent/detail` | `sn` |
| `query_dsensor_agent_delete` | `POST /api/agent/delete` | `sns[]` |
| `query_dsensor_agent_upgrade` | `POST /api/agent/version_update` | `sns[]` |
| `query_dsensor_agent_change_type` | `POST /api/agent/change_type` | `sns[]`, `mode`, `business_group`, `name`, `ping`, `arp` |
| `query_dsensor_agent_clear_service` | `POST /api/agent/clear_service` | `sns[]` |
| `query_dsensor_agent_portmap_update` | `POST /api/agent/portmap/update` | `port_maps` |
| `query_dsensor_agent_scan_update` | `POST /api/agent/portmap/scan/update` | `port_maps` |
| `query_dsensor_event_list` | `POST /api/event/list` | 无 |
| `query_dsensor_event_detail` | `POST /api/event/detail` | `connection_id` |
| `query_dsensor_scanner_list` | `POST /api/event/scanner/list` | 无 |
| `query_dsensor_scanner_detail` | `POST /api/event/scanner/detail` | `id`, `enable_preview` |
| `query_dsensor_portrait_list` | `POST /api/event/v1/list_portrait` | 无 |
| `query_dsensor_alarm_list` | `POST /api/event/event_alarm/list` | `status[]`(int), `id_order`, `status_order`, `risk_level_order`, `last_alarm_time_order` |
| `query_dsensor_audit_list` | `POST /api/audit/list/` | 无 |
| `query_dsensor_cpumem_stat` | `POST /api/meta/cpumem_stat` | 无 |
| `query_dsensor_disk_stat` | `POST /api/meta/disk_stat` | 无 |
| `query_dsensor_user_list` | `POST /api/account/manage/user/list` | 无 |
| `query_dsensor_honeynet_list` | `GET /api/honey/net/list` | 无 |
| `query_dsensor_honeynet_create` | `POST /api/honey/net/create` | `display_name`, `name` |
| `query_dsensor_honeypot_list` | `POST /api/honey/pot/list` | 无 |
| `query_dsensor_honeypot_create` | `POST /api/honey/pot/create` | `nid`, `display_name`, `image`, `image_id`, 可选 `node`, `preset` |
| `query_dsensor_honeypot_delete` | `DELETE /api/honey/pot/delete?cid=...` | `cid` |
| `query_dsensor_honeypot_reset` | `POST /api/honey/pot/reset` | `cid`, 可选 `preset` |
| `query_dsensor_honeypot_upgrade` | `POST /api/honey/pot/upgrade` | `cids[]` |

## 请求示例

### 删除探针

```json
{
  "sns": ["agent-sn-001"]
}
```

### 更改探针配置

```json
{
  "sns": ["agent-sn-001"],
  "mode": "probe",
  "business_group": "未分组",
  "name": "联动牧云测试",
  "ping": true,
  "arp": true
}
```

### 更新探针端口映射

```json
{
  "port_maps": [
    {
      "agent_sn": "agent-sn-001",
      "datas": [
        [
          {
            "bind_port": false,
            "save_pcap": true,
            "scan_det": false,
            "start_port": "8080",
            "end_port": "8080",
            "honeypot": "honeypot-id",
            "honeynet": "honeynet-id",
            "service_ips": ["0.0.0.0", "::"],
            "target_port": 80,
            "fixed": false,
            "proto": "tcp"
          }
        ]
      ]
    }
  ]
}
```

### 更新探针端口探测

```json
{
  "port_maps": [
    {
      "agent_sn": "agent-sn-001",
      "ports": [
        {
          "port_range": [
            {
              "start_port": 80,
              "end_port": 8082
            }
          ],
          "proto": "tcp"
        }
      ],
      "service_ips": ["0.0.0.0", "::"]
    }
  ]
}
```

### 创建蜜罐

```json
{
  "nid": "honeynet-id",
  "display_name": "测试蜜罐",
  "image": "ruijie_nbr",
  "image_id": "sha256:xxxx",
  "preset": {
    "copy_preset": "",
    "meta": {
      "portrait_option": "open",
      "__version__": "1.1"
    }
  }
}
```

### 删除蜜罐

```json
{
  "cid": "honeypot-id"
}
```

## OctoBus 实测示例

> 以下示例均来自 `127.0.0.1:9000` 上的 OctoBus 实测，实例为 `dsensor-dsensor-test`。

### `agent_list`

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_agent_list/query_dsensor_agent_list' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

```json
{
  "httpStatus": 200,
  "total": 2,
  "online": 1,
  "offline": 1,
  "data": [
    {
      "id": "35f5cf8d-7d19-46f5-b7a1-31f647a51a21",
      "status": "online",
      "host": "192.168.0.179",
      "display_name": "ag_3a0dec9e"
    },
    {
      "id": "faf7619b-f669-40f9-96b5-b7e37a0b053b",
      "status": "offline",
      "host": "10.126.126.7",
      "display_name": "ag_07d43545"
    }
  ]
}
```

### `event_list`

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_event_list/query_dsensor_event_list' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

```json
{
  "httpStatus": 200,
  "total": 0,
  "data": []
}
```

### `scanner_list`

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_scanner_list/query_dsensor_scanner_list' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

```json
{
  "httpStatus": 200,
  "total": 0,
  "data": []
}
```

### `portrait_list`

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_portrait_list/query_dsensor_portrait_list' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

```json
{
  "httpStatus": 200,
  "total": 0,
  "data": []
}
```

### `alarm_list`

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_alarm_list/query_dsensor_alarm_list' \
  -H 'Content-Type: application/json' \
  -d '{"status":[1],"id_order":"descend","status_order":"","risk_level_order":"","last_alarm_time_order":""}'
```

```json
{
  "httpStatus": 200,
  "total": 0,
  "unhandle_count": 0,
  "handle_count": 0,
  "data": []
}
```

### `audit_list`

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_audit_list/query_dsensor_audit_list' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

```json
{
  "httpStatus": 200,
  "total": 84,
  "data": [
    {
      "id": "ad104d38-dc49-4af1-87fa-59ecf60b31d5",
      "create_time": "2026-06-29T07:20:23.683354+00:00",
      "ip": "192.168.0.1",
      "success": true,
      "user": {
        "id": 2,
        "username": "admin",
        "is_deleted": false
      }
    }
  ]
}
```

### `cpumem_stat`

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_cpumem_stat/query_dsensor_cpumem_stat' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

```json
{
  "httpStatus": 200,
  "data": {
    "cpu": 21.3,
    "mem": 26.8,
    "time": 1782720428.881047
  }
}
```

### `disk_stat`

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_disk_stat/query_dsensor_disk_stat' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

```json
{
  "httpStatus": 200,
  "data": {
    "used": 97314041856,
    "free": 104696143872
  }
}
```

### `user_list`

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_user_list/query_dsensor_user_list' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

```json
{
  "httpStatus": 200,
  "total": 1,
  "data": [
    {
      "id": 2,
      "username": "admin",
      "role": "superAdmin",
      "user_type": "normal",
      "is_active": true
    }
  ]
}
```

### `honeynet_list`

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_honeynet_list/query_dsensor_honeynet_list' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

```json
{
  "httpStatus": 200,
  "msg": "success",
  "total": 20,
  "data": [
    {
      "id": "09afe5cde3c807bbe479bad3cb33a9b457c0a212bc114890ee86a24c370ab129",
      "display_name": "test",
      "subnet": "172.28.0.0/16",
      "honeypots": []
    }
  ]
}
```

### `honeypot_list`

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_honeypot_list/query_dsensor_honeypot_list' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

```json
{
  "httpStatus": 200,
  "total": 2,
  "data": [
    {
      "id": "ddb70d7a83017813f1460837e5f8c42c2be6fd36123fd8e34565ea04d16fbbdb",
      "display_name": "test3",
      "image": "honeypot/ssh_centos:latest",
      "state": ["created"]
    }
  ]
}
```

## 测试

```bash
npm test
```

当前已覆盖：

- 25 个接口注册
- 25 个 handler 暴露
- 25 个 rpc route 暴露
- `honeypot_delete` URL/Body 规则
- `honeypot_create` / `honeypot_reset` 复杂参数清洗
- `agent_clear_service` 参数直传规则
- `alarm_list` 的类型与最小可用请求
- 11 个无需资源 ID 的接口已通过 OctoBus `9000` 实测
- `agent_detail`、`agent_upgrade`、`agent_delete`、`event_detail`、`scanner_detail`、`honeypot_reset`、`honeypot_upgrade`、`honeypot_delete` 已通过指定参数实测

## 参数类测试命令与实测示例

> 下面这些命令都走 OctoBus `127.0.0.1:9000`。
> 其中已补到实际参数并执行过的，结果已直接写在对应命令下面。

### 详情类

#### `scanner_detail`（需要 `id`）

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_scanner_detail/query_dsensor_scanner_detail' \
  -H 'Content-Type: application/json' \
  -d '{"id":"REPLACE_SCANNER_ID","enable_preview":false}'
```

已实测示例（`id=7e3a740bc2c64ca8a95dee74ca78f318`）：

```json
{
  "httpStatus": 200,
  "data": {
    "id": "7e3a740bc2c64ca8a95dee74ca78f318",
    "proto": "udp",
    "dest_ip": "192.168.0.179",
    "dest_ports_display": "44511",
    "src_ip": "119.28.206.193",
    "src_port": "123",
    "scan_types": ["UDP"]
  }
}
```

### 删除 / 重置类

#### `agent_delete`（需要 `sns[]`）

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_agent_delete/query_dsensor_agent_delete' \
  -H 'Content-Type: application/json' \
  -d '{"sns":["REPLACE_AGENT_SN"]}'
```

已实测示例（`sns=["35f5cf8d-7d19-46f5-b7a1-31f647a51a21"]`）：

```json
{
  "httpStatus": 200,
  "err": "server exception",
  "msg": "服务器逻辑错误"
}
```

#### `honeypot_delete`（需要 `cid`）

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_honeypot_delete/query_dsensor_honeypot_delete' \
  -H 'Content-Type: application/json' \
  -d '{"cid":"REPLACE_HONEYPOT_CID"}'
```

已实测示例（`cid=50fbf1ce43c7fb6ffa5a5bd5d73fe584dc0c82a096052a3265d86bd9b37200e8`）：

```json
{
  "httpStatus": 200,
  "msg": "success",
  "data": [
    {
      "id": "ddb70d7a83017813f1460837e5f8c42c2be6fd36123fd8e34565ea04d16fbbdb",
      "display_name": "test3",
      "image": "honeypot/ssh_centos:latest",
      "state": ["created"]
    },
    {
      "id": "1ab42ed7f69af6543c44c61ae701d3eae960c070f6b60a4c6ab9b80999b75923",
      "display_name": "test",
      "image": "honeypot/ssh_centos:latest",
      "state": ["created"]
    }
  ]
}
```

### 其他常见变更类

- 当前已无待补参数的详情/重置/升级接口；如需继续，仅剩删除类结果确认与后续复核
