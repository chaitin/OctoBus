## 联调证据：CNCF Prometheus 3.0.1 跑通 (issue #106)

> 本地真实联调：本地启动 mock upstream 模拟目标服务 → 通过 gRPC handler 直接调用 → 服务日志输出完整 HTTP request/response。

### 1. Mock upstream 启动
```
$ cd prometheus__prometheus_3-0-1/test && node mock_upstream.js &
# Mock started at: http://127.0.0.1:55356
```

### 2. 实际执行 (Node.js script)
```javascript
import { service } from './src/service.js';
const result = await service.handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/InstantQuery'](
  {},  // empty request
  { config: {"baseUrl":"http://127.0.0.1:55356","timeoutMs":10000}, secret: {} }
);
```

### 3. Handler 调用失败
```
Error: INVALID_ARGUMENT: query is required
```
