<p align="center">
  <img src="octobuslogo.jpg" alt="OctoBus" width="240">
</p>

<p align="center">
  <a href="https://github.com/chaitin/OctoBus/actions/workflows/ci.yml">
    <img src="https://github.com/chaitin/OctoBus/actions/workflows/ci.yml/badge.svg?branch=main" alt="ci">
  </a>
  <a href="./CONTRIBUTING.zh-CN.md">
    <img src="https://img.shields.io/badge/贡献者-指南-blue" alt="contributing">
  </a>
  <a href="./SECURITY.zh-CN.md">
    <img src="https://img.shields.io/badge/安全合规-反馈-blue" alt="security">
  </a>
</p>

---

OctoBus 是一个本地运行的单程序网关，用来管理可插拔的 Node.js service package，并把这些 package 中的 gRPC 能力按 capset 暴露给客户端或 agent

当前实现提供一个 Go 编译出的 `octobus` binary，同时承担以下职责：

- daemon：启动本地控制面、公共数据面，并按 service 运行模式管理 Node.js 子进程
- CLI：通过本地 admin API 管理 service、instance、capset
- 网关：将已选择的 method 暴露为 gRPC，并将其中的 unary method 暴露为 Connect RPC 和 MCP streamable HTTP
- 存储：使用 SQLite 记录 service、instance、capset、method binding、descriptor 与运行状态
- 运行时管理：导入 service package，准备 runtime dir，管理长期运行或按需调用的 Node.js instance

## 项目基本情况

OctoBus 的核心模型如下：

- **service**：一个可导入的 Node.js package 中的 service root，内部包含 `service.json`、proto 文件和 gRPC 实现；单个 distribution package 可以通过 `//service-dir` 暴露多个 service root
- **instance**：某个 service 的一个运行实例，拥有独立配置和工作目录；长期运行模式还会拥有日志和本地监听端口
- **capset**：面向某个 agent 或使用场景的一组确定能力，由 `capset -> service -> instance -> method` 绑定组成
- **method binding**：capset 中实际选择暴露的 gRPC method。unary method 可通过 gRPC、Connect RPC 和 MCP 调用；streaming method 仅支持 long-running service 的 gRPC 调用，不进入 Connect RPC、MCP 或 on-demand 调用路径

daemon 默认监听单一端口 `127.0.0.1:9000`。admin API、gRPC、Connect RPC、MCP 和 reflection 都通过该端口分发。可以通过 `--addr` 显式绑定到其它地址，例如 `0.0.0.0:9000`；远程暴露时需要自行承担网络访问控制。CLI 默认通过 admin API 完成管理操作，不直接写 SQLite

service package 默认使用 `long-running` 运行模式：instance 创建或启动后会拉起一个常驻 Node.js gRPC 子进程。package 也可以在 `service.json` 中声明 `"runtime":{"mode":"on-demand"}`：这类 instance 不预启动、不保存 PID 或监听地址，每次请求到达时由 OctoBus 启动一次短生命周期 `invoke` 子进程。

## 启动 daemon

### 从 npm 安装

OctoBus 以 `@chaitin-ai/octobus` npm package 发布。主 package 会安装一个很小的 Node.js launcher，并通过平台相关的 optional dependencies 拉取匹配的原生 Go binary，例如 `@chaitin-ai/octobus-linux-x64`。

```bash
npm install -g @chaitin-ai/octobus
octobus serve
```

也可以不做全局安装，直接运行：

```bash
npx @chaitin-ai/octobus serve
```

npm package 只安装 `octobus` binary。常规 service import 和 runtime 流程仍然需要本机提供 `node`、`npm`、`protoc` 和 `git`，见下方依赖说明。

### 使用 Docker 运行

Docker 镜像内包含 `octobus` binary，以及常规 service 导入和 instance 启动流程需要的运行时依赖。

```bash
docker run --rm \
  -p 9000:9000 \
  -v octobus-data:/var/lib/octobus \
  ghcr.io/chaitin/octobus:latest
```

