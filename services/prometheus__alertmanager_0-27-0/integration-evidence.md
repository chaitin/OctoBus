## 联调证据：Prometheus Alertmanager 0.27.0 跑通 (issue #107)

> 本地真实联调：本地启动 mock upstream 模拟目标服务 → 通过 gRPC handler 直接调用 → 服务日志输出完整 HTTP request/response。

### 1. Mock upstream 启动
```
$ cd prometheus__alertmanager_0-27-0/test && node mock_upstream.js &
# Mock started at: http://127.0.0.1:55357
```

### 2. 实际执行 (Node.js script)
```javascript
import { service } from './src/service.js';
const result = await service.handlers['Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/ListAlerts'](
  {},  // empty request
  { config: {"baseUrl":"http://127.0.0.1:55357","timeoutMs":10000}, secret: {} }
);
```

### 3. 上游 API 实际响应体 (handler.raw_body 解析)
```json
[
  {
    "fingerprint": "abc123",
    "startsAt": "2026-01-01T00:00:00Z",
    "endsAt": "0001-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:01:00Z",
    "generatorURL": "http://prom:9090/graph",
    "labels": {
      "alertname": "HighErrorRate",
      "severity": "critical"
    },
    "annotations": {
      "summary": "High error rate"
    },
    "status": {
      "state": [
        "active"
      ],
      "silencedBy": [],
      "inhibitedBy": []
    }
  }
]
```

### 4. gRPC Response (handler 返回值)
```json
{
  "status": "success",
  "alerts": [
    {
      "fingerprint": "abc123",
      "starts_at": "2026-01-01T00:00:00Z",
      "ends_at": "0001-01-01T00:00:00Z",
      "updated_at": "2026-01-01T00:01:00Z",
      "generator_url": "http://prom:9090/graph",
      "labels": [
        {
          "name": "alertname",
          "value": "HighErrorRate"
        },
        {
          "name": "severity",
          "value": "critical"
        }
      ],
      "annotations": [
        {
          "name": "summary",
          "value": "High error rate"
        }
      ],
      "status_state": [
        "active"
      ],
      "raw_json": "{\"fingerprint\":\"abc123\",\"startsAt\":\"2026-01-01T00:00:00Z\",\"endsAt\":\"0001-01-01T00:00:00Z\",\"updatedAt\":\"2026-01-01T00:01:00Z\",\"generatorURL\":\"http://prom:9090/graph\",\"labels\":{\"alertname\":\"HighErrorRate\",\"severity\":\"critical\"},\"annotations\":{\"summary\":\"High error rate\"},\"status\":{\"state\":[\"active\"],\"silencedBy\":[],\"inhibitedBy\":[]}}"
    }
  ]
}
```
