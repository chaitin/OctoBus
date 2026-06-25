# 奇安信网神 SecVSS 3600 漏洞扫描系统

OctoBus service package for **奇安信网神 SecVSS 3600 漏洞扫描系统 V3.0** — 一款企业级主机漏洞扫描系统，通过异步任务模型对目标主机执行漏洞检测并输出多级别漏洞报告。

- **厂商 / 产品**: 奇安信 · 网神 SecVSS 3600 漏洞扫描系统
- **支持版本**: V3.0，`/async/` 路由
- **分类**: 漏洞管理 / 资产扫描
- **proto 包**: `QIANXIN_VS_SecVSS3600`
- **接口来源**: 《网神SecVSS 3600漏洞扫描系统V3.0-接口说明V1.0（20220810）》

## 认证方式

先调用 `GetToken` 获取令牌，后续所有请求 HTTP Header 中携带 `token: <value>`：

- `secret.user` + `secret.pwd` → `POST /async/login/token/` → `token`
- 令牌过期（errorcode 1013）⇒ 重新调用 `GetToken` 刷新

缺少 user/pwd ⇒ `INVALID_ARGUMENT`。

## 配置

| 字段 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `restBaseUrl` | **是** | — | 设备 REST 接口基础 URL，如 `https://secvss.example.com` |
| `timeoutMs` | 否 | `10000` | HTTP 超时（ms）|
| `tlsInsecureSkipVerify` | 否 | `false` | 跳过 TLS 证书校验（内网自签证书场景）|

Secret：

| 字段 | 必填 | 说明 |
|------|------|------|
| `user` | **是** | 设备登录用户名 |
| `pwd` | **是** | 设备登录密码 |

配置示例：

```json
{
  "config": { "restBaseUrl": "https://secvss.example.com", "timeoutMs": 5000 },
  "secret": { "user": "admin", "pwd": "Admin@123" }
}
```

## 方法

### GetToken — 获取认证令牌

**端点**：`POST /async/login/token/`

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `user` | string | 否 | 用户名（优先取 req，回退 secret.user）|
| `pwd` | string | 否 | 密码（优先取 req，回退 secret.pwd）|

**请求体**：

```json
{ "user": "admin", "pwd": "Admin@123" }
```

**返回示例**：

```json
{
  "success": true,
  "token": "a1b2c3d4e5f6789012345678901234567890abcd"
}
```

**错误返回**：

```json
{ "success": false, "errorcode": 1002, "errormsg": "用户名或密码错误" }
```

---

### SubmitScanTask — 提交漏洞扫描任务

**端点**：`POST /async/scan/task/`

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `token` | string | **是** | GetToken 返回的令牌 |
| `target` | string | **是** | 扫描目标，支持 IP / CIDR / 域名，如 `192.168.1.0/24` |
| `taskname` | string | 否 | 任务名称（默认自动生成）|
| `scantmplateid` | number | 否 | 扫描模板 ID |
| `ports` | string | 否 | 指定扫描端口，如 `80,443,8080-8090` |
| `sysscantmplateid` | number | 否 | 系统扫描模板 ID |

**请求体**：

```json
{
  "token": "a1b2c3d4e5f6789012345678901234567890abcd",
  "target": "192.168.10.0/24",
  "taskname": "内网例行扫描-2024Q1",
  "scantmplateid": 1
}
```

**返回示例**：

```json
{
  "success": true,
  "taskall_id": "TASK-2024-00123",
  "sys_task_id": "SYS-2024-00456"
}
```

---

### ControlTask — 控制任务

**端点**：`POST /async/control/`

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `token` | string | **是** | 认证令牌 |
| `controltype` | string | **是** | 操作类型：`start` / `stop` / `pause` / `continue` / `enable` / `disable` / `delete` |
| `taskallid` | string | **是** | 任务 ID（SubmitScanTask 返回的 `taskall_id`）|

**请求体**：

```json
{
  "token": "a1b2c3d4e5f6789012345678901234567890abcd",
  "controltype": "stop",
  "taskallid": "TASK-2024-00123"
}
```

**返回示例**：

```json
{ "success": true }
```

> **注**：传入不在合法列表中的 `controltype` 时本地返回 `INVALID_ARGUMENT`，不发起 HTTP 请求。

---

### GetTaskProgress — 查询任务进度

**端点**：`POST /async/scan/progress/`

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `token` | string | **是** | 认证令牌 |
| `taskallid` | string | **是** | 任务 ID |

**请求体**：

```json
{
  "token": "a1b2c3d4e5f6789012345678901234567890abcd",
  "taskallid": "TASK-2024-00123"
}
```

**返回示例**：

```json
{
  "success": true,
  "status": "scanning",
  "progress": 68,
  "hostscount": 254
}
```

`status` 常见取值：`waiting` / `scanning` / `paused` / `finished` / `stopped`

---

### QuerySysScanResult — 查询主机漏洞扫描结果