容器默认监听 `0.0.0.0:9000`，daemon 状态保存在 `/var/lib/octobus`。

### 从 checkout 构建

首次 checkout 后先构建 binary：

```bash
task build
```

使用默认配置启动：

```bash
./bin/octobus serve
```

常用参数：

```bash
./bin/octobus serve \
  --data-dir .octobus \
  --addr 127.0.0.1:9000
```

也可以通过环境变量覆盖默认值：

```bash
export OCTOBUS_DATA_DIR="./.octobus"
export OCTOBUS_ADDR="127.0.0.1:9000"
```

数据目录中会保存 SQLite 数据库、service artifact/runtime、instance 配置和日志。默认数据目录为启动命令当前目录下的 `.octobus`

### 依赖

本地运行 daemon 并完成常规 service 导入/启动流程时，需要提前安装以下命令并确保它们在 `PATH` 中：

- `node`：运行已导入的 Node.js service package；版本需满足 package 自身声明的要求
- `npm`：导入 service 时拉取 npm package，并在 runtime dir 中安装生产依赖
- `protoc`：导入 service 时编译 proto descriptor
- `git`：从 HTTPS Git source 导入 service 时拉取和归档 package

如果 `go build` 或 `task build` 在下载 Go 模块时超时（例如 `proxy.golang.org` 报 `dial tcp ... i/o timeout`），可以配置 Go 模块代理：

```bash
go env -w GOPROXY=https://goproxy.cn,direct
```

## 基本使用流程

下面用仓库内置的 calculator 示例跑通一次完整流程。开始前先按上一节构建 binary、启动 daemon，并确认 CLI 能连上：

```bash
./bin/octobus status
```

如果 daemon 不在默认地址，可以通过全局参数或环境变量指定。本地 daemon 默认使用 HTTP/h2c，地址可以写成裸 `host:port` 或 `http://host:port`：

```bash
./bin/octobus --addr 127.0.0.1:19001 status
OCTOBUS_ADDR=http://127.0.0.1:19001 ./bin/octobus service list
```

远程暴露并在外层代理提供 TLS 时，才需要使用 `https://host:port` 形式。

> calculator 示例通过本仓库内的本地 SDK 构建产物安装依赖。从干净 checkout 运行示例前，先准备示例依赖；该任务会自动构建本地 SDK 并安装示例依赖：
>
> ```bash
> task example:calculator:dev-deps
> ```
>
> 仓库也提供 on-demand 运行模式的 calculator 示例，位于 `examples/calculator-on-demand-js`。如果要本地直接运行该示例，可先准备依赖；该任务同样会自动构建本地 SDK：
>
> ```bash
> task example:calculator-on-demand:dev-deps
> ```

也可以直接运行干净 checkout smoke 脚本验证本地 calculator 主路径。该任务会清理生成物，重新构建 binary 和本地 SDK，安装 calculator 示例依赖，启动临时 daemon，导入 service，创建 instance/capset，并调用 Connect RPC 断言返回 `result: 42`：

```bash
task example:clean-checkout-smoke
```

导入示例 service package：

```bash
./bin/octobus service import calculator ./examples/calculator-js
```

第一个位置参数 `calculator` 是 OctoBus 本地 service id，必填；`--name` 可选，用于覆盖展示名。未提供 `--name` 时，首次导入使用 `service.json` 中的 `displayName`，没有 `displayName` 则使用 `name`。再次导入同一个 service id 且未提供 `--name` 时，会保留已有展示名。

创建并启动一个 instance：

```bash
./bin/octobus instance create \
  calculator-test \
  --service calculator \
  --config-json '{"label":"primary"}' \
  --secret-json '{"apiToken":"dev-token"}'
```

创建 capset，并把该 instance 的 methods 暴露出来：

```bash
./bin/octobus capset create dev --name DevAgent

./bin/octobus capset add-instance \
  dev \
  calculator-test
```

