## Mock Integration Evidence: ListNodes successful

This transcript was produced by the local `test/mock_upstream.js` fixture. It
validates request construction and response decoding, but it is not evidence
of compatibility with a real Proxmox VE 8.3.5 installation.

# Request
```
https://<pve-host>:8006/api2/json/nodes
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
