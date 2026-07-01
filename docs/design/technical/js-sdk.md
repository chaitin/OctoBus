# JavaScript SDK 设计

## 定位

JavaScript SDK 是 OctoBus 面向 JavaScript service package 的开发与运行时支撑层。
它负责三件事：

- 帮助开发者生成一个最小可运行的 JavaScript service package。
- 从 service package 的 proto descriptor 生成 Connect/gRPC client。
- 在本地 service CLI 中把 protobuf 响应渲染成稳定的 JSON 输出。

SDK 的设计目标不是提供一个独立应用框架，而是把 OctoBus 的 service package
约定、descriptor 加载、gRPC/Connect 调用和本地开发体验封装成一组轻量工具。

## CLI 分层

SDK 有两个命令入口：

- `octobus-sdk`：开发者工具入口，负责 bootstrap、validate、inspect、client
  生成等工作。
- service package 自身的可执行文件：由 `runServiceMain(service)` 提供；未带
  `--runtime` 时进入业务 CLI，带 `--runtime` 时负责 `serve`、`invoke`、`dev`、
  `inspect` 等运行时命令，同时也暴露 client 生成命令。

这两个入口共享 client 生成逻辑。`octobus-sdk client-package` 与
`node bin/service.js --runtime client-package` 的输出结构和校验规则应保持一致。

运行时命令和生成命令的职责边界是：

- `--runtime serve`、`--runtime invoke`、`--runtime dev` 执行业务 handler。
- 未带 `--runtime` 的 service entry 把已实现的一元 method 暴露成本地业务 CLI。
- `--runtime client-stub`、`--runtime client-package` 只读取 package 元数据和 descriptor，不执行业务
  handler。

## Bootstrap 设计

`bootstrap` 生成一个最小 JavaScript service package，用作开发起点。生成内容包括：

- npm `package.json`
- OctoBus `service.json`
- config/secret JSON Schema
- 一个 proto 文件
- 一个可执行 handler 文件
- README

命名策略以 npm package name 为源：

- scoped package 取 scope 后的名字作为 service/package 派生名。
- proto package 由派生名 token 化后追加版本段。
- service class 使用 PascalCase，并按需追加 `Service`。

生成的 service 默认是 `on-demand` runtime mode，也可显式生成 `long-running`。
bootstrap 不负责打包或发布，只负责生成可验证、可继续编辑的 package scaffold。

为了支持离线导入或离线运行，bootstrap 提供 `--bundle-deps`。该模式会写入
`bundledDependencies` 并执行 `npm install --omit=dev`，但仍复用调用方当前 npm
配置，不额外引入 registry/auth/cache 参数。

## Client 生成设计

Client 生成分为两类：

- `client-stub`：输出一个单文件 ESM wrapper，适合快速开发或手动集成。
- `client-package`：生成 descriptor-backed npm package，适合业务项目直接依赖。

生成的 client package 自带 `descriptor.pb` 和 `service.json`，消费方不需要源
service package 目录、源 proto 文件或运行时 `protoc`。这是 client package 的核心
设计约束。

Connect 和 gRPC 的生成策略不同：

- Connect client 当前只暴露一元方法，与 Connect stub 当前能力一致。
- gRPC client 暴露一元、server streaming、client streaming 和 bidirectional
  streaming 方法。

生成代码对业务调用方暴露 service/method 属性，例如
`client.CalculatorService.Add(...)`。完整 method name string 保留在生成代码内部，
不要求业务代码手写。

gRPC client 额外暴露底层能力：

- 原始 `@grpc/grpc-js` client map。
- 完整 service/method map。
- 通用 `invoke` 入口。
- `close()` 释放连接。

`client-package` 支持依赖打包和发布：

- 默认只写 package 文件和 dependency metadata。
- `--bundle-deps` 安装生产依赖并写入 `bundledDependencies`。
- `--publish` 在生成目录运行 `npm publish`，复用当前 npm 配置。

## Descriptor Runtime

SDK 当前以 `@bufbuild/protobuf` 作为 descriptor、registry 和 JSON 处理基础。

从 service package 加载时，SDK 读取 `service.json` 中的 proto roots/files，调用
`protoc` 生成 descriptor set，然后构建 `FileRegistry`。从 generated client package
加载时，SDK 直接读取 package 内的 `descriptor.pb`。

加载后的 runtime package 包含：

