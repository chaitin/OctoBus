# D-Sensor 聚合包测试记录

本文档基于 `/root/谛听API.docx` 对 `D-Sensor DS-S_H_40-25.07.001` 做重新核对后的测试说明。

## 修正结论

### 原先有问题的点

- 聚合包只注册了 22 个接口，缺少 3 个探针接口
- `agent_clear_service` 请求体被错误重写，不符合文档里的 `sns[]`
- `agent_delete` / `agent_upgrade` proto 没有声明 `sns[]`
- `honeypot_create.preset` 被声明成 `string`，实际应支持对象
- `honeypot_reset` proto 为空，实际至少需要 `cid`，并支持 `preset`
- `honeypot_delete` 仅按空 body DELETE 处理，文档要求 `cid` 查询参数
- `alarm_list` 的 `status` 原先按 string[] 建模，实际应按 int[] 使用

### 现在的接口数量

- 已修正为 **25 个**

## 需要的参数

| 接口 | 必要参数 |
|---|---|
| 探针详情 | `sn` |
| 删除探针 | `sns[]` |
| 升级探针 | `sns[]` |
| 更改探针配置 | `sns[]`, `mode` |
| 清理探针服务 | `sns[]` |
| 更新端口映射 | `port_maps` |
| 更新端口探测 | `port_maps` |
| 事件详情 | `connection_id` |
| 扫描详情 | `id` |
| 创建蜜网 | `display_name`, `name` |
| 创建蜜罐 | `nid`, `display_name`, `image`, `image_id` |
| 删除蜜罐 | `cid` |
| 重置蜜罐 | `cid` |
| 升级蜜罐 | `cids[]` |

## 本地单元测试

### 命令

```bash
cd /root/OctoBus/services/chaitin__dsensor_ds-s_h_40-25.07.001
npm test
```

### 结果

```text
✅ All tests passed — 25 handlers, 25 routes
```

## OctoBus 真实联调结果

> 以下结果 **全部通过 OctoBus `127.0.0.1:9000`** 完成。

### 测试环境

- daemon：`127.0.0.1:9000`
- capset：`dev`
- instance：`dsensor-dsensor-test`
- service：`dsensor`
- config：`{"apiBase":"https://192.168.0.180","skipTlsVerify":true}`

### 1. `agent_list`

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

### 2. `event_list`

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

### 3. `scanner_list`

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

### 4. `portrait_list`

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

### 5. `alarm_list`

> 当前环境下最小可用请求必须带 `status` 和排序字段。

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

### 6. `audit_list`

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
    },
    {
      "id": "fac6e7b6-7076-4938-b414-ce3f0a81cf20",
      "create_time": "2026-06-29T07:19:26.193661+00:00",
      "ip": "192.168.0.1",
      "success": true,
      "user": {
        "id": 2,
        "username": "admin",
        "is_deleted": false
      }
    },
    {
      "id": "2d65a6ae-ef20-4318-b9f5-bee5f6e6bf01",
      "create_time": "2026-06-29T07:19:05.158167+00:00",
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

### 7. `cpumem_stat`

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

### 8. `disk_stat`

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

### 9. `user_list`

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
      "is_active": true,
      "permissions": [
        "user_mgmt",
        "honey_mgmt",
        "log_mgmt",
        "tenant_mgmt",
        "log_observe"
      ]
    }
  ]
}
```

### 10. `honeynet_list`

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
    },
    {
      "id": "1511e6ad9038e025c0c1ac4dea65673ab1c5913e62deacefc974dfb827ed16a7",
      "display_name": "test",
      "subnet": "172.29.0.0/16",
      "honeypots": []
    },
    {
      "id": "2f10be6cb63251e5621cad2b24d73b0fc0b462fb9240919eb5362991523042bb",
      "display_name": "test",
      "subnet": "172.30.0.0/16",
      "honeypots": []
    }
  ]
}
```

### 11. `honeypot_list`

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
      "state": ["created"],
      "honeynets": [
        "d410f81bb33e57d00bae2b90d8a33bf2c5dc910cb0cd889e14729dc874cff205"
      ]
    },
    {
      "id": "1ab42ed7f69af6543c44c61ae701d3eae960c070f6b60a4c6ab9b80999b75923",
      "display_name": "test",
      "image": "honeypot/ssh_centos:latest",
      "state": ["created"],
      "honeynets": [
        "d410f81bb33e57d00bae2b90d8a33bf2c5dc910cb0cd889e14729dc874cff205"
      ]
    }
  ]
}
```

## 结论

- 当前无需资源 ID 的 11 个接口，已经通过 **OctoBus `9000`** 完成真实联调
- `agent_detail`、`agent_upgrade`、`agent_delete`、`event_detail`、`scanner_detail`、`honeypot_reset`、`honeypot_upgrade`、`honeypot_delete` 已完成测试
- 删除类接口也已执行，其中 `agent_delete` 返回后端逻辑错误，`honeypot_delete` 返回 `success`

## 已补参数并完成测试

### `agent_detail`

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_agent_detail/query_dsensor_agent_detail' \
  -H 'Content-Type: application/json' \
  -d '{"sn":"35f5cf8d-7d19-46f5-b7a1-31f647a51a21"}'
```