查看 capset catalog，确认 method 已经暴露：

```bash
./bin/octobus catalog dev --all --json
```

通过 Connect RPC 调用一次 calculator：

```bash
curl -X POST \
  http://127.0.0.1:9000/capsets/dev/connect/calculator-test/calculator.v1.CalculatorService/Add \
  -H 'Content-Type: application/json' \
  -d '{"left":20,"right":22}'
```

补充提示：

- `service import` 除了本地目录，也支持本地和远程 HTTP(S) `.tgz` / `.tar.gz` / `.zip` 归档包、`npm:` source 和 HTTPS Git source；除远程 HTTP(S) 归档 URL 外，package source 都可追加 `//service-dir` 来选择 distribution package 内的 service root，例如 `npm:@scope/tentacle@1.0.0//Hanqing_Ticket` 或 `https://github.com/acme/tentacle.git//Hanqing_Ticket@v1.0.0`。远程归档 URL 使用包根目录作为 service root；multi-service 归档可用 recursive import。离线导入、强制重装依赖等参数可查看 `./bin/octobus service import --help`
- 使用 `service import --recursive SOURCE` 可以一次导入 multi-service distribution package 中发现到的所有 service root，例如 `./bin/octobus service import --recursive npm:@chaitin-ai/octobus-tentacles`。recursive 模式下，`SOURCE//some-dir` 表示递归发现的 scan root；每个导入的 service id 来自对应 `service.json.name`
- `instance` 支持 `list/get/update/delete/update-config/update-secret/start/stop/restart`；`create` 对 `long-running` service 默认会立即启动实例，配置可以来自 `--config`、`--config-json` 或 stdin，敏感信息可以来自 `--secret`、`--secret-json` 或 stdin
- `on-demand` instance 会保持 enabled/running 的逻辑状态，但 `start/stop/restart` 和带 `--restart` 的配置更新会返回运行模式不支持持久运行时控制的错误
- `capset` 支持 `list/get/update/delete/add-instance/remove-instance`，也可以用 `select-method` / `unselect-method` 精确控制暴露的方法；`add-token/list-tokens/remove-token` 用于管理访问 token
- `capset add-instance` 接收 capset id 和 instance id 两个位置参数，service 会从 instance 记录反查；该命令默认选择全部 methods，并在执行时静态展开当前 service 的所有 methods；可用 `--no-all-methods` 改为之后通过 `select-method` 精确选择。gRPC catalog 会包含已选择的 unary 和 streaming methods；Connect RPC、MCP 和 OpenAPI 只包含 unary methods。service 后续更新新增 method 时，不会自动暴露到已有 capset

更多调用方式见下一节；命令细节可以通过各子命令的 `--help` 查看

## 调用已暴露能力

获取 capset catalog：

```bash
curl 'http://127.0.0.1:9000/admin/v1/catalog/dev?all=true'
```

catalog 中会按协议返回每个 method 的运行模式、后端状态、gRPC metadata、Connect RPC endpoint、MCP tool name、descriptor hash/version 和请求/响应 message 名称。默认只返回 gRPC catalog；可通过 `grpc=true`、`connect=true`、`mcp=true` 或 `all=true` query 参数选择协议，也可以用 `./bin/octobus catalog --help` 查看 CLI 选项

capset 默认不要求访问 token；未添加 token 时，capset 下的 Connect RPC、MCP、gRPC、reflection 和公开 OpenAPI 入口保持公开访问。添加一个或多个 token 后，访问这些公开资源必须携带有效凭据：HTTP/Connect/MCP/OpenAPI 使用 `Authorization: Bearer <token>`，gRPC 和 reflection 使用同名 metadata。token secret 只在创建时提交，OctoBus 持久化校验 hash，不明文保存。

```bash
printf '%s' 'dev-secret' | ./bin/octobus capset add-token dev local --token-stdin
./bin/octobus capset list-tokens dev
./bin/octobus capset remove-token dev local
```

### gRPC