- package 目录和 manifest。
- descriptor set。
- `FileRegistry`。
- service descriptors。
- 供 `@grpc/grpc-js` 使用的 service definitions。

这种结构让同一份 descriptor 同时服务于：

- runtime gRPC server 注册。
- Connect/gRPC client stub。
- client package 生成。
- service CLI JSON Schema 和 ProtoJSON 输出。

descriptor-backed loader 可以在没有 proto 源文件的消费方项目中工作。若提供
`service.json`，它只作为元数据读取，不要求其中引用的 proto 文件在消费方存在。

## gRPC Streaming 框架

gRPC runtime 按 method definition 的 `requestStream` 和 `responseStream` 区分四类
method：

- unary
- server streaming
- client streaming
- bidirectional streaming

client 侧统一通过 `invoke` 分派到具体调用路径。server/bidi streaming 被封装为
`AsyncIterable`，并保留 `cancel()` 和 raw stream。client/bidi streaming 接受
`Iterable` 或 `AsyncIterable` 请求序列，写完后关闭请求流。

server 侧 `runServiceMain` 注册 gRPC service 时也按 method kind 分派：

- unary handler 使用 `ctx.request`。
- client/bidi streaming handler 使用 `ctx.requests`。
- server/bidi streaming handler 返回 iterable response。

metadata、config、secret、serviceId、instanceId、workdir、packageDir 等上下文在不同
method kind 中保持一致。

## Service CLI 与 ProtoJSON

service package 的业务 CLI 只暴露已实现的一元 method。它的职责是让 service
作者和使用者可以在本地用 JSON 调用业务 method，而不是替代 gRPC/Connect runtime。

CLI 输入路径：

1. 读取 `--data-json`、`--data` 或 stdin。
2. 使用 descriptor message 通过 `fromJson` 做输入转换和校验。
3. 解析本地 CLI context。真实环境变量和当前执行目录 `.env` 中的
   `OCTOBUS_SERVICE_CONTEXT` 可以按字段覆盖 `config` 和 `secret`。
4. 把转换后的对象交给 handler 作为 `ctx.request`。

CLI 输出路径：

1. handler 返回普通 JavaScript object。
2. SDK 使用 method definition 完成 protobuf serialize/deserialize。
3. 使用 `@bufbuild/protobuf` 的 `toJson` 输出 ProtoJSON 语义 JSON。

JSON Schema 也基于 descriptor 生成。字段名使用 descriptor 的 `jsonName`，因此默认
lowerCamel 和自定义 `json_name` 都保持一致。

这条路径只影响本地 service CLI 的 JSON 输出，不改变：

- gRPC server 行为。
- on-demand `invoke` 的 binary protobuf 协议。
- daemon 与 Node runtime 的交互协议。
- handler 的 request/response 编写约定。

## Service CLI Context

`OCTOBUS_SERVICE_CONTEXT` 是 SDK 为本地业务 CLI 和 `--runtime dev` 提供的便利契约，
用于减少重复输入 config/secret：

```json
{
  "config": {
    "baseUrl": "https://example.com"
  },
  "secret": {
    "token": "dev-token"
  }
}
```

该变量值必须是 JSON object，只允许顶层 `config` 和 `secret` 字段。空字符串视为未设置；
非法 JSON、非 object 顶层、未知字段都会返回清晰错误。`config` 和 `secret` 可以分别
省略；出现时其值可以是任意合法 JSON，包括 `null`。

SDK 还会读取当前执行目录的 `.env` 文件，只解析其中的 `OCTOBUS_SERVICE_CONTEXT`，不会把
其他 `.env` 变量注入进程。查找范围是 `options.cwd ?? process.cwd()`，不从 service
package root 或 `--workdir` 查找。

优先级按字段独立计算：

1. 真实环境变量 `OCTOBUS_SERVICE_CONTEXT`。
2. 当前执行目录 `.env` 中的 `OCTOBUS_SERVICE_CONTEXT`。
3. 显式 CLI 参数：`--config`、`--config-json`、`--secret`、`--secret-json`。
4. 默认值 `{}`。

如果环境上下文只包含 `secret`，则 `ctx.secret` 使用环境值，`ctx.config` 仍可来自
`--config-json` 或默认值。该能力只在未带 `--runtime` 的业务 CLI 和 `--runtime dev`
生效；`--runtime serve`、`--runtime invoke`、`--runtime inspect`、client generation
和 `octobus-sdk` developer CLI 不读取该变量。daemon 管理 instance 时继续使用
`--config <file>` 和 `--secret-fd` / `--secret` 等运行时协议，不通过环境变量传 secret。

