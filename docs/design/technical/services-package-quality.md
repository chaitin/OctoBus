# Services Package Quality

## 定位

`services/` 是 OctoBus 当前维护的公开多服务 npm distribution package，根 package name 为
`@chaitin-ai/octobus-tentacles`。它不是一组独立 npm package，而是一个根 package 中包含
多个 service root；每个 service root 通过自己的 `service.json` 声明一个可导入的
OctoBus service。

当前仓库约束下，`services/` 包含 50 个含 `service.json` 的 service root。根
`services/package.json` 必须为这些 service 暴露同名 `bin` entry，并额外暴露默认
dispatcher `octobus-tentacles`。根 `files` 必须覆盖每个 service root、根 `bin/`、
validator/test/smoke 所需脚本，以及运行时需要的共享文件。

当前 `services/` 依赖基线是 `@chaitin-ai/octobus-sdk` `^0.6.0`。根
`services/package.json` 直接声明 `@chaitin-ai/octobus-sdk`、`commander`、`undici` 和
`@alicloud/swas-open20200601`，并在 `bundledDependencies` 中打包这些运行时依赖。每个
service root 的 `package.json` 是本地开发辅助，也应声明同一 SDK semver range，方便在
service 目录内运行 focused 测试。

本文描述该分发包的长期质量线。具体 service 的业务字段、上游 API 语义和 mock upstream
细节由各 service root 的 README、proto、schema 和测试维护。

## Service Root 结构

每个生产 service root 必须至少包含：

- `service.json`
- `README.md`
- `config.schema.json`
- `secret.schema.json`
- `proto/*.proto`
- `bin/<service-name>.js`
- `src/service.js`
- 业务实现模块，例如 `src/<service-name>.js`
- `test/*.test.js` 或等价 Node test 文件

对 HTTP/API 集成服务，推荐提供 `test/mock_upstream.js`，让测试和 smoke harness 不依赖真实
厂商环境。

命名规则来自 [service-package.md](service-package.md)：

- service root 目录使用 `<vendor>__<product>[_version]`。
- `service.json.name` 使用 lower-kebab，必须匹配根 `package.json bin` key、根 wrapper
  文件名和 dispatcher key。
- 子目录 `package.json` 只可作为本地开发辅助，不参与 OctoBus import/runtime 依赖解析。

## 根 Wrapper 和 Dispatcher

根 `bin/<service>.js` wrapper 必须通过 SDK `runServiceMain(service, { entryFile })` 指向真实
service-local bin。`entryFile` 让 SDK 从真实 service root 向上查找 `service.json`，同时保持
用户当前工作目录不变。

根 `bin/octobus-tentacles.js` 是默认 dispatcher。它根据第一个参数选择 service，并把剩余参数
透传给对应 service entry。dispatcher 只处理根包 help、未知 service 报错和 service 选择，
不解释具体 service 的业务参数。

根 wrapper 和 service-local `bin/*.js` 都必须具有可执行位。validator 会把缺失可执行位视为
package contract 错误。

## Handler 合约

所有通过 `defineService({ handlers })` 导出的 runtime handler 都必须只接收单参数 `ctx`。

一元 method 的真实输入来自 `ctx.request`。config、secret、metadata、service id、instance id、
workdir 和 package dir 来自 SDK runtime 填充的 context。服务内部可以保留
`handleX(request, runtime)` 这类纯函数，但导出的 `handlers[METHOD]` 不能依赖
`handlers[METHOD](req, ctx)` 形态。

兼容旧测试时可以在内部 helper 中读取 `ctx.req`，但 production runtime contract 仍是
`ctx.request`。新增测试应直接覆盖 `handlers[METHOD]({ request, config, secret, ... })`
单参数路径。

## Config、Secret 和 Credential Surface

credential、session token、cookie、webhook token、AK/SK、password、API key 和私钥等敏感材料
必须放在 instance `secret` 中。兼容旧 schema 时，某些 service 可以保留 deprecated config
fallback，但优先级必须低于 `ctx.secret`，并在 README 中说明。