gRPC 调用保持原始 method path，通过 metadata 指定路由目标：

```bash
grpcurl -plaintext \
  -H 'x-octobus-capset: dev' \
  -H 'x-octobus-instance: gitlab-test' \
  -d '{"projectId":"p1"}' \
  127.0.0.1:9000 \
  gitlab.MergeRequestService/List
```

OctoBus 转发到后端 Node instance 前会剥离 `x-octobus-*` 控制 metadata，但 `x-octobus-ext-*` 是透传例外。业务扩展 metadata 使用 `x-octobus-ext-*` 命名，例如 `x-octobus-ext-business-request-id` 和 `x-octobus-ext-username`，会透传给 service package。calculator 示例优先读取 `x-octobus-ext-business-request-id`，并兼容旧的 `x-business-request-id`。long-running service 的 gRPC 网关支持 unary、server streaming、client streaming 和 bidirectional streaming；on-demand service 只支持 unary invoke。

### Connect RPC

Connect RPC 入口为：

```text
POST /capsets/{capset_id}/connect/{instance_id}/{full_service}/{method}
```

示例：

```bash
curl -X POST \
  http://127.0.0.1:9000/capsets/dev/connect/gitlab-test/gitlab.MergeRequestService/List \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-secret' \
  -H 'x-octobus-ext-business-request-id: req-1' \
  -d '{"projectId":"p1"}'
```

Connect RPC 使用 protobuf JSON mapping，未知字段会被拒绝，响应默认省略零值。字段级 schema 可通过 capset OpenAPI 获取：

```bash
curl http://127.0.0.1:9000/capsets/dev/openapi.json
curl http://127.0.0.1:9000/capsets/dev/openapi.yaml
curl http://127.0.0.1:9000/admin/v1/catalog/dev/openapi.json
curl http://127.0.0.1:9000/admin/v1/catalog/dev/openapi.yaml
```

### MCP

MCP streamable HTTP 入口为：

```text
POST /capsets/{capset_id}/mcp
```

列出 tools：

```bash
curl -X POST http://127.0.0.1:9000/capsets/dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

调用 tool：

```bash
curl -X POST http://127.0.0.1:9000/capsets/dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"gitlab__gitlab-test__list","arguments":{"projectId":"p1"}}}'
```

默认 tool name 由 `{service}__{instance}__{method}` 生成；如发生冲突，需要在 `capset select-method` 时通过 `--mcp-tool` 显式指定

### gRPC Reflection

OctoBus 自己基于导入时归档的 descriptor 提供 gRPC reflection，不透传到 Node instance。reflection 请求必须携带 `x-octobus-capset`，返回范围限制在该 capset 已暴露 method 所需的 descriptor 闭包内

```bash
grpcurl -plaintext \
  -H 'x-octobus-capset: dev' \
  127.0.0.1:9000 \
  list
```

## 查看访问日志

capset 公共协议访问会写入数据目录下的 `access.log`，格式为 NDJSON，文件权限为 `0600`。
它记录协议、capset、service、instance、method/tool、route、状态码、耗时、remote addr
和 user agent，不记录请求体、响应体、Authorization、token、secret 或业务 metadata。

通过 CLI 查看：

```bash
./bin/octobus logs
./bin/octobus logs --capset dev --instance calculator-test
./bin/octobus logs --service calculator --limit 1000
./bin/octobus logs --capset dev --tail 0 --follow
```

`--limit 0` 返回全部匹配记录；`--tail N` 返回最后 N 条匹配记录；`--follow` 持续输出新
匹配记录。过滤条件按 exact match 组合。

## 开发 Service Package

一个 service package 至少需要包含：

```text
my-service/
  package.json
  service.json
  proto/
    service.proto
  dist/
    index.js
