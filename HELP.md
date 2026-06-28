# OctoBus Windows 本地启动适配计划

本文记录在当前 Windows 11 Arm64 环境下把 OctoBus 服务启动起来的适配路径。后续实施目标是：在本机生成 `octobus.exe`，启动 `octobus serve --data-dir .octobus --addr 127.0.0.1:9000`，并通过 `octobus status` 访问本地管理接口。

## 当前代码理解

- 服务入口是 Go 单体命令 `cmd/octobus/main.go`，`serve` 子命令启动本地 daemon。
- daemon 默认监听 `127.0.0.1:9000`，也可通过 `--addr` 或 `OCTOBUS_ADDR` 覆盖。
- 数据目录默认是当前目录下的 `.octobus`，也可通过 `--data-dir` 或 `OCTOBUS_DATA_DIR` 覆盖。
- daemon 启动后会创建 SQLite 数据库、访问日志、服务包 artifact、runtime 目录，并通过 Node.js 子进程管理 long-running 或 on-demand service。
- 常规 service import/start 流程依赖 `node`、`npm`、`protoc`。

## 当前 Windows 环境状态

已在当前 Windows 11 Arm64 环境完成第一阶段依赖适配：

- `go`：已安装 Go 1.26.4，路径为 `C:\Program Files\Go\bin\go.exe`。
- `node`：已安装 Node.js v24.18.0，路径为 `C:\Program Files\nodejs\node.exe`。
- `npm`：已安装 npm 11.16.0，路径为 `C:\Program Files\nodejs\npm.cmd`。
- `protoc`：`winget` 下载安装失败，已改用镜像 zip 安装到项目本地 `.tools\protoc-35.0-win64\bin\protoc.exe`，版本为 libprotoc 35.0。

当前终端的 `PATH` 未必包含新装工具，后续命令优先使用完整路径，或重启 VS Code 后再直接使用命令名。

## Windows 适配重点

当前 checkout 的 `Taskfile.yml` 主要调用 Bash 脚本和 Unix 命令，例如 `bash ./scripts/build-octobus.sh`、`rm -rf`、`mkdir -p`、`xargs`。在 Windows cmd/PowerShell 环境下，不能直接假设这些命令可用。

适配策略：

1. 第一阶段绕过 Bash/Taskfile，直接用 Go 命令构建 Windows 可执行文件。
2. 第二阶段补 PowerShell 脚本或 Taskfile Windows 分支，把 build、clean、smoke 流程固化。
3. 第三阶段验证 service import、Node 子进程、protoc、npm 在 Windows 下的完整链路。

## 依赖准备执行记录

1. Go 已通过 `winget install --id GoLang.Go -e --source winget` 安装成功。
2. Node.js LTS 已通过 `winget install --id OpenJS.NodeJS.LTS -e --source winget` 安装成功。
3. `protoc` 使用 `winget install --id Google.Protobuf` 时因远程下载超时失败，错误为 `0x80072efd`；随后从 `https://registry.npmmirror.com/-/binary/protobuf/v35.0/protoc-35.0-win64.zip` 下载并解压到项目本地 `.tools` 目录。
4. Go 模块下载已设置 `GOPROXY=https://goproxy.cn,direct`。
5. npm registry 暂未调整；当前阶段只启动 daemon，不需要 npm 下载依赖。

## 构建执行记录

已绕过 Bash/Taskfile，使用 Windows 原生命令构建成功：

```powershell
& "C:\Program Files\Go\bin\go.exe" env -w GOPROXY=https://goproxy.cn,direct
& "C:\Program Files\Go\bin\go.exe" build -trimpath -o .\bin\octobus.exe .\cmd\octobus
.\bin\octobus.exe version
```

构建产物：`bin\octobus.exe`。

版本命令输出：

```text
version: dev
commit: unknown
date: unknown
```

当前构建未注入 `scripts/build-octobus.sh` 中的版本 ldflags，因此版本信息为 dev/unknown。后续如需要正式版本标识，再把该 Bash 脚本中的 ldflags 翻译为 PowerShell 构建命令。

## 启动验证记录

本地 daemon 已启动成功，当前终端仍在运行：

```powershell
.\bin\octobus.exe serve --data-dir .\.octobus --addr 127.0.0.1:9000
```

启动日志已出现：

```text
msg=daemon_listening addr=127.0.0.1:9000
```

CLI 验证通过：

