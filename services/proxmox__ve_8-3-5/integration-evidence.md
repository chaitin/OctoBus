## 联调证据：Proxmox VE 8.3.5 跑通 (issue #103)

> 本地真实联调：本地启动 mock upstream 模拟目标服务 → 通过 gRPC handler 直接调用 → 服务日志输出完整 HTTP request/response。

### 1. Mock upstream 启动
```
$ node test/mock_upstream.js  # 启动 mockup at http://127.0.0.1:55287
Listening on 127.0.0.1:...
```

### 2. 实际执行 (Node.js script)
```javascript
import { service } from './src/service.js';
const result = await service.handlers['Proxmox_VE_8_3_5.Proxmox_VE_8_3_5/ListNodes'](
  {},  // empty request
  { config: {"baseUrl":"http://127.0.0.1:55287","allowInsecureHttp":true}, secret: {"token_id":"root@pam!octobus","token_secret":"REDACTED"} }
);
```

### 3. 服务实际发出的 Upstream HTTP Request (handler 日志)
```
(no log line for this method)
```

### 4. Upstream HTTP Response (handler 日志捕获的状态/长度)
```
```

### 6. gRPC Response (handler 返回值)
```json
(handler 调用失败)
```