```

也可以用一个 npm distribution package 承载多个 service root。此时根 `package.json` 是依赖安装、发布和 runtime entry 的唯一权威来源，每个 service root 子目录提供自己的 `service.json`、proto 和 schema。单 service 导入时在 source 后追加 `//service-dir` 选择目标 service root；不追加时，根目录本身就是 service root。使用 `octobus service import --recursive SOURCE` 可以一次发现并导入所有 service root；recursive 模式下 `SOURCE//some-dir` 是发现范围的 scan root。

`service.json` 示例：

```json
{
  "schema": "chaitin.octobus.service.v1",
  "name": "gitlab-wrapper",
  "displayName": "GitLab Wrapper",
  "description": "GitLab API wrapper service",
  "runtime": {
    "mode": "long-running"
  },
  "proto": {
    "roots": ["proto"],
    "files": ["proto/gitlab.proto"]
  },
  "configSchema": "config.schema.json",
  "secretSchema": "secret.schema.json"
}
```

必填字段：

- `schema`
- `name`
- `proto.roots`
- `proto.files`

`name` 是 package 内声明的名称，不是 OctoBus service id；`service.json` 不允许声明顶层 `id` 或 `entry` 字段。runtime entry 必须由 distribution package root 的 `package.json bin` 提供：单 entry package 可以使用字符串或单 entry object，多 service package 需要让 `service.json.name` 匹配根 `bin` object 中的 key。`runtime.mode` 可选，支持 `long-running` 和 `on-demand`，缺省等价于 `long-running`。若提供 `configSchema`，创建或更新 instance config 时会进行 JSON Schema 校验；若提供 `secretSchema`，创建或更新 instance secret 时会进行 JSON Schema 校验。

`long-running` 实例启动时，OctoBus 会从 runtime dir 执行解析出的 `node_entry`，并传入固定参数：

```text
--runtime serve --host 127.0.0.1 --port <port> --config <config.json> --secret <secret.json> --workdir <instance_workdir> --service <service_id> --instance <instance_id>
```

service 进程需要启动 gRPC server，并实现标准 gRPC health check

`on-demand` service 还需要支持一次性调用命令：

```text
--runtime invoke --method <package.Service/Method> --config <config.json> --secret <secret.json> --metadata <metadata.json> --workdir <instance_workdir> --service <service_id> --instance <instance_id>
```

OctoBus 会把 protobuf wire-format 请求写入 stdin，期望 stdout 只输出 protobuf wire-format 响应。OctoBus 还会设置 `OCTOBUS_PACKAGE_DIR=<runtime>/<service_root>`，因此 SDK 会从 service root 读取 `service.json`、proto 和 schema，同时完整 runtime dir 仍保留 distribution package root 的依赖布局。`@chaitin-ai/octobus-sdk` 的 `runServiceMain` 未带 `--runtime` 时进入业务 CLI；带 `--runtime` 时进入 runtime parser，支持 `serve`、`invoke`、`dev`、`inspect`、`client-stub` 和 `client-package` 等命令。

本地直接运行 service entry 时，可以用 `OCTOBUS_SERVICE_CONTEXT` 为业务 CLI 和
`--runtime dev` 注入默认 config/secret：

```bash
OCTOBUS_SERVICE_CONTEXT='{"config":{"baseUrl":"https://example.com"},"secret":{"token":"dev-token"}}' \
node bin/service.js call --data-json '{"id":"123"}'
```

SDK 也会读取当前执行目录 `.env` 中的同名变量，只读取该 key，不注入其他 `.env` 变量。
该变量不会影响 daemon 使用的 `--runtime serve` 或 `--runtime invoke` 协议；daemon 管理
instance 时继续通过文件和 fd 传递 config/secret。

## 开发

### 基本架构

```text
Client / Agent
  -> OctoBus Go binary
       -> public HTTP/2 h2c server
          -> gRPC gateway
          -> Connect RPC adapter
          -> MCP adapter
          -> reflection server
       -> localhost admin API
       -> SQLite store
       -> descriptor loader
       -> Node supervisor
            -> Node.js gRPC instance processes
            -> on-demand invoke subprocesses
```

主要代码目录：

