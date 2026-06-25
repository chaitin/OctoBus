# 奇安信网神 SecVSS 3600 漏洞扫描系统

OctoBus service package for **奇安信网神 SecVSS 3600 漏洞扫描系统 V6** — 一款企业级主机漏洞扫描系统，支持系统漏洞、WEB漏洞、弱口令检测及基线核查，通过异步任务模型对目标主机执行多类型安全扫描并输出分级漏洞报告。

- **厂商 / 产品**: 奇安信 · 网神 SecVSS 3600 漏洞扫描系统
- **支持版本**: V6（build V6.0.1.10001），`/async/` 路由
- **分类**: 漏洞管理 / 资产扫描
- **proto 包**: `QIANXIN_VS_SecVSS3600`
- **接口来源**: 《网神SecVSS 3600漏洞扫描系统接口说明（build V6.0.1.10001）》

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

**返回示例**：

```json
{
  "success": true,
  "token": "25e7b5fcf4210240f7fcb46a025a7ab3..."
}
```

---

### SubmitScanTask — 提交漏洞扫描任务

**端点**：`POST /async/newtask/add/`

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `token` | string | **是** | GetToken 返回的令牌 |
| `target` | string | **是** | 扫描目标，支持 IP / IP段 / 域名 / URL，多目标用英文逗号分隔 |
| `task_type` | number | 否 | 任务类型：0=系统扫描，1=弱口令，3=WEB，4=数据库，7=仅存活探测 |
| `name` | string | 否 | 任务名称（默认 `ASYNC-$target`）|
| `schedule` | number | 否 | 执行周期：0=立即，1=定时一次，2=每天，3=每周，4=每月 |
| `vul_plugin` | number | 否 | 规则库策略模板 ID（可通过 ListVulTemplates 查询）|
| `scan_plugin` | number | 否 | WEB 扫描规则库模板 ID |

**返回示例**：

```json
{
  "success": true,
  "taskall_id": "10",
  "sys_task_id": "4",
  "web_task_id": "9",
  "alive_task_id": "8",
  "ret_crack_task_id": "11"
}
```

> **注**：taskall_id 用于任务控制和进度查询；sys_task_id / web_task_id / ret_crack_task_id 分别用于对应类型的结果查询。

---

### ControlTask — 控制任务

**端点**：`POST /async/control/`

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `token` | string | **是** | 认证令牌 |
| `controltype` | string | **是** | 操作类型：`start` / `stop` / `pause` / `continue` / `enable` / `disable` / `delete` |
| `taskallid` | string | **是** | 任务 ID（SubmitScanTask 返回的 `taskall_id`）|

**返回示例**：

```json
{ "success": true }
```

> **注**：传入不在合法列表中的 `controltype` 时本地返回 `INVALID_ARGUMENT`，不发起 HTTP 请求。`delete` 操作不可恢复。

---

### GetTaskProgress — 查询任务进度

**端点**：`POST /async/status/`

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `token` | string | **是** | 认证令牌 |
| `taskallid` | string | **是** | 任务 ID |

**返回示例**：

```json
{
  "success": true,
  "status": "4",
  "progress": 100,
  "scheduletype": 0
}
```

`status` 取值：0=未提交，1=已提交，2=提交失败，3=运行中，4=已完成，5=已跳过，6=已停止，7=已暂停，8=等待，9=已超时

---

### QuerySysScanResult — 查询系统漏洞扫描结果

**端点**：`POST /async/sysscan/query/`

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `token` | string | **是** | 认证令牌 |
| `taskid` | string | **是** | 系统扫描子任务 ID（即 SubmitScanTask 返回的 `sys_task_id`）|
| `jobid` | string | 否 | 指定 jobid，默认最近一次 |
| `target` | string | 否 | 筛选指定目标 IP/域名 |

**返回示例**：

```json
{
  "success": true,
  "status": "completed",
  "hostscount": 1,
  "vulhigh": 18,
  "vulmedium": 43,
  "vullow": 98,
  "hosts": [{ "ip": "172.18.0.179", "vulcount": 172, "status": "completed" }]
}
```

---

### ListTasks — 列出历史任务

**端点**：`POST /async/tasklist/query/`

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `token` | string | **是** | 认证令牌 |
| `status` | string | 否 | 按状态筛选（0-9，含义同 GetTaskProgress）|
| `page` | number | 否 | 页码，从 1 开始（最大 100000）|
| `iDisplayLength` | number | 否 | 每页条数（最大 1000）|
| `starttime` | string | 否 | 开始时间，格式 `2024-01-01 00:00:00` |
| `endtime` | string | 否 | 结束时间 |