RPC request payload 不应作为 credential happy path。若 proto 为兼容历史保留 deprecated
credential 字段，runtime 不应让 request 字段覆盖 instance secret。response、error details、
stdout/stderr log、daemon log 和 access log 都不得输出完整 credential、完整 webhook URL、
cookie、session 或完整上游 raw body。

secret schema 文件本身是 package contract 的一部分，文件名为 `secret.schema.json` 不代表包含
真实 secret。真实 secret 只能来自 instance secret 输入，并由 OctoBus 以独立文件或 fd 传入。

## HTTP、TLS 和错误映射

使用标准 `fetch` 的 service 不得把 `timeoutMs`、`skipTlsVerify`、
`tlsInsecureSkipVerify` 或 `insecureSkipVerify` 作为 fetch init 伪 option 传入。timeout 必须通过
`AbortController`、`AbortSignal.timeout` 或 SDK `fetchWithTimeout` 等真实 abort 机制实现。

需要支持跳过 TLS 校验时，必须使用 per-request 或 per-client `undici.Agent` dispatcher。不得修改
`process.env.NODE_TLS_REJECT_UNAUTHORIZED`，也不得用全局可变状态影响其他 service 或其他 instance。
如果某个官方 SDK 不支持 TLS skip，service 应明确拒绝该配置并在 README/test 中固定行为。

错误映射应保持稳定：

- 缺 config/secret/request 必填字段：`INVALID_ARGUMENT`
- 上游认证失败：`UNAUTHENTICATED` 或 `PERMISSION_DENIED`
- 上游 4xx 业务前置条件失败：`FAILED_PRECONDITION`
- 上游 5xx、网络错误、body read failure：`UNAVAILABLE`
- timeout：`DEADLINE_EXCEEDED`
- 非 JSON 或无法映射的成功响应：`UNKNOWN`

错误对象可以携带 HTTP status、body length、上游业务 code 或安全摘要，但不能携带完整 raw body 或
secret-bearing 字段。

## SDK Helper 复用边界

service 可以复用 `@chaitin-ai/octobus-sdk` 提供的低层 helper，但 SDK helper 不拥有厂商 API
的业务语义。是否替换本地逻辑，以 service-local README、proto、schema 和测试固定的错误码、
message、details、response shape 为准。

可优先复用的通用 helper 包括：

- `grpcCodeFor`、`serviceError`、`missingSecretError`、`redactSensitive`、
  `safeErrorSummary`：用于构造 gRPC error 和脱敏错误摘要。
- `normalizeContext`、`mergeConfigSecret`、`getMetadataValue`：用于规范化 handler context、
  合并 config/secret 和读取 metadata。
- `normalizeTimeoutMs`、`createTlsDispatcher`、`fetchWithTimeout`、`readResponseText`、
  `readResponseJson`、`assertOkResponse`：用于 timeout、TLS dispatcher、fetch 和 response
  读取。

复用时必须遵守以下边界：

- `mergeConfigSecret(ctx)` 只合并 `ctx.config` 和 `ctx.secret`。如果 service 保留
  `ctx.bindings` 兼容层，不得用该 helper 直接替换既有优先级；当前多数 service 仍需要保留
  bindings 兼容逻辑。
- `fetchWithTimeout` 会把 timeout 映射为 `DEADLINE_EXCEEDED`、外部 abort 映射为
  `CANCELLED`、网络失败映射为 `UNAVAILABLE`。如果现有测试固定网络错误 message 或 cause，
  应继续保留本地 fetch wrapper，只复用 `normalizeTimeoutMs` 等不改变错误对象的 helper。
- `readResponseJson` 对非法 JSON 抛 `INTERNAL`。如果 service 当前要求非法 JSON 为
  `UNKNOWN`，或需要保留原始 body 长度、截断摘要、业务 payload 字段，不能直接替换。
- SDK 默认 HTTP status 映射会将 400 映射为 `INVALID_ARGUMENT`、404 映射为 `NOT_FOUND`。
  如果 service 对上游 4xx 使用 `FAILED_PRECONDITION` 或自定义 `PERMISSION_DENIED`，必须保留
  service-local 映射。
- `protobuf-json.ts` 中的 JSON/descriptor helper 不等价于各 service 手写的
  `google.protobuf.Value` object shape 转换；这些转换只有在测试证明完全等价时才能替换。