- `cmd/octobus`：程序入口、root command、`serve` 命令和 daemon 组装
- `internal/cli`：Cobra CLI，所有管理命令都调用本地 admin API
- `internal/admin`：本地 admin HTTP API
- `internal/packageimport`：service package 获取、解包、runtime 准备和 descriptor 编译
- `internal/supervisor`：instance 配置写入、Node 子进程启动/停止/恢复、健康检查和日志
- `internal/store`：SQLite schema、迁移和领域对象读写
- `internal/protocol`：gRPC 代理、Connect RPC、MCP、catalog、OpenAPI 和 reflection
- `internal/descriptors`：proto descriptor 编译、加载和 method metadata 解析
- `sdk`：`@chaitin-ai/octobus-sdk` 的 TypeScript 源码、测试和构建产物
- `examples/calculator-js`：long-running JavaScript calculator service 示例
- `examples/calculator-on-demand-js`：on-demand JavaScript calculator service 示例
- `tests/e2e`：端到端测试
- `docs/design`：设计文档和目标说明

运行时数据大致分布：

```text
{data_dir}/
  octobus.db
  artifacts/services/{service_id}/
    <package-artifact>.tgz 或 package.zip
    package/
    runtime/
    descriptor.protoset
  instances/{instance_id}/
    config.json
    secret.json
    stdout.log
    stderr.log
    tmp/
```

daemon 重启时会从 SQLite 恢复 `enabled=true` 且 `runtime_mode=long-running` 的 instances，并重新拉起对应 Node.js 子进程；`on-demand` instances 不会预启动，后续请求到达时再调用 `invoke`

### 环境要求

- Go：项目 `go.mod` 声明 `go 1.26.1`
- Task：构建、检查和测试入口使用 `Taskfile.yml`
- Node.js / npm：导入和运行 Node.js service package 时需要
- `protoc`：导入 service 时会编译 proto descriptor，运行 e2e 测试也需要
- `git`：从 HTTPS Git source 导入 service 时需要，部分测试也会用到

### 构建与测试

项目使用 `Taskfile.yml` 管理 lint、test、build 三个阶段。运行全部阶段：

```bash
task all
```

也可以单独运行某个阶段：

```bash
task        # 列出可用任务
task lint
task test
task build
```

`task test` 会先构建本地 SDK 并安装 long-running / on-demand calculator 示例依赖，然后运行带跨包覆盖率统计的 Go 测试，其中包含 `tests/e2e`。`task build` 会生成 `bin/octobus`，并为 `version` 子命令注入构建元数据。如果当前提交正好位于匹配 `v[0-9]*` 的 OctoBus release tag 上，则使用该 tag 作为显示版本；否则使用当前提交历史上最近的可达匹配 tag、提交距离和短 commit 组成版本，例如 `v1.2.0-12-gabc1234`；如果没有可达匹配 tag，则退回短 Git commit。没有 Git 元数据的构建环境可以通过 `OCTOBUS_VERSION`、`OCTOBUS_COMMIT` 和 `OCTOBUS_BUILD_DATE` 覆盖注入值。可以通过以下命令查看结果：

```bash
./bin/octobus version
```

端到端测试也可以单独运行：

```bash
go test ./tests/e2e -count=1
```

端到端测试会构建真实 `octobus` binary，启动真实 daemon，并通过 CLI 调用 admin API，再验证 gRPC、Connect RPC、MCP、OpenAPI 和 reflection 入口

GitHub Actions 中的默认 CI 是轻量验证：检查公开痕迹、Go 格式和 vet，运行
`go test ./cmd/... ./internal/...`，构建 binary，并在 `sdk` 目录执行 npm test/build/pack
dry-run。完整 `task test` 和 e2e 仍是本地门禁。SDK 发布由 GitHub Release published
事件触发，release tag 必须为 `sdk-v<version>` 且匹配 `sdk/package.json.version`，并需要
仓库 secret `NPM_TOKEN`。