**返回示例**：

```json
{
  "success": true,
  "iTotalRecords": 42,
  "aaData": [[59, "内网扫描", 0, 4, 100, "2024-03-15 10:00:00", "2024-03-15 12:35:48", "2小时35分"]]
}
```

---

### QueryWebScanResult — 查询 WEB 漏洞扫描结果

**端点**：`POST /async/webscan/query/`

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `token` | string | **是** | 认证令牌 |
| `taskid` | string | **是** | WEB 扫描子任务 ID（`web_task_id`）|
| `jobid` | string | 否 | 指定 jobid |
| `target` | string | 否 | 筛选指定站点 URL |

**返回示例**：

```json
{
  "success": true,
  "status": "completed",
  "hostscount": 1,
  "total": 174,
  "hosts": [{ "high": 3, "middle": 3, "low": 155, "total": 174, "status": "completed" }]
}
```

---

### QueryWeakPassResult — 查询弱口令扫描结果

**端点**：`POST /async/crack/query/`

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `token` | string | **是** | 认证令牌 |
| `taskid` | string | **是** | 弱口令扫描子任务 ID（`ret_crack_task_id`）|
| `jobid` | string | 否 | 指定 jobid |
| `target` | string | 否 | 筛选指定主机 IP |

**返回示例**：

```json
{
  "success": true,
  "status": "completed",
  "hostscount": 1,
  "total": 2,
  "hosts": [{ "results": [{ "host": "172.18.0.252", "login": "root", "password": "root123", "service": "ssh", "port": "22" }] }]
}
```

---

### GetDeviceStatus — 查询扫描器状态

**端点**：`POST /async/device/status/`（无需 token）

**请求参数**：无

**返回示例**：

```json
{
  "success": true,
  "CPU Load": "1.80%",
  "Disk Usage": "2.6G/44G (7%)",
  "Memory Usage": "6953.4MB/7860MB, 88.47%",
  "System": "3.5.3-R1",
  "engine": [
    { "ip": "127.0.0.1", "name": "local", "status": 1, "type": "sysscan" }
  ]
}
```

---

### ListVulTemplates — 查询规则库模板

**端点**：`POST /async/ruletemplate/query/`

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `token` | string | **是** | 认证令牌 |
| `type` | string | **是** | 模板类型：`sysscan`（系统漏洞）或 `webscan`（WEB漏洞）|

**返回示例**：

```json
{
  "success": true,
  "aaData": [{ "id": 1, "name": "全部漏洞扫描" }, { "id": 4, "name": "Linux漏洞扫描" }]
}
```

---

## 错误映射

| 错误情形 | gRPC 状态码 |
|----------|-------------|
| 缺少必填参数 / 无效 controltype / 无效 type | `INVALID_ARGUMENT` |
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
- **完整扫描闭环**：加入 `SubmitScanTask` + `ControlTask` + `QueryWebScanResult` + `QueryWeakPassResult`
- **设备巡检**：`GetDeviceStatus` + `ListVulTemplates`

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

# 2. 查询设备状态（无需 token）
curl -X POST https://<host>/async/device/status/ \
  -H "Content-Type: application/json" -d '{}'
# 返回: {"success":true,"CPU Load":"...","engine":[...]}

# 3. 提交扫描任务（确保目标已授权）
curl -X POST https://<host>/async/newtask/add/ \
  -H "Content-Type: application/json" \
  -H "token: <token>" \
  -d '{"target":"192.168.1.100","task_type":0}'
# 返回: {"success":true,"taskall_id":"<tid>","sys_task_id":"<sid>"}

# 4. 查询进度
curl -X POST https://<host>/async/status/ \
  -H "Content-Type: application/json" \
  -H "token: <token>" \
  -d '{"taskallid":"<tid>"}'
# 返回: {"success":true,"status":"4","progress":100}

# 5. 停止任务（清理）
curl -X POST https://<host>/async/control/ \
  -H "Content-Type: application/json" \
  -H "token: <token>" \
  -d '{"controltype":"stop","taskallid":"<tid>"}'
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
| QueryWebScanResult | ⬜ 待验证 |
| QueryWeakPassResult | ⬜ 待验证 |
| GetDeviceStatus | ⬜ 待验证 |
| ListVulTemplates | ⬜ 待验证 |
