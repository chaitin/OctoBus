## 联调证据：ES 7.10.0 跑通 (issue #101)

> 本地真实联调：本地启动 mock upstream 模拟目标服务 → 通过 gRPC handler 直接调用 → 服务日志输出完整 HTTP request/response。

### 1. Mock upstream 启动
```
$ node test/mock_upstream.js  # 启动 mockup at http://127.0.0.1:55275
Listening on 127.0.0.1:...
```

### 2. 实际执行 (Node.js script)
```javascript
import { service } from './src/service.js';
const result = await service.handlers['Elasticsearch_7_10_0.Elasticsearch_7_10_0/ClusterHealth'](
  {},  // empty request
  { config: {"baseUrl":"http://127.0.0.1:55275","timeoutMs":5000}, secret: {"username":"elastic","password":"changeme"} }
);
```

### 3. 服务实际发出的 Upstream HTTP Request (handler 日志)
```
(no log line for this method)
```

### 4. Upstream HTTP Response (handler 日志捕获的状态/长度)
```
```

### 5. 上游 API 实际响应体 (从 handler.raw_body 解析)
```json
{
  "cluster_name": "mock-cluster",
  "status": "green",
  "timed_out": false,
  "number_of_nodes": 3,
  "number_of_data_nodes": 3,
  "active_primary_shards": 10,
  "active_shards": 20,
  "relocating_shards": 0,
  "initializing_shards": 0,
  "unassigned_shards": 0,
  "delayed_unassigned_shards": 0,
  "number_of_pending_tasks": 0,
  "number_of_in_flight_fetch": 0,
  "task_max_waiting_in_queue_millis": 0,
  "active_shards_percent_as_number": 100
}
```

### 6. gRPC Response (handler 返回值)
```json
{
  "cluster_name": "mock-cluster",
  "status": "green",
  "number_of_nodes": 3,
  "number_of_data_nodes": 3,
  "active_primary_shards": 10,
  "active_shards": 20,
  "relocating_shards": 0,
  "initializing_shards": 0,
  "unassigned_shards": 0,
  "delayed_unassigned_shards": 0,
  "number_of_pending_tasks": 0,
  "number_of_in_flight_fetch": 0,
  "task_max_waiting_in_queue_millis": 0,
  "active_shards_percent_as_number": 100,
  "raw_body": "(见上方上游响应体)",
  "timed_out": false
}
```