本地业务 CLI 的 root help 会显示 Environment 小节，method help 的 JSON contract 会包含
`environment.OCTOBUS_SERVICE_CONTEXT` 描述。文档和错误信息不得输出完整 secret 值。

## Runtime Helper Surface

SDK 运行时对 service adapter 暴露一组可复用 helper，目标是收敛重复的 context、错误、HTTP 和
descriptor JSON 处理，而不是替代 service 自己的上游业务语义。

context helper：

- `normalizeContext` 规范化 handler context。
- `mergeConfigSecret` 返回 `{ ...ctx.config, ...ctx.secret }`，用于不需要兼容旧 bindings 的
  service。
- `getMetadataValue` 按统一规则读取 metadata key。

error helper：

- `grpcCodeFor` 把字符串 code 转成 gRPC status code。
- `serviceError`、`missingSecretError` 用于构造常见 service error。
- `redactSensitive`、`safeErrorSummary` 用于生成不泄露 secret 的错误摘要。
- `httpStatusError` 和 `mapHttpStatusToCode` 提供默认 HTTP status 到 gRPC code 的映射。

HTTP helper：

- `normalizeTimeoutMs` 解析 timeout，并在非法或缺失时回退到默认值。
- `createTlsDispatcher(true)` 创建 per-request/per-client TLS skip dispatcher，避免全局修改
  `NODE_TLS_REJECT_UNAUTHORIZED`。
- `fetchWithTimeout` 使用真实 abort 机制：timeout 映射为 `DEADLINE_EXCEEDED`，外部 abort 映射为
  `CANCELLED`，网络失败映射为 `UNAVAILABLE`。
- `readResponseText`、`readResponseJson` 和 `assertOkResponse` 提供 response 读取和基础校验。

protobuf JSON helper：

- `messageJsonSchema`、`protobufMessageToProtoJson`、`fieldJsonName`、`normalizeTypeName` 面向
  descriptor-backed CLI、schema 和 ProtoJSON 输出。

这些 helper 是可选复用层。service adapter 可以只复用其中不会改变行为的一部分；HTTP status
映射、非法 JSON 映射、protobuf `google.protobuf.Value` shape、登录/session、签名、业务 code
和 response payload shape 仍由具体 service 的测试与文档维护。

## 实现模块

主要实现集中在 `sdk/src`：

- `bootstrap.ts`：生成 service package scaffold，并处理 bundled dependencies。
- `cli.ts`：定义 SDK CLI 和 runtime CLI，协调 validate、inspect、serve、invoke、
  service CLI、`OCTOBUS_SERVICE_CONTEXT` 和 client generation。
- `proto-loader.ts`：读取 service manifest、生成或读取 descriptor set、构建 registry
  和 gRPC service definitions。
- `client-stub.ts`：从 loaded service package 生成 Connect/gRPC wrapper source。
- `client-package.ts`：生成 descriptor-backed npm client package，并处理 bundle/publish。
- `connect-stub.ts`：Connect RPC client runtime。
- `context.ts`：规范化 handler context，并提供 config/secret 合并和 metadata 读取 helper。
- `errors.ts`：提供 gRPC status helper、HTTP status 映射和敏感信息脱敏辅助。
- `grpc-stub.ts`：gRPC client runtime 和 streaming adapter。
- `http.ts`：提供真实 timeout、per-request TLS dispatcher、response text/JSON 安全读取和 HTTP
  response helper。
- `protobuf-json.ts`：service CLI JSON Schema 和 ProtoJSON 输出。

模块之间的依赖关系以 descriptor 为中心：

- `proto-loader.ts` 产出 loaded package。
- client/runtime/CLI 都消费 loaded package。
- 生成逻辑不直接解析 proto 源码，而是消费 descriptor 和 registry。

## 设计边界

当前设计刻意不覆盖以下能力：

- 浏览器版 client。
- 精确 protobuf message TypeScript 类型生成。
- Connect streaming。
- `connect`、`grpc` 之外的 transport。
- 自动 `npm pack`。
- 自定义 npm registry/auth/cache CLI 参数。

这些能力可以后续扩展，但不应破坏当前核心约束：service package 以 descriptor 为
事实来源，generated client package 可以脱离源 package 独立运行。