当前 group robot services 已复用 SDK 中不改变业务语义的 helper：钉钉、飞书和 Slack group
robot 使用 `grpcCodeFor` 和 `normalizeTimeoutMs`；飞书 group robot 还使用
`createTlsDispatcher(true)` 提供模块级 TLS skip dispatcher。它们仍保留本地 config/secret/
bindings 合并、fetch、response 读取和 HTTP status 映射，以维持既有错误 message、legacy 字段
和 response payload shape。

## Validator、测试和 Coverage

`services/scripts/validate-service-package.mjs` 是 services package 的结构门禁。它检查：

- 根 package name、root dispatcher、root `bin` 和直接 dependency。
- service root 目录名、`service.json.name`、root wrapper、service-local bin 和 dispatcher mapping。
- 根 `package.json files` 是否包含 service root 和 wrapper。
- manifest 引用的 proto、config schema、secret schema 和 service entry 是否存在且在 service root 内。
- production `src` 中的全局 TLS 降级、`globalThis.proxy` 和可静态检测的双参数 handler。
- service root 中的 `.tgz`、`.tar.gz`、`.zip`、日志、截图、`.env`、`node_modules` 等污染文件。

`services/scripts/run-tests.mjs` 是 Node test 入口：

```bash
cd services
npm test
npm test -- --service-dir <service-dir>
npm test -- --coverage --service-dir <service-dir>
```

coverage 模式默认要求 branch、function 和 line 都达到 90%。该门禁用于高风险服务、实质改动服务
和阶段性质量抽样；全量 service package 的基础门禁仍是 validate/test/pack check。

## Package 内容门禁

`cd services && npm run pack:check` 使用 `npm pack --dry-run` 检查最终分发内容。由于
`@chaitin-ai/octobus-tentacles` 使用 `bundledDependencies`，dry-run 中出现
`node_modules/**` 是预期的 npm bundled dependency 展开结果；项目自身 service root 不应包含
vendored SDK tarball、截图、日志、`.env`、本地 data dir、coverage、packaged artifact 或真实凭据。

git tracked files 也必须保持同样约束：不跟踪 `node_modules`、`.env`、日志、打包产物、截图、
coverage、local data 或 instance secret。生成目录如 `bin/`、`.task/`、`coverage/`、SDK/example
`node_modules/`、`sdk/dist/` 和 `services/node_modules/` 只能作为 ignored 本地产物存在。

## OctoBus Smoke Harness

`scripts/service-package-smoke.mjs` 是仓库级 service package smoke harness。它要求先构建
`bin/octobus`：

```bash
task build
node scripts/service-package-smoke.mjs
node scripts/service-package-smoke.mjs --service-dir <service-dir>
```

harness 会启动临时 OctoBus daemon 和本地 mock upstream，对每个 service 执行：

1. `octobus service import <service> ./services//<service-dir> --build never`
2. 根据 config/secret schema 合成 fake config 和 secret。
3. 创建 instance、capset，并把 instance 加入 capset。
4. 读取 Connect catalog/OpenAPI，选择一个可调用的一元 method。
5. 通过 Connect JSON 调用该 method，记录 HTTP status、response 摘要和 mock upstream 命中数。

该 harness 验证的是 OctoBus 链路：service import、instance create、capset add-instance、
descriptor/OpenAPI/catalog、runtime invoke 和 Connect 调用。它不调用真实厂商环境，也不把真实
secret 写入 evidence。

## 常用门禁

services package 修改后按风险选择以下门禁：

```bash
cd services && npm run validate
cd services && npm test
cd services && npm run pack:check
cd services && npm run validate -- --service-dir <service-dir>
cd services && npm test -- --service-dir <service-dir>
cd services && npm test -- --coverage --service-dir <service-dir>
```

涉及 SDK、runtime、package import、routing protocol、supervision、CLI 或 smoke harness 时，还要运行
仓库级门禁：

```bash
task lint
task test
task build
go test ./tests/e2e -count=1
cd sdk && npm test && npm run build && npm pack --dry-run
```

Docker 或发布路径没有改动时，不要求运行 Docker dry-run。
