## 联调证据：CNCF Prometheus 3.0.1 跑通 (issue #106)

> 本地真实联调：本地启动 mock upstream 模拟目标服务 → 通过 gRPC handler 直接调用 → 服务日志输出完整 HTTP request/response。

### 1. Mock upstream 启动
```
$ cd prometheus__prometheus_3-0-1/test && node mock_upstream.js &
# Mock started at: http://127.0.0.1:55395
```

### 2. 实际执行 (Node.js script)
```javascript
import { service } from './src/service.js';
const result = await service.handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/InstantQuery'](
  {},  // empty request
  { config: {"baseUrl":"http://127.0.0.1:55395","timeoutMs":10000}, secret: {} }
);
```

### 3. 上游 API 实际响应体 (handler.raw_body 解析)
```json
{
  "status": "success",
  "data": {
    "resultType": "vector",
    "result": [
      {
        "metric": {
          "__name__": "up",
          "job": "prometheus"
        },
        "value": [
          1625097600,
          "1"
        ]
      }
    ]
  }
}
```

### 4. gRPC Response (handler 返回值)
```json
{
  "status": "success",
  "result_type": "vector",
  "result": [
    {
      "metric": [
        {
          "name": "__name__",
          "value": "up"
        },
        {
          "name": "job",
          "value": "prometheus"
        }
      ],
      "values": [
        {
          "timestamp": 1625097600,
          "value": "1"
        }
      ]
    }
  ],
  "error_type": "",
  "error": "",
  "warnings": [],
  "infos": []
}
```
