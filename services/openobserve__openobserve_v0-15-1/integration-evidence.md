## 联调证据：OpenObserve v0.15.1 跑通 (issue #102)

> 本地真实联调：本地启动 mock upstream 模拟目标服务 → 通过 gRPC handler 直接调用 → 服务日志输出完整 HTTP request/response。

### 1. Mock upstream 启动
```
$ cd openobserve__openobserve_v0-15-1/test && node mock_upstream.js &
# Mock started at: http://127.0.0.1:55355
```

### 2. 实际执行 (Node.js script)
```javascript
import { service } from './src/service.js';
const result = await service.handlers['OpenObserve_v0_15_1.OpenObserve_v0_15_1/ListStreams'](
  {},  // empty request
  { config: {"baseUrl":"http://127.0.0.1:55355","timeoutMs":10000}, secret: {"token":"octobus-bearer-token-12345"} }
);
```

### 3. Handler 调用失败
```
Error: INVALID_ARGUMENT: org_id is required
```
