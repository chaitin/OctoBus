## Mock 联调记录：ListNodes

以下内容来自 `test/mock_upstream.js`，仅验证请求构造和响应解析，不是
Proxmox VE 8.3.5 真实环境兼容性证据。

# Request
```
GET https://<pve-host>:8006/api2/json/nodes
Authorization: PVEAPIToken=root@pam!automation=<redacted>
```

# Response   HTTP/1.1 200 OK
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
