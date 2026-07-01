# 火绒终端安全管理系统 V2.0.19.3

火绒终端安全管理系统 V2.0.19.3 的 OctoBus 适配器，使用官方 API 的 AccessKey 签名认证，封装终端分组、终端信息、风险终端、病毒事件统计和终端任务能力。

## 支持版本

- 已对接版本：火绒终端安全管理系统 V2.0.19.3。
- 认证方式：AccessKey ID + AccessKey Secret，按文档生成 `Authorization: HRESS...` 签名。
- API 形态：`HTTP POST` + JSON，请求路径以 `/api/` 开头。

## 配置示例

建议通过环境变量临时保存真实参数，再生成本地实例配置文件。不要把真实 `Secret ID`、`Secret Key`、登录密码、Cookie 或生产地址写进仓库。

```bash
export HUORONG_ENDPOINT="https://huorong.example.com"
export HUORONG_ACCESS_KEY_ID="your-access-key-id"
export HUORONG_ACCESS_KEY_SECRET="your-access-key-secret"

cat > /tmp/huorong-config.json <<JSON
{
  "endpoint": "${HUORONG_ENDPOINT}",
  "timeoutMs": 10000,
  "signatureExpiresSeconds": 300,
  "skipTlsVerify": false
}
JSON

cat > /tmp/huorong-secret.json <<JSON
{
  "accessKeyId": "${HUORONG_ACCESS_KEY_ID}",
  "accessKeySecret": "${HUORONG_ACCESS_KEY_SECRET}"
}
JSON
```

`config` 示例：

```json
{
  "endpoint": "https://huorong.example.com",
  "timeoutMs": 10000,
  "signatureExpiresSeconds": 300,
  "skipTlsVerify": false
}
```

`secret` 示例：

```json
{
  "accessKeyId": "your-access-key-id",
  "accessKeySecret": "your-access-key-secret"
}
```

不要把真实账号、密码、AccessKey、Cookie、生产环境地址写入配置样例、测试代码或截图。

## 方法说明

- `ListGroups`：获取全部终端分组。
- `ListOnlineMacs`：分页查询在线终端 MAC 地址。
- `ListClients`：分页查询终端基础信息。
- `GetClientDetails`：按终端唯一标识或 MAC 查询终端详情，可选择 `hardware`、`software`、`assets`、`netconf`。
- `ListHighRiskClients`：分页查询存在高危漏洞未修复的终端。
- `ListVirusEvents`：按终端、分组或全部终端统计病毒事件数量和处理结果。
- `CreateScanTask`：创建查杀扫描任务，支持 `quick_scan`、`custom_scan`、`full_scan`。
- `CreateIsolationTask`：创建终端隔离或取消隔离任务。
- `SendNotification`：向终端发送通知任务。

## 写操作语义

- `CreateScanTask` 默认参数：`clean_automate=true`、`clean_quarantine=true`、`cannot_cancel=true`、`scan_maxspeed=false`、`whitelist_ignore=false`、`scan_end_halt=false`。
- `CreateIsolationTask` 默认 `net_isolation=false`，表示取消隔离；设置为 `true` 表示隔离终端。
- `SendNotification` 只创建通知任务，不改变终端安全状态。
- 写操作由火绒平台创建异步任务，不保证幂等；同一请求重复提交可能产生多个任务。
- 回滚方式：扫描任务通常无需回滚；隔离任务可再次调用 `CreateIsolationTask` 并设置 `net_isolation=false`；通知任务无回滚。
- 审计字段：建议在调用侧记录 OctoBus `instance_id`、`request_id`、方法名、目标终端、目标分组、任务类型和火绒返回的 `data`。

## 风险说明

- `CreateIsolationTask` 会改变终端网络连通性，应只对测试终端或明确授权终端使用。
- `CreateScanTask` 可能触发资源消耗和病毒自动处理，建议先在测试终端验证策略。
- `SendNotification` 会在终端侧产生用户可见消息，内容应避免敏感信息。
- `skipTlsVerify=true` 仅建议用于私有测试环境。

## 建议 capset

- 只读排障：`ListGroups`、`ListOnlineMacs`、`ListClients`、`GetClientDetails`、`ListHighRiskClients`、`ListVirusEvents`。
- 终端任务：`CreateScanTask`、`CreateIsolationTask`、`SendNotification`，建议拆到单独 capset 并限制操作者。

## 本地检查

```bash
cd services
npm run validate -- --service-dir huorong__endpoint-security-management-system_v2-0-19-3
npm test -- --service-dir huorong__endpoint-security-management-system_v2-0-19-3
npm run pack:check
```

## OctoBus 本地调用流程

以下命令在仓库根目录执行，完成 `import`、`instance create`、`capset add-instance` 和一次核心方法调用。示例使用本机 daemon 地址，真实联调时只需要替换 `/tmp/huorong-config.json` 和 `/tmp/huorong-secret.json` 的内容。

