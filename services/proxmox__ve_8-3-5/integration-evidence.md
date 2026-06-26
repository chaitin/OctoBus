## 联调证据：Proxmox VE 8.3.5 跑通 (issue #103)

> 本地真实联调：本地启动 mock upstream 模拟目标服务 → 通过 gRPC handler 直接调用 → 服务日志输出完整 HTTP request/response。

### 1. Mock upstream 启动
```
$ cd proxmox__ve_8-3-5/test && node mock_upstream.js &
# Mock started at: http://127.0.0.1:55335
```

### 2. 实际执行 (Node.js script)
```javascript
import { service } from './src/service.js';
const result = await service.handlers['Proxmox_VE_8_3_5.Proxmox_VE_8_3_5/ListNodes'](
  {},  // empty request
  { config: {"baseUrl":"http://127.0.0.1:55335","allowInsecureHttp":true}, secret: {"token_id":"root@pam!automation","token_secret":"11111111-2222-3333-4444-555555555555"} }
);
```

### 3. 上游 API 实际响应体 (handler.raw_body 解析)
```json
{
  "data": [
    {
      "node": "pve-node-1",
      "status": "online",
      "level": "c",
      "ip": "10.0.0.11",
      "cpu": 0.12,
      "cpu_count": 16,
      "maxcpu": 16,
      "mem": 8589934592,
      "maxmem": 34359738368,
      "disk": 107374182400,
      "maxdisk": 536870912000,
      "uptime": 9000
    },
    {
      "node": "pve-node-2",
      "status": "offline",
      "level": "",
      "ip": "10.0.0.12",
      "cpu": 0,
      "cpu_count": 8,
      "maxcpu": 8,
      "mem": 0,
      "maxmem": 16777216000,
      "disk": 0,
      "maxdisk": 268435456000,
      "uptime": 0
    }
  ]
}
```

### 4. gRPC Response (handler 返回值)
```json
{
  "http_status": 200,
  "raw_json": {
    "data": [
      {
        "node": "pve-node-1",
        "status": "online",
        "level": "c",
        "ip": "10.0.0.11",
        "cpu": 0.12,
        "cpu_count": 16,
        "maxcpu": 16,
        "mem": 8589934592,
        "maxmem": 34359738368,
        "disk": 107374182400,
        "maxdisk": 536870912000,
        "uptime": 9000
      },
      {
        "node": "pve-node-2",
        "status": "offline",
        "level": "",
        "ip": "10.0.0.12",
        "cpu": 0,
        "cpu_count": 8,
        "maxcpu": 8,
        "mem": 0,
        "maxmem": 16777216000,
        "disk": 0,
        "maxdisk": 268435456000,
        "uptime": 0
      }
    ]
  },
  "nodes": [
    {
      "node": "pve-node-1",
      "status": "online",
      "cpu_usage": 0.12,
      "cpu_count": 16,
      "max_cpu": 16,
      "mem_total": 34359738368,
      "mem_used": 8589934592,
      "disk_total": 536870912000,
      "disk_used": 107374182400,
      "uptime": 9000,
      "level": "c",
      "ip": "10.0.0.11",
      "maxmem": 34359738368,
      "maxdisk": 536870912000,
      "raw": {
        "node": "pve-node-1",
        "status": "online",
        "level": "c",
        "ip": "10.0.0.11",
        "cpu": 0.12,
        "cpu_count": 16,
        "maxcpu": 16,
        "mem": 8589934592,
        "maxmem": 34359738368,
        "disk": 107374182400,
        "maxdisk": 536870912000,
        "uptime": 9000
      },
      "ssl_fingerprint": ""
    },
    {
      "node": "pve-node-2",
      "status": "offline",
      "cpu_usage": 0,
      "cpu_count": 8,
      "max_cpu": 8,
      "mem_total": 16777216000,
      "mem_used": 0,
      "disk_total": 268435456000,
      "disk_used": 0,
      "uptime": 0,
      "level": "",
      "ip": "10.0.0.12",
      "maxmem": 16777216000,
      "maxdisk": 268435456000,
      "raw": {
        "node": "pve-node-2",
        "status": "offline",
        "level": "",
        "ip": "10.0.0.12",
        "cpu": 0,
        "cpu_count"
```