**端点**：`POST /async/scan/sys_result/`

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `token` | string | **是** | 认证令牌 |
| `taskid` | string | **是** | 子任务 ID（即 SubmitScanTask 返回的 `sys_task_id`）|

**请求体**：

```json
{
  "token": "a1b2c3d4e5f6789012345678901234567890abcd",
  "taskid": "SYS-2024-00456"
}
```

**返回示例**：

```json
{
  "success": true,
  "iTotalRecords": 3,
  "hostsinfo": [
    {
      "ip": "192.168.10.5",
      "hostname": "web-server-01",
      "os": "CentOS Linux 7",
      "vulhigh": 2,
      "vulmedium": 5,
      "vullow": 11,
      "ports": "22,80,443,3306"
    },
    {
      "ip": "192.168.10.12",
      "hostname": "db-server",
      "os": "Ubuntu 20.04 LTS",
      "vulhigh": 0,
      "vulmedium": 3,
      "vullow": 7,
      "ports": "22,3306"
    }
  ]
}
```

---

### ListTasks — 列出历史任务

**端点**：`POST /async/scan/tasklist/`

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `token` | string | **是** | 认证令牌 |
| `status` | string | 否 | 按状态筛选：`waiting` / `scanning` / `paused` / `finished` / `stopped` |
| `page` | number | 否 | 页码，从 1 开始 |
| `iDisplayLength` | number | 否 | 每页条数（默认 10）|

**请求体**：

```json
{
  "token": "a1b2c3d4e5f6789012345678901234567890abcd",
  "status": "finished",
  "page": 1,
  "iDisplayLength": 20
}
```

**返回示例**：

```json
{
  "success": true,
  "iTotalRecords": 42,
  "tasklist": [
    {
      "taskall_id": "TASK-2024-00123",
      "taskname": "内网例行扫描-2024Q1",
      "target": "192.168.10.0/24",
      "status": "finished",
      "progress": 100,
      "hostscount": 254,
      "createtime": "2024-03-15 10:00:00",
      "endtime": "2024-03-15 12:35:48"
    }
  ]
}
```

## 错误映射

| 错误情形 | gRPC 状态码 |
|----------|-------------|
| 缺少必填参数 / 无效 controltype | `INVALID_ARGUMENT` |
| 上游 errorcode 1002（用户名密码错误）| `PERMISSION_DENIED` |
| 上游 errorcode 1013（token 过期）| `PERMISSION_DENIED` |
| HTTP 401 / 403 | `PERMISSION_DENIED` |
| 上游其他 errorcode / HTTP 4xx | `FAILED_PRECONDITION` |
| HTTP 5xx / 网络超时 / 连接拒绝 | `UNAVAILABLE` |
| 非 JSON 响应体 | `UNKNOWN` |

## 风险边界

- `SubmitScanTask` 会向目标主机发起实际漏洞扫描探测，确保目标在授权范围内。
- `ControlTask` 的 `delete` 操作会永久删除任务记录，不可恢复。
- 不要在配置或测试代码中提交真实 token、IP 段、用户名密码等敏感信息。

## 建议权限组合

- **只读审计**：`GetToken` + `GetTaskProgress` + `QuerySysScanResult` + `ListTasks`
- **完整扫描闭环**：加入 `SubmitScanTask` + `ControlTask`

## 验证

```bash
cd services
npm run validate -- --service-dir qianxin__vs-secvss3600
npm test -- --service-dir qianxin__vs-secvss3600
npm run pack:check
```

真实设备验证（使用测试专用账号和授权目标 IP）：

```bash
# 1. 获取令牌
curl -X POST https://<host>/async/login/token/ \
  -H "Content-Type: application/json" \
  -d '{"user":"admin","pwd":"<pwd>"}'
# 返回: {"success":true,"token":"<token>"}

# 2. 提交扫描任务（确保目标已授权）
curl -X POST https://<host>/async/scan/task/ \
  -H "Content-Type: application/json" \
  -d '{"token":"<token>","target":"192.168.1.100","taskname":"test-scan"}'
# 返回: {"success":true,"taskall_id":"<tid>","sys_task_id":"<sid>"}

# 3. 查询进度
curl -X POST https://<host>/async/scan/progress/ \
  -H "Content-Type: application/json" \
  -d '{"token":"<token>","taskallid":"<tid>"}'
# 返回: {"success":true,"status":"scanning","progress":45,"hostscount":1}

# 4. 停止任务（清理）
curl -X POST https://<host>/async/control/ \
  -H "Content-Type: application/json" \
  -d '{"token":"<token>","controltype":"stop","taskallid":"<tid>"}'
# 返回: {"success":true}
```

| 方法 | 结果 |
|------|------|
| GetToken | ⬜ 待验证 |
| SubmitScanTask | ⬜ 待验证 |
| ControlTask | ⬜ 待验证 |
| GetTaskProgress | ⬜ 待验证 |
| QuerySysScanResult | ⬜ 待验证 |
| ListTasks | ⬜ 待验证 |