```bash
bash ./scripts/build-octobus.sh bin/octobus

OCTOBUS_DATA_DIR="$(mktemp -d)"
./bin/octobus --addr 127.0.0.1:19001 serve --data-dir "${OCTOBUS_DATA_DIR}/data"

./bin/octobus --addr 127.0.0.1:19001 service import \
  huorong-endpoint-security-management-system-v2-0-19-3 \
  services/huorong__endpoint-security-management-system_v2-0-19-3

./bin/octobus --addr 127.0.0.1:19001 instance create huorong-real \
  --service huorong-endpoint-security-management-system-v2-0-19-3 \
  --config /tmp/huorong-config.json \
  --secret /tmp/huorong-secret.json

./bin/octobus --addr 127.0.0.1:19001 capset create huorong-dev
./bin/octobus --addr 127.0.0.1:19001 capset add-instance huorong-dev huorong-real

curl -i -sS -X POST \
  "http://127.0.0.1:19001/capsets/huorong-dev/connect/huorong-real/huorong.endpoint_security_management_system.v2_0_19_3.HuorongEndpointSecurityManagementSystem/ListClients" \
  -H "Content-Type: application/json" \
  --data '{"limit":5,"offset":0}'
```

本地 CLI 调试也可以使用 `OCTOBUS_SERVICE_CONTEXT` 直接运行服务命令：

```bash
export OCTOBUS_SERVICE_CONTEXT='{"config":{"endpoint":"https://huorong.example.com"},"secret":{"accessKeyId":"your-access-key-id","accessKeySecret":"your-access-key-secret"}}'
```

## OctoBus 联调证据

关联 Issue：`#408`。

PR 描述必须粘贴从 OctoBus 本地流程拿到的完整 request/response 原文，而不是直接调用火绒产品 API 的结果。敏感字段可脱敏，但要保留请求路径、状态码和响应结构。截图建议包含：

- OctoBus Connect 调用返回，能看到方法名、请求体和响应体。
- 火绒管理平台终端页面，能看到测试终端在线状态。
- 写操作对应的任务或通知页面，能证明测试对象已执行，并在必要时已清理或回滚。

本仓库已提供一份脱敏后的 OctoBus 联调截图摘要：[docs/octobus-connect-evidence.svg](docs/octobus-connect-evidence.svg)。PR 如需展示管理平台页面，可在网页端继续追加截图。

### ListClients 跑通示例

```http
POST http://127.0.0.1:19001/capsets/huorong-dev/connect/huorong-real/huorong.endpoint_security_management_system.v2_0_19_3.HuorongEndpointSecurityManagementSystem/ListClients
Content-Type: application/json

{"limit":5,"offset":0}
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"clients":[{"id":"1","clientId":"CDE1AC84...000000","localIp":"192.168.0.xxx","connectIp":"192.168.0.xxx","mac":"FA-1E-15-**-**-00","clientName":"DESKTOP-6Q0LN1J","computerName":"DESKTOP-6Q0LN1J","groupId":"1","osVersion":"Microsoft Windows 10 专业版","version":"2.0.19.3","definitions":"2026-06-30T10:05:57+08:00","isOnline":true}],"total":"1","raw":{"list":[{"client_id":"CDE1AC84...000000","client_name":"DESKTOP-6Q0LN1J","computer_name":"DESKTOP-6Q0LN1J","connect_ip":"192.168.0.xxx","group_id":1,"id":1,"is_online":true,"local_ip":"192.168.0.xxx","mac":"FA-1E-15-**-**-00","os_version":"Microsoft Windows 10 专业版","version":"2.0.19.3"}],"total":1}}
```

### CreateScanTask 跑通示例

```http
POST http://127.0.0.1:19001/capsets/huorong-dev/connect/huorong-real/huorong.endpoint_security_management_system.v2_0_19_3.HuorongEndpointSecurityManagementSystem/CreateScanTask
Content-Type: application/json

{"scanType":"quick_scan","clients":["CDE1AC84...000000"],"cleanAutomate":false,"cleanQuarantine":true,"cannotCancel":false,"scanMaxspeed":false,"whitelistIgnore":false,"scanEndHalt":false}
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"data":null,"raw":{"errno":0}}
```

### 已验证方法

2026-06-30 使用 OctoBus 本地流程对火绒终端安全管理系统 V2.0.19.3 完成真实设备验证，9 个方法均返回 `HTTP/1.1 200 OK`：

- `ListGroups`
- `ListOnlineMacs`
- `ListClients`
- `GetClientDetails`
- `ListHighRiskClients`
- `ListVirusEvents`
- `CreateScanTask`
- `CreateIsolationTask`，验证参数为 `netIsolation=false`，用于取消隔离，避免测试终端断网。
- `SendNotification`

## PR 描述要点

PR 应包含以下信息：

- `Closes #408`
- 接入设备：火绒终端安全管理系统 V2.0.19.3。
- 认证方式：AccessKey ID + AccessKey Secret，HMAC-SHA1 生成 `HRESS` 签名。
- 实现方法：列出 README 中 9 个方法。
- 测试命令：`npm run validate`、`npm test`、`npm run pack:check`。
- 完整 OctoBus request/response 原文：从本地 OctoBus Connect 调用保存，不使用直连产品 API 的回显。
- 设备验证截图：OctoBus 调用回显、火绒管理平台终端页面、写操作任务或通知页面。
- 已知限制：写操作由火绒平台异步创建任务，接口成功时 `data` 可能为 `null`。