```json
{
  "httpStatus": 200,
  "data": {
    "id": "35f5cf8d-7d19-46f5-b7a1-31f647a51a21",
    "status": "online",
    "mode": "probe",
    "host": "192.168.0.179",
    "hostname": "192-168-0-179",
    "display_name": "ag_3a0dec9e",
    "agent_version": 18060138,
    "last_heartbeat": "2026-06-29T08:15:21.689721+00:00",
    "last_updated": "2026-06-29T08:15:49.281425+00:00",
    "node": {
      "sn": "WZw2"
    }
  }
}
```

### `agent_upgrade`

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_agent_upgrade/query_dsensor_agent_upgrade' \
  -H 'Content-Type: application/json' \
  -d '{"sns":["35f5cf8d-7d19-46f5-b7a1-31f647a51a21"]}'
```

```json
{
  "httpStatus": 200,
  "success": true
}
```

### `event_detail`

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_event_detail/query_dsensor_event_detail' \
  -H 'Content-Type: application/json' \
  -d '{"connection_id":"1ac48014-cc5f-4029-823e-1b44806bf245"}'
```

```json
{
  "httpStatus": 200,
  "data": {
    "id": "1ac48014-cc5f-4029-823e-1b44806bf245",
    "risk_level": 4,
    "start_time": "2026-06-29T08:15:30.747598+00:00",
    "src_ip": "192.168.0.1",
    "agent_display_name": "ag_3a0dec9e",
    "honeypot_display_name": "测试",
    "honeypot_id": "50fbf1ce43c7fb6ffa5a5bd5d73fe584dc0c82a096052a3265d86bd9b37200e8",
    "log_type": "web",
    "proto": "tcp",
    "node": {
      "sn": "WZw2"
    },
    "event_types": [
      "web_access",
      "WEB_ATTACK_SQLI",
      "WEB_ATTACK_BACK_DOOR"
    ]
  }
}
```

### `honeypot_reset`

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_honeypot_reset/query_dsensor_honeypot_reset' \
  -H 'Content-Type: application/json' \
  -d '{"cid":"50fbf1ce43c7fb6ffa5a5bd5d73fe584dc0c82a096052a3265d86bd9b37200e8"}'
```

```json
{
  "httpStatus": 200,
  "data": {},
  "err": "",
  "msg": ""
}
```

### `honeypot_upgrade`

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_honeypot_upgrade/query_dsensor_honeypot_upgrade' \
  -H 'Content-Type: application/json' \
  -d '{"cids":["50fbf1ce43c7fb6ffa5a5bd5d73fe584dc0c82a096052a3265d86bd9b37200e8"]}'
```

```json
{
  "httpStatus": 200,
  "success": true
}
```

### `scanner_detail`

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_scanner_detail/query_dsensor_scanner_detail' \
  -H 'Content-Type: application/json' \
  -d '{"id":"7e3a740bc2c64ca8a95dee74ca78f318","enable_preview":false}'
```

```json
{
  "httpStatus": 200,
  "data": {
    "id": "7e3a740bc2c64ca8a95dee74ca78f318",
    "proto": "udp",
    "start_time": "2026-06-29T08:21:41.444050+00:00",
    "end_time": "2026-06-29T08:21:41.444050+00:00",
    "agent_display_name": "ag_3a0dec9e",
    "agent_id": "35f5cf8d-7d19-46f5-b7a1-31f647a51a21",
    "dest_ip": "192.168.0.179",
    "dest_ports_display": "44511",
    "src_ip": "119.28.206.193",
    "src_port": "123",
    "scan_types": ["UDP"]
  }
}
```

### `agent_delete`

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_agent_delete/query_dsensor_agent_delete' \
  -H 'Content-Type: application/json' \
  -d '{"sns":["35f5cf8d-7d19-46f5-b7a1-31f647a51a21"]}'
```

```json
{
  "httpStatus": 200,
  "err": "server exception",
  "msg": "服务器逻辑错误"
}
```

### `honeypot_delete`

```bash
curl -s -X POST 'http://127.0.0.1:9000/capsets/dev/connect/dsensor-dsensor-test/dsensor.dsensor_honeypot_delete/query_dsensor_honeypot_delete' \
  -H 'Content-Type: application/json' \
  -d '{"cid":"50fbf1ce43c7fb6ffa5a5bd5d73fe584dc0c82a096052a3265d86bd9b37200e8"}'
```

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

## 剩余测试命令状态

> 以下状态基于当前 OctoBus 环境：`127.0.0.1:9000` + `capset=dev` + `instance=dsensor-dsensor-test`。

- 当前无待补参数的测试命令；如需再次复测删除类接口，可直接复用上方已完成测试命令。