```powershell
.\bin\octobus.exe status
```

返回：

```json
{
  "services": 0,
  "status": "ok"
}
```

HTTP 管理接口验证通过：

```powershell
Invoke-WebRequest http://127.0.0.1:9000/admin/v1/status
```

返回 HTTP 200，内容为 `{"services":0,"status":"ok"}`。

数据目录 `.octobus` 已生成，包含 `access.log`、`octobus.db`、`octobus.db-shm`、`octobus.db-wal`。

## Service Import 适配计划

启动 daemon 只是第一阶段。后续如果要跑完整 service import 和实例启动，还需要验证：

1. `protoc` 在 Windows 下能被 `internal/packageimport` 调用并生成 descriptor。
2. Node.js service entry 在 Windows 下可通过 `exec.Command` 正常启动。
3. `--secret-fd 3` 在 Windows 下可能存在兼容风险，需要重点验证 `internal/supervisor` 中向子进程传 secret 的方式。如果 Windows 不支持同样的 fd 传递语义，需要改为临时 secret 文件或 Windows 兼容的 handle 传递方案。
4. npm install、npm pack 在 Windows 路径和空格路径下均能工作。
5. long-running 实例能通过 gRPC health check，on-demand 实例能通过 stdin/stdout protobuf wire format 调用。

## 后续实施顺序

1. 当前第一阶段已完成：依赖安装、Windows 原生构建、daemon 启动、CLI/HTTP status 验证。
2. 下一阶段建议先运行最小 Go 单元测试：`go test ./cmd/... ./internal/...`。
3. 再选择一个最小 example，验证 import、instance create、capset、Connect RPC/MCP 基础调用。
4. 如果 service import 阶段失败，优先排查 `protoc` 路径、npm registry、Windows 路径分隔符和空格路径。
5. 如果实例启动阶段失败，重点排查 `--secret-fd 3` 在 Windows 下的兼容性，以及 `internal/supervisor` 的 Node 子进程启动方式。
6. 若需要固化 Windows 流程，再补充 PowerShell 构建/清理/启动脚本或 Taskfile Windows 分支。

## 项目用途分析

OctoBus 可以理解为一个本地运行的“能力网关”或“接口适配总线”。它不是直接帮你写业务系统，而是提供一套标准方式，把不同系统的接口包装成统一的能力，然后暴露给客户端、自动化脚本或 AI Agent 调用。

它解决的问题是：

- 不同系统接口形态不一致：有的系统是 REST，有的是内部 SDK，有的是数据库查询，有的是第三方 SaaS API。
- 不同系统鉴权方式不一致：有的需要 token，有的需要账号密码，有的需要内部证书。
- Agent 或上层应用不应该直接理解每个系统的细节，而应该看到稳定、可描述、可发现、可调用的能力列表。
- 接口接入后需要统一管理实例、配置、密钥、方法暴露范围、访问日志和访问令牌。

OctoBus 的抽象层次如下：

1. `service`：一个被接入的系统能力包。它声明有哪些 RPC 方法、需要哪些配置和密钥、由哪个 Node.js 入口实现。
2. `instance`：某个 service 的一个运行实例。比如同一个工单系统 wrapper 可以有测试环境实例、生产环境实例，分别配置不同 baseURL 和 token。
3. `capset`：能力集合。它决定哪些实例和哪些方法对外暴露给某个 Agent、应用或场景。
4. `method binding`：capset 中具体选中的方法。只有被选中的方法才会出现在 catalog、Connect RPC、MCP、OpenAPI 或 gRPC 暴露面里。

从运行结构看：

```text
调用方 / Agent / 脚本
  -> OctoBus 统一入口 127.0.0.1:9000
     -> 管理 API / gRPC / Connect RPC / MCP / OpenAPI
        -> capset 路由和鉴权
           -> 某个 service instance
              -> Node.js service package
                 -> 真实业务系统接口
```

所以，OctoBus 的核心价值是把“新系统的接口”变成“标准可发现、可鉴权、可审计、可被 Agent 调用的工具能力”。

## 新系统接口如何接入

假设你有一个新系统，比如工单系统、WAF、CMDB、漏洞扫描平台、销售系统、日志平台等。接入 OctoBus 的本质是写一个 service package，把这个系统的接口封装起来。

一个最小 service package 通常包含：

```text
my-system-service/
  package.json
  service.json
  config.schema.json
  secret.schema.json
  proto/
    my_system.proto
  bin/
    my-system.js
```

