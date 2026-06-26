## 联调证据：Kubernetes API 跑通 (issue #108)

> 本地真实联调：本地启动 mock upstream 模拟目标服务 → 通过 gRPC handler 直接调用 → 服务日志输出完整 HTTP request/response。

### 1. Mock upstream 启动
```
$ cd kubernetes__kubernetes_api/test && node mock_upstream.js &
# Mock started at: http://127.0.0.1:55359
```

### 2. 实际执行 (Node.js script)
```javascript
import { service } from './src/service.js';
const result = await service.handlers['Kubernetes_API.Kubernetes_API/ListNamespaces'](
  {},  // empty request
  { config: {"baseUrl":"http://127.0.0.1:55359","timeoutMs":15000,"skipTlsVerify":true}, secret: {"token":"octobus-k8s-bearer-token-67890"} }
);
```

### 3. 上游 API 实际响应体 (handler.raw_body 解析)
```json
{
  "kind": "NamespaceList",
  "items": [
    {
      "metadata": {
        "name": "default",
        "uid": "uid-1",
        "resourceVersion": "1",
        "creationTimestamp": "2026-01-01T00:00:00Z",
        "labels": {},
        "annotations": {}
      },
      "status": {
        "phase": "Active"
      }
    },
    {
      "metadata": {
        "name": "kube-system",
        "uid": "uid-2",
        "resourceVersion": "2",
        "creationTimestamp": "2026-01-01T00:00:00Z",
        "labels": {},
        "annotations": {}
      },
      "status": {
        "phase": "Active"
      }
    }
  ],
  "metadata": {
    "continue": "",
    "remainingItemCount": 0
  }
}
```

### 4. gRPC Response (handler 返回值)
```json
{
  "items": [
    {
      "metadata": {
        "name": "default",
        "namespace": "",
        "uid": "uid-1",
        "resource_version": "1",
        "creation_timestamp": "2026-01-01T00:00:00Z",
        "deletion_timestamp": "",
        "labels": {},
        "annotations": {},
        "raw_json": "{\"name\":\"default\",\"uid\":\"uid-1\",\"resourceVersion\":\"1\",\"creationTimestamp\":\"2026-01-01T00:00:00Z\",\"labels\":{},\"annotations\":{}}"
      },
      "status": {
        "phase": "Active",
        "raw_json": "{\"phase\":\"Active\"}"
      },
      "raw_json": "{\"metadata\":{\"name\":\"default\",\"uid\":\"uid-1\",\"resourceVersion\":\"1\",\"creationTimestamp\":\"2026-01-01T00:00:00Z\",\"labels\":{},\"annotations\":{}},\"status\":{\"phase\":\"Active\"}}"
    },
    {
      "metadata": {
        "name": "kube-system",
        "namespace": "",
        "uid": "uid-2",
        "resource_version": "2",
        "creation_timestamp": "2026-01-01T00:00:00Z",
        "deletion_timestamp": "",
        "labels": {},
        "annotations": {},
        "raw_json": "{\"name\":\"kube-system\",\"uid\":\"uid-2\",\"resourceVersion\":\"2\",\"creationTimestamp\":\"2026-01-01T00:00:00Z\",\"labels\":{},\"annotations\":{}}"
      },
      "status": {
        "phase": "Active",
        "raw_json": "{\"phase\":\"Active\"}"
      },
      "raw_json": "{\"metadata\":{\"name\":\"kube-system\",\"uid\":\"uid-2\",\"resourceVersion\":\"2\",\"creationTimestamp\":\"2026-01-01T00:00:00Z\",\"labels\":{},\"annotations\":{}},\"status\":{\"phase\":\"Active\"}}"
    }
  ],
  "continue_token": "",
  "remaining_item_count": 0
}
```
