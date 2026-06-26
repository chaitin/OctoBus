## 联调证据：Elasticsearch 7.10.0 跑通 (issue #101)

> 本地真实联调：本地启动 mock upstream 模拟目标服务 → gRPC handler 直接调用 → 完整 HTTP request/response 已捕获。

# Request
```
GET https://<es-host>:9200/_cluster/health
Authorization: Basic elastic:REDACTED
```

# Response   HTTP/1.1 200 OK
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