各文件职责：

- `package.json`：Node 包定义，声明依赖和可执行入口。OctoBus 会根据 `bin` 找到运行入口。
- `service.json`：OctoBus 服务描述文件，声明服务名、proto 文件、运行模式、配置 schema、密钥 schema。
- `config.schema.json`：普通配置结构，比如 `baseUrl`、`tenantId`、`timeout`。
- `secret.schema.json`：敏感配置结构，比如 `apiToken`、`username`、`password`。
- `proto/*.proto`：对外暴露的方法定义，相当于把系统接口整理成标准 RPC 契约。
- `bin/*.js`：真正调用新系统接口的适配代码。

### 第一步：定义要暴露哪些能力

不要把新系统所有接口一次性全搬进来。建议先按业务场景选 1 到 3 个高价值动作，例如：

- 查询工单详情
- 创建工单
- 查询资产信息
- 拉取漏洞列表
- 查询日志分析结果
- 触发扫描任务
- 获取某个项目的 MR 列表

然后把这些动作设计成 proto 方法。例如一个工单系统可以这样定义：

```proto
syntax = "proto3";
package ticket.v1;

service TicketService {
  rpc GetTicket(GetTicketRequest) returns (Ticket);
  rpc CreateTicket(CreateTicketRequest) returns (Ticket);
}

message GetTicketRequest {
  string id = 1;
}

message CreateTicketRequest {
  string title = 1;
  string description = 2;
  string priority = 3;
}

message Ticket {
  string id = 1;
  string title = 2;
  string status = 3;
  string url = 4;
}
```

### 第二步：写 service.json

示例：

```json
{
  "schema": "chaitin.octobus.service.v1",
  "name": "ticket-wrapper",
  "displayName": "Ticket System Wrapper",
  "description": "Wrap ticket system APIs as OctoBus capabilities.",
  "runtime": {
    "mode": "long-running"
  },
  "proto": {
    "roots": ["proto"],
    "files": ["proto/ticket.proto"]
  },
  "configSchema": "config.schema.json",
  "secretSchema": "secret.schema.json"
}
```

一般优先使用 `long-running` 模式：实例创建后常驻一个 Node.js gRPC 进程，适合频繁调用。只有很少调用、希望每次调用才启动进程时，才考虑 `on-demand`。

### 第三步：定义配置和密钥

`config.schema.json` 示例：

```json
{
  "type": "object",
  "properties": {
    "baseUrl": { "type": "string" },
    "timeoutMs": { "type": "number", "default": 10000 }
  },
  "required": ["baseUrl"],
  "additionalProperties": false
}
```

`secret.schema.json` 示例：

```json
{
  "type": "object",
  "properties": {
    "apiToken": { "type": "string" }
  },
  "required": ["apiToken"],
  "additionalProperties": false
}
```

配置和密钥分开是为了安全：`config` 可以记录普通参数，`secret` 放 token、密码等敏感信息。

### 第四步：实现 Node.js 适配代码

示意代码：

```js
#!/usr/bin/env node

import { defineService, runServiceMain } from "@chaitin-ai/octobus-sdk";

const service = defineService({
  handlers: {
    "ticket.v1.TicketService/GetTicket": async (ctx) => {
      const { baseUrl } = ctx.config;
      const { apiToken } = ctx.secret;
      const { id } = ctx.request;

      const resp = await fetch(`${baseUrl}/api/tickets/${id}`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      const data = await resp.json();

      return {
        id: String(data.id),
        title: data.title,
        status: data.status,
        url: data.url,
      };
    },
  },
});

runServiceMain(service);
```

handler 的 key 必须和 proto 中的方法全名一致，格式是：

```text
<proto package>.<Service>/<Method>
```

例如：

```text
ticket.v1.TicketService/GetTicket
```

### 第五步：导入 service package

如果 service package 是本地目录：

```powershell
.\bin\octobus.exe service import ticket .\services\ticket-wrapper
```

如果一个包里有多个 service root，可以用：

```powershell
.\bin\octobus.exe service import --recursive .\services\platform-services
```

### 第六步：创建实例

创建实例时传入配置和密钥：

```powershell
.\bin\octobus.exe instance create ticket-prod `
  --service ticket `
  --config-json '{"baseUrl":"https://ticket.example.com","timeoutMs":10000}' `
  --secret-json '{"apiToken":"dev-token"}'
