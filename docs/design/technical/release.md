# Release And Public Repository

## Public Repository Boundary

OctoBus 的公开仓库不能依赖私有开发或构建环境。源码、文档、CI、示例和 service 文档
不得引用私有 CI 系统、私有 npm registry、私有容器 registry、开发机绝对路径、私有
`.npmrc`、私有 lockfile tarball URL 或 token。

兼容命名不属于清理对象，必须保留：

- `@chaitin-ai/octobus-sdk`
- `@chaitin-ai/octobus-tentacles`
- `chaitin.octobus.service.v1`
- 现有 `chaitin__*` service root
- 既有 proto package、RPC path 和 service package schema

Git remote 不是仓库文件事实。发布到 GitHub 前，维护者需要在本机或发布环境中配置正确
remote；仓库文档不记录本地 remote。

## GitHub Actions

公开仓库的唯一 CI 配置入口是 `.github/workflows/ci.yml`。默认 `validate` job 在 pull
request、`main` 分支 push、`v*` tag push 和 `sdk-v*` tag push 上运行。

`validate` job 负责轻量验证：

- 检查公开痕迹，扫描 `README.md`、`.github`、`Taskfile.yml`、`scripts`、`internal`、
  `cmd`、`examples`、`services`、`sdk`、`npm` 和 `docs/design`，排除 `node_modules`。
- 安装 Go、Node.js 22 和 `protobuf-compiler`。
- 运行 Go 格式检查和 `go vet ./...`。
- 运行 `go test ./cmd/... ./internal/...`。
- 运行静态 `octobus` 构建，并用 `ldd` 确认不是动态可执行文件。
- 运行 OctoBus npm binary packages 构建和 `npm pack --dry-run`。
- 在 `sdk` 目录运行 `npm ci`、`npm test`、`npm run build`、`npm pack --dry-run`。

该 job 不运行 `task test`、`tests/e2e`、示例 npm install 或 `services` 依赖安装。完整
本地门禁仍由 `Taskfile.yml` 提供：`task lint`、`task test`、`task build` 或
`task all`。

## OctoBus Npm Release

OctoBus daemon/CLI 通过 npmjs 分发为一个主包和多个平台 binary 包：

- `@chaitin-ai/octobus`：主包，提供 `octobus` bin launcher。
- `@chaitin-ai/octobus-linux-x64`
- `@chaitin-ai/octobus-linux-arm64`
- `@chaitin-ai/octobus-darwin-x64`
- `@chaitin-ai/octobus-darwin-arm64`
- `@chaitin-ai/octobus-win32-x64`
- `@chaitin-ai/octobus-win32-arm64`

主包通过 `optionalDependencies` 引用所有平台包。安装时 npm 只会安装匹配当前
`os`/`cpu` 的平台包；launcher 根据 `process.platform` 和 `process.arch` 找到真实 Go
binary 并转发参数。

OctoBus npm 发布由同一个 workflow 中的 `publish-octobus` job 完成：

- 仅在 `v<semver>` tag push 构建触发，允许 prerelease 后缀。
- 依赖 `validate` job 通过。
- tag 中版本必须等于 `npm/octobus/package.json.version`。
- 发布前用 `scripts/build-octobus-npm-packages.sh --dry-run` 交叉构建所有平台 binary，
  该脚本复用 `scripts/build-octobus.sh` 的 version/commit/date 注入和静态构建参数。
- 通过 npm trusted publishing（GitHub OIDC）认证，不使用 npm token secret。
- 启用 npm provenance 所需的 `id-token: write` 权限。
- prerelease 使用 `npm publish --access public --provenance --tag next`。
- stable release 使用 `npm publish --access public --provenance`。
- 先发布平台包，最后发布 `@chaitin-ai/octobus` 主包。

该 npm 包只安装 OctoBus 自身 binary。service import 和 runtime 仍要求使用者本机提供
`node`、`npm`、`protoc` 和 `git`。

## SDK Npm Release

SDK 发布只覆盖 `sdk/` 下的 `@chaitin-ai/octobus-sdk` 包。`services/` 聚合包保持
`private: true`，不作为 npm 发布对象。

SDK 通过同一个 workflow 中的 `publish-sdk` job 发布：

- 仅在 `sdk-v<semver>` tag push 构建触发，允许 prerelease 后缀。
- 依赖 `validate` job 通过。
- tag 中版本必须等于 `sdk/package.json.version`。
- 发布前重新运行 SDK `npm ci`、`npm test`、`npm run build`、`npm pack --dry-run`。
- 通过 npm trusted publishing（GitHub OIDC）认证，不使用 npm token secret。
- 启用 npm provenance 所需的 `id-token: write` 权限。
- prerelease 使用 `npm publish --access public --provenance --tag next`。
- stable release 使用 `npm publish --access public --provenance`。

发布目标是 npmjs 默认 registry。仓库不提交 registry token，也不在 `sdk/package.json`
中绑定私有 registry。

## Lockfile And Generated File Policy

`sdk/package-lock.json` 是唯一跟踪的 npm lockfile，用于 SDK 可复现安装和 CI npm cache。
普通 `package-lock.json`、示例 lockfile、`services/package-lock.json` 和
`node_modules/` 都不进入版本控制。

以下本地生成物不得提交：

- `bin/`
- `npm/octobus-*/bin/`
- `npm/dist/`
- `.octobus/`
- `coverage/`
- `node_modules/`
- service artifact
- 日志文件
- token、secret 或私有 `.npmrc`

示例和 smoke 流程如果生成 `package-lock.json`，该文件保持 ignored，且不得包含内部
registry URL。

## Public Smoke Path

仓库提供 `task example:clean-checkout-smoke` 作为干净 checkout 用户路径验证入口。该任务
会执行清理、构建 binary、构建本地 SDK、安装 calculator 示例依赖、启动临时 daemon、
导入 calculator service、创建 instance/capset，并通过 Connect RPC 调用断言
`result: 42`。

该 smoke 不纳入默认 GitHub 轻量 CI，因为它会安装示例依赖并启动真实 daemon，耗时和运行
形态都更接近本地完整门禁。