```

`long-running` service 默认创建后会启动实例。启动成功后，OctoBus 会记录实例状态、PID、监听地址，并做 gRPC health check。

### 第七步：创建 capset 并暴露方法

创建一个面向某个 Agent 或业务场景的能力集合：

```powershell
.\bin\octobus.exe capset create dev --name DevAgent
.\bin\octobus.exe capset add-instance dev ticket-prod
```

默认会把该实例当前所有方法加入 capset。更精细的方式是先不自动加入所有方法，然后手动选择：

```powershell
.\bin\octobus.exe capset add-instance dev ticket-prod --no-all-methods
.\bin\octobus.exe capset select-method dev ticket-prod ticket.v1.TicketService/GetTicket --mcp-tool ticket_get
```

### 第八步：查看 catalog

```powershell
.\bin\octobus.exe catalog dev --all --json
```

或：

```powershell
Invoke-WebRequest "http://127.0.0.1:9000/admin/v1/catalog/dev?all=true"
```

catalog 会告诉你：

- 暴露了哪些方法
- 每个方法属于哪个 service/instance
- gRPC 调用方式
- Connect RPC endpoint
- MCP tool 名称
- 请求/响应 message 名称
- OpenAPI 描述地址

## 接入后怎么调用

同一个新系统能力接入后，可以用三类主要方式调用：Connect RPC、MCP、gRPC。

### 方式一：Connect RPC，适合普通 HTTP/JSON 调用

Connect RPC endpoint 格式：

```text
POST /capsets/{capset_id}/connect/{instance_id}/{full_service}/{method}
```

以上面的工单系统为例：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:9000/capsets/dev/connect/ticket-prod/ticket.v1.TicketService/GetTicket" `
  -ContentType "application/json" `
  -Body '{"id":"TICKET-001"}'
```

如果 capset 配了 token，则加：

```powershell
-Headers @{ Authorization = "Bearer dev-secret" }
```

Connect RPC 的优点是简单，普通前端、脚本、后端服务都可以用 HTTP JSON 调用。

### 方式二：MCP，适合 AI Agent 调用

MCP endpoint 格式：

```text
POST /capsets/{capset_id}/mcp
```

列出工具：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:9000/capsets/dev/mcp" `
  -ContentType "application/json" `
  -Body '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

调用工具：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:9000/capsets/dev/mcp" `
  -ContentType "application/json" `
  -Body '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ticket_get","arguments":{"id":"TICKET-001"}}}'
```

MCP 的优点是适合接给支持 MCP 的 Agent，让 Agent 自动发现工具 schema 并按参数调用。

### 方式三：gRPC，适合内部服务或强类型客户端

调用时通过 metadata 指定 capset 和 instance：

```powershell
grpcurl -plaintext `
  -H "x-octobus-capset: dev" `
  -H "x-octobus-instance: ticket-prod" `
  -d '{"id":"TICKET-001"}' `
  127.0.0.1:9000 `
  ticket.v1.TicketService/GetTicket
```

gRPC 的优点是支持原始 RPC 语义，也支持 streaming。Connect RPC 和 MCP 主要适合 unary 方法；streaming 方法应优先走 gRPC。

### OpenAPI 和 Schema 查看

OctoBus 可以按 capset 生成 OpenAPI：

```powershell
Invoke-WebRequest http://127.0.0.1:9000/capsets/dev/openapi.json
Invoke-WebRequest http://127.0.0.1:9000/capsets/dev/openapi.yaml
```

这对前端、接口调试工具和文档生成有用。

### 访问控制和日志

capset 默认没有 token 时，公开协议入口可直接访问。要加访问控制：

```powershell
"dev-secret" | .\bin\octobus.exe capset add-token dev local --token-stdin
```

加 token 后：

- Connect RPC、MCP、OpenAPI 使用 `Authorization: Bearer <token>`。
- gRPC 和 reflection 使用同名 metadata。
- OctoBus 只保存 token 校验哈希，不保存明文 token。

访问日志位于数据目录的 `access.log`，也可以用 CLI 查看：

```powershell
.\bin\octobus.exe logs
.\bin\octobus.exe logs --capset dev --instance ticket-prod
```

日志记录协议、capset、service、instance、method/tool、route、状态码、耗时、来源地址等，不记录请求体、响应体、Authorization、token、secret 或业务 metadata。
