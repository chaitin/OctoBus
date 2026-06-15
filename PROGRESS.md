# Recursive Service Import Progress

本文档把 `octobus service import --recursive SOURCE` 的技术方案和实施计划拆成可执行台账。任务按依赖顺序推进；标记为“可并行”的子任务可在同一父任务内并行处理，subagent 并发度最高不超过 5。

## 文档索引

- 技术方案：[docs/spec/recursive-service-import-spec.md](docs/spec/recursive-service-import-spec.md)
- 实施计划：[docs/plan/recursive-service-import-implementation-plan.md](docs/plan/recursive-service-import-implementation-plan.md)
- Harness：[AGENTS.md](AGENTS.md)
- Task 工作流：[Taskfile.yml](Taskfile.yml)
- CLI 设计：[docs/design/product/cli.md](docs/design/product/cli.md)
- Multi-service package 设计：[docs/design/technical/multi-service-npm-package.md](docs/design/technical/multi-service-npm-package.md)
- Service package contract：[docs/design/technical/service-package.md](docs/design/technical/service-package.md)
- 架构总览：[docs/design/overview.md](docs/design/overview.md)

## 执行规则

- [ ] 每个任务完成时必须同时完成对应测试方案和验收标准。
- [ ] 不跨阶段合并依赖未满足的功能；可并行子任务只在同一父任务内部并行。
- [ ] 行为变更必须有 Go 单测、integration/e2e 或 Node 脚本测试证明，不能只改实现。
- [ ] 涉及 CLI、package import、daemon 管理或 supervision 的阶段性收口必须运行对应 focused tests；最终按 harness 运行 `task test`、`task lint`、`task build` 或 `task all`。
- [ ] 不提交 `bin/`、coverage、node_modules、日志、data dir、packaged service artifacts 或 secrets。
- [ ] 所有错误信息和日志不得泄露 Git credential、config 或 secret 内容。
- [ ] 完成总结必须写明证据：变更点、测试命令、关键输出或未运行原因。

## 1. 固定公共契约和测试夹具

参考文档：[实施计划阶段 1](docs/plan/recursive-service-import-implementation-plan.md)、[技术方案 API 变化](docs/spec/recursive-service-import-spec.md)。

- [x] 1.1 定义 recursive import 公共类型
  - 依赖：无。
  - 工作内容：在 `internal/packageimport.Options` 增加 `Recursive bool json:"recursive"`；定义 recursive import 返回结构，覆盖 `Services []domain.Service`、service count、按 service id 聚合的 restarted instances 和 restart errors。
  - 可并行子任务：
    - [x] 可并行：审查现有 admin JSON 输出命名，确认 recursive 响应不破坏单 service import wire shape。
    - [x] 可并行：审查 `internal/packageimport` 现有 `Result` 使用点，确认新增类型不影响现有调用方。
  - 测试方案：`go test ./internal/packageimport ./internal/admin ./internal/cli`。
  - 验收标准：类型可被 admin、CLI 测试引用；单 service import 请求和响应结构保持兼容。
  - 完成总结：已在 `internal/packageimport.Options` 增加 `Recursive bool json:"recursive"`，并新增 `RecursiveResult` 结构承载 services、service count、manifest map、restarted instances 和 restart errors。未接入行为分流，现有单 service import 调用点保持不变。验证命令：`go test ./internal/packageimport ./internal/admin ./internal/cli`，结果通过。

- [x] 1.2 建立 multi-service importer 测试夹具
  - 依赖：1.1。
  - 工作内容：在 `internal/packageimport/importer_test.go` 增加 fixture helper，生成根 `package.json bin`、多个 service root、proto、schema、嵌套目录和 discovery 干扰目录。
  - 可并行子任务：
    - [x] 可并行：准备成功导入 fixture，覆盖多个 service root。
    - [x] 可并行：准备失败 fixture，覆盖重复 ID、非法 ID、缺 bin、坏 schema、坏 proto、空发现。
    - [x] 可并行：准备 scan root fixture，覆盖 `source//some-dir` 子树发现。
  - 测试方案：`go test ./internal/packageimport`。
  - 验收标准：fixture 能独立构造 deterministic package；不依赖用户 home 目录或真实 registry。
  - 完成总结：已在 `internal/packageimport/importer_test.go` 增加 `writeMultiServiceTestPackage`、`writeMultiServiceRoot` 和 ignored service helper。夹具生成 root `package.json bin`、三个 service roots（含 nested 子树）、proto、config/secret schema、bin entry，以及 `node_modules`、`.git`、隐藏目录和普通目录干扰项；后续测试可通过修改生成结果覆盖重复 ID、非法 ID、缺 bin、坏 schema、坏 proto 和空发现。验证命令：`go test ./internal/packageimport`，结果通过。

- [x] 1.3 写入目标行为测试骨架
  - 依赖：1.1、1.2。
  - 工作内容：新增 CLI、admin、importer 的目标行为测试，先表达 `--recursive SOURCE`、`recursive:true`、响应聚合、预校验零提交和请求校验规则。
  - 可并行子任务：
    - [x] 可并行：`internal/cli/cli_test.go` 增加 recursive 参数和 source 规范化测试。
    - [x] 可并行：`internal/admin/admin_test.go` 增加 recursive 响应和请求校验测试。
    - [x] 可并行：`internal/packageimport/importer_test.go` 增加 recursive success/failure 测试。
  - 测试方案：`go test ./internal/packageimport ./internal/cli ./internal/admin`。
  - 验收标准：新增测试失败原因指向尚未实现的 recursive import，而不是夹具或编译错误。
  - 完成总结：已新增 CLI recursive 请求体测试，验证 `service import --recursive SOURCE` 发送 `recursive:true`、保留 source、默认 build，并且不发送 `service_id`/`name`；新增 recursive 缺 source、多参数、`--name` 互斥校验。Admin 层新增 importer 接口便于目标行为测试，接入 recursive 请求校验、响应聚合骨架和按 service id 初始化的 restart 聚合 map；测试覆盖 `recursive:true` 的非法组合和成功聚合响应。Importer 层新增 `ImportRecursive` 占位方法和失败零提交测试，明确后续实现前返回 `recursive import is not implemented` 且不写入 store；同时修复 multi-service fixture helper 的 service root/proto 目录创建。验证命令：`go test ./internal/packageimport ./internal/cli ./internal/admin`，结果通过；额外验证 `go test ./cmd/octobus ./internal/integration`，结果通过，确认 admin importer 接口改动不破坏外部包构造和 integration 编译。

## 2. Source 规范化和 recursive discovery

参考文档：[实施计划阶段 2](docs/plan/recursive-service-import-implementation-plan.md)、[技术方案 Source 规范化要求](docs/spec/recursive-service-import-spec.md)。

- [x] 2.1 修正 CLI source 规范化
  - 依赖：1.3。
  - 工作内容：重构 `normalizeImportSource`，非 HTTPS Git source 先拆分 `//service-dir`，只将 package root 转绝对路径，再拼回 suffix；HTTPS Git source 保持原样。
  - 可并行子任务：
    - [x] 可并行：补充 `./pkg//nested` 和 `npm:./pkg//nested` 测试。
    - [x] 可并行：补充 HTTPS Git source 不被拆分或破坏的测试。
  - 测试方案：`go test ./internal/cli`。
  - 验收标准：本地 source 规范化保留 `//service-dir`；旧单 service local/npm source 测试继续通过。
  - 完成总结：已将 `normalizeImportSource` 调整为对非 URL source 先拆分 `//service-dir`，只对 package root 调用本地绝对路径规范化，再拼回 service root；`npm:` source 复用同一逻辑并保留前缀；包含 `://` 的 HTTPS Git source 原样传递给 importer。新增 `TestNormalizeImportSourcePreservesServiceRoot` 覆盖 `./pkg//nested`、`npm:./pkg//nested` 和 HTTPS Git `//svc@ref` 不被拆分。验证命令：`go test ./internal/cli`，结果通过。

- [x] 2.2 实现 service root 递归发现 helper
  - 依赖：1.2。
  - 工作内容：在 `internal/packageimport` 新增 discovery helper，输入 package dir 和 scan root，输出稳定排序的 package root 相对 service roots；命中 `service.json` 后不深入；跳过 `node_modules`、`.git` 和隐藏目录。
  - 可并行子任务：
    - [x] 可并行：实现 scan root 校验和错误信息。
    - [x] 可并行：实现遍历跳过规则和稳定排序。
    - [x] 可并行：为 root service、嵌套 service、空发现和跳过目录写单测。
  - 测试方案：`go test ./internal/packageimport`。
  - 验收标准：discovery 输出与文件系统遍历顺序无关；scan root 不存在、非法或空发现时返回明确错误。
  - 完成总结：已新增 `discoverServiceRoots(packageDir, scanRoot)` helper，默认 scan root 为 `"."`，对非根 scan root 复用 `cleanServiceRoot` 做包内路径校验；扫描时发现 `service.json` 即记录 package root 相对 service root 并停止深入，跳过 `node_modules`、`.git` 和点号开头目录，最终按 service root 稳定排序。新增测试覆盖全包发现、`nested` scan root、package root 自身就是 service root 时不继续深入、scan root 缺失、scan root 是文件、空发现和非法路径。验证命令：`go test ./internal/packageimport`，结果通过。

- [x] 2.3 保持单 service source 解析兼容
  - 依赖：2.1、2.2。
  - 工作内容：确认 `splitSourceServiceRoot`、`cleanServiceRoot`、`sourceWithServiceRoot`、`parseGitSource` 的现有单 service 行为未被 recursive discovery 改动破坏。
  - 可并行子任务：
    - [x] 可并行：补齐单 service `//service-dir` 边界测试。
    - [x] 可并行：补齐 Git `//subdir@ref` 不回归测试。
  - 测试方案：`go test ./internal/packageimport ./internal/cli`。
  - 验收标准：现有 `TestSplitSourceServiceRoot` 和 Git source 测试通过；recursive helper 不改变 HTTPS Git parser 责任边界。
  - 完成总结：已扩展 `TestSplitSourceServiceRoot`，覆盖 trailing slash 清理、重复 slash 清理和 `npm:./tentacle//nested/vendor__gamma` 边界，确认单 service source/root 拆分行为保持兼容；已扩展 `TestParseGitSourceAcceptsSupportedForms`，覆盖 HTTPS Git `//services/nested@feature/subdir`，确认 Git parser 仍负责 subdir 和带 slash ref 的解析，recursive discovery helper 未改变 Git 责任边界。验证命令：`go test ./internal/packageimport ./internal/cli`，结果通过。

## 3. Importer recursive 核心流程

参考文档：[实施计划阶段 3](docs/plan/recursive-service-import-implementation-plan.md)、[技术方案工作流和失败语义](docs/spec/recursive-service-import-spec.md)。

- [x] 3.1 抽取单 service import 复用 helper
  - 依赖：2.3。
  - 工作内容：从 `Importer.Import` 抽取 manifest/bin/schema/descriptor 编译、`domain.Service` 组装和 artifact/runtime/descriptor 提交 helper，保持单 service import 行为不变。
  - 可并行子任务：
    - [x] 可并行：识别可抽取代码块和最小 helper 边界。
    - [x] 可并行：补充单 service import 非回归断言。
  - 测试方案：`go test ./internal/packageimport`。
  - 验收标准：单 service import 测试全通过；helper 不引入数据库 schema 变化。
  - 完成总结：已将 `Importer.Import` 中的单 service 流程拆为内部 helper：`validatePreparedService` 负责 manifest/bin/runtime mode 预校验，`prepareServiceRuntime` 负责 runtime 目录和 dependency preparation，`compileServiceDescriptor` 负责 descriptor 编译，`stageServiceCommit` 负责 staging commit 目录组装，`buildImportedService` 负责 `domain.Service` 组装和 schema path 校验，`commitImportedService` 负责 artifact 替换与 store upsert。未改变 public API、store schema 或 artifact layout。补充单 service 非回归断言，确认 `Result.Manifest` 和默认 `ServiceRoot` 仍保持原行为。验证命令：`go test ./internal/packageimport`，结果通过。

- [x] 3.2 实现 `Importer.ImportRecursive`
  - 依赖：3.1、2.2。
  - 工作内容：实现一次 source prepare/build/runtime preparation，多 service discovery 和预校验，预校验全部成功后按 service root 排序逐个提交。
  - 可并行子任务：
    - [x] 可并行：实现一次 distribution 准备和 runtime base 复用。
    - [x] 可并行：实现每个 discovered service 的 manifest、ID、bin、schema、descriptor 预校验。
    - [x] 可并行：实现按 service root 提交和 `PackageSource` 拼接。
  - 测试方案：`go test ./internal/packageimport`。
  - 验收标准：成功导入多个 service；`ID`、`Name`、`PackageSource`、`ServiceRoot`、`NodeEntry`、schema path、methods metadata 正确。
  - 完成总结：已将 `Importer.ImportRecursive` 从占位实现替换为核心成功路径：同一 staging 中只执行一次 source prepare、build 和 runtime dependency preparation；通过 `discoverServiceRoots` 获取稳定 service root 列表；逐个预校验 manifest、`service.json.name` service ID、重复 ID、root `package.json bin`、config/secret schema，并为每个 service 编译独立 descriptor；预校验成功后按 service root 顺序提交各 service，`PackageSource` 使用 base source 拼接 discovered service root。新增测试覆盖多 service package 成功导入、`source//nested` 作为 scan root 只导入子树、package root 自身为 service root，并断言 ID、Name、PackageSource、ServiceRoot、NodeEntry、schema path 和 method metadata。验证命令：`go test ./internal/packageimport`，结果通过。

- [x] 3.3 完成 recursive failure 和零提交语义
  - 依赖：3.2。
  - 工作内容：确保 source 获取、构建、依赖安装、discovery、manifest、ID、bin、schema、descriptor 失败时不提交任何 service；提交阶段系统错误保留已提交项并返回明确失败项。
  - 可并行子任务：
    - [x] 可并行：重复 `service.json.name` 和非法 ID 测试。
    - [x] 可并行：缺 bin entry、坏 schema、坏 proto 测试。
    - [x] 可并行：空发现和 scan root 错误测试。
  - 测试方案：`go test ./internal/packageimport`。
  - 验收标准：所有提交前失败场景 store 中无新增 service；错误信息包含 service root 或 service id 上下文。
  - 完成总结：已新增 `TestImporterImportRecursivePrevalidationFailuresKeepStoreEmpty`，覆盖重复 `service.json.name`、非法 service id、缺 root `package.json bin` entry、缺 schema 文件、坏 proto、空 scan root 和缺失 scan root。每个用例均断言错误包含 service root/scan root 或失败类型上下文，并确认 store 中没有新增 service。当前 3.2 实现已在提交前完成这些 discovery/manifest/ID/bin/schema/descriptor 校验，因此本阶段无需改实现。验证命令：`go test ./internal/packageimport`，结果通过。

- [x] 3.4 验证重导入展示名保留
  - 依赖：3.2。
  - 工作内容：覆盖 recursive import 更新已有 service 时沿用现有 `importServiceName` 规则：未传 name 时保留用户改过的展示名。
  - 可并行子任务：
    - [x] 可并行：写 store rename 后 recursive reimport 测试。
  - 测试方案：`go test ./internal/packageimport`。
  - 验收标准：重导入不覆盖用户手动修改的 `Service.Name`。
  - 完成总结：已新增 `TestImporterImportRecursiveReimportPreservesExistingName`，先 recursive import 多 service package，再通过 store 将 `alpha-service` 改为用户自定义展示名，随后 recursive reimport 另一份 package，断言返回结果和 store 中的 `alpha-service.Name` 均保留用户改名，未被 manifest displayName 覆盖；其他 service 仍使用 manifest displayName 默认规则。验证命令：`go test ./internal/packageimport`，结果通过。

## 4. Admin API 和重启编排

参考文档：[实施计划阶段 4](docs/plan/recursive-service-import-implementation-plan.md)、[技术方案 Admin API 变化](docs/spec/recursive-service-import-spec.md)。

- [x] 4.1 在 import endpoint 接入 recursive 分流
  - 依赖：3.4。
  - 工作内容：在 `handleServiceImport` 中按 `req.Recursive` 分流；recursive 请求校验 `source` 必填、`service_id` 为空、`name` 为空；单 service import 响应保持兼容。
  - 可并行子任务：
    - [x] 可并行：实现请求校验和错误响应测试。
    - [x] 可并行：实现单 service import 兼容测试。
  - 测试方案：`go test ./internal/admin`。
  - 验收标准：recursive 请求调用 `ImportRecursive`；非法组合返回 HTTP 400；单 service import 原测试通过。
  - 完成总结：`handleServiceImport` 已按 `req.Recursive` 分流，recursive 请求校验 `source` 必填、`service_id` 为空、`name` 为空，合法请求调用 `Importer.ImportRecursive`；单 service 请求继续调用 `Importer.Import`，响应 shape 和重启路径保持兼容。相关实现和测试在 1.3 骨架接入时已落地，本阶段在真实 `ImportRecursive` 完成后重新验证。验证命令：`go test ./internal/admin`，结果通过。

- [x] 4.2 聚合 recursive 重启结果
  - 依赖：4.1。
  - 工作内容：对 recursive 结果中的每个 service 调用 `restartEnabledServiceInstances`，按 service id 聚合 `restarted_instances` 和 `restart_errors`；任一重启失败时返回 HTTP 409 和 `status:"degraded"`。
  - 可并行子任务：
    - [x] 可并行：成功重启聚合响应测试。
    - [x] 可并行：重启失败 degraded 响应测试。
    - [x] 可并行：on-demand service 不重启测试。
  - 测试方案：`go test ./internal/admin`。
  - 验收标准：recursive 响应 JSON 符合 spec；重启失败不回滚已导入 service。
  - 完成总结：recursive import 响应已按 service id 聚合 `restarted_instances` 和 `restart_errors`；成功路径测试覆盖多个 service 的聚合响应，并新增 enabled on-demand instance 断言其不会触发重启且返回空重启结果。新增 `TestAdminRecursiveServiceImportDegradedOnRestartFailure` 覆盖 long-running enabled instance 重启失败时返回 HTTP 409、`status:"degraded"`，并在对应 service id 下聚合 restart error。验证命令：`go test ./internal/admin`，结果通过。

- [x] 4.3 审计日志和敏感信息
  - 依赖：4.1、4.2。
  - 工作内容：为 recursive import 增加开始、成功、失败日志，避免记录未脱敏 credential、config 或 secret；复用现有 credential redaction 语义。
  - 可并行子任务：
    - [x] 可并行：日志字段和错误输出审计。
    - [x] 可并行：HTTPS Git credential 不泄露测试。
  - 测试方案：`go test ./internal/admin`，必要时补充 `go test ./internal/integration`。
  - 验收标准：响应、日志和 stored `PackageSource` 不包含原始 credential。
  - 完成总结：已审计 recursive admin 日志字段，开始/完成/失败日志不记录请求 source、config 或 secret。修正 recursive Git `PackageSource` 组装：HTTPS Git source 使用 `parseGitSource` 的 redacted 结果作为 base，去除 scan root 后再把 discovered service root 插入到 `@ref` 前，避免原始 credential 泄露和 Git source 语法错误。新增 `TestRecursiveGitPackageSourceRedactsCredentials` 覆盖 `https://user:p%40ss@...//scan-root@ref` 递归拼接不泄露密码；新增 `TestAdminRecursiveServiceImportLogsDoNotLeakSourceCredentials` 覆盖 recursive admin 响应和日志不包含原始 credential。验证命令：`go test ./internal/packageimport ./internal/admin`，结果通过。

## 5. CLI 和服务包验证脚本

参考文档：[实施计划阶段 5](docs/plan/recursive-service-import-implementation-plan.md)、[CLI 设计](docs/design/product/cli.md)。

- [x] 5.1 实现 `octobus service import --recursive SOURCE`
  - 依赖：4.3、2.1。
  - 工作内容：在 `serviceImportCommand` 新增 `--recursive` flag；recursive 模式只接受一个 `SOURCE`，禁止 `--name`，请求体发送 `recursive:true` 且不发送 `service_id`。
  - 可并行子任务：
    - [x] 可并行：CLI args 校验实现。
    - [x] 可并行：CLI 请求体测试。
    - [x] 可并行：help 文案审计，确保不出现 `--id` 或 `--all`。
  - 测试方案：`go test ./internal/cli`。
  - 验收标准：`--recursive --name`、缺 source、多 source 报错清晰；非 recursive `SERVICE SOURCE` 保持兼容。
  - 完成总结：CLI 已支持 `octobus service import --recursive SOURCE`，recursive 模式只接受一个 `SOURCE`，禁止 `--name`，请求体发送 `recursive:true`、`source`、`offline`、`reinstall`、`build`，且不发送 `service_id`/`name`；非 recursive `SERVICE SOURCE` 保持兼容。补充 help usage 展示 recursive 形态，并在 `service import --help` 中审计不出现 `--all` alias；既有 help 测试继续禁止 `--id` 资源定位 flag。验证命令：`go test ./internal/cli`，结果通过。

- [x] 5.2 更新 services import-check 脚本
  - 依赖：5.1。
  - 工作内容：将 `services/scripts/import-check-all.mjs` 改为执行一次 `octobus service import --recursive <root>`，再用 `service list` 校验 `discoverServices(root)` 中每个 service 的 `ID`、`ServiceRoot`、`NodeEntry`。
  - 可并行子任务：
    - [x] 可并行：脚本主流程更新。
    - [x] 可并行：`services/tests/validate-service-package.test.mjs` 参数校验和 discoverServices 断言更新。
  - 测试方案：`node --test services/tests/validate-service-package.test.mjs`。
  - 验收标准：脚本不再调用旧 `service import --id ...` 形态；Node 测试通过。
  - 完成总结：已将 `services/scripts/import-check-all.mjs` 改为递归发现 service roots，跳过 `node_modules`、`.git` 和隐藏目录；主流程启动 daemon 后执行一次 `octobus service import --recursive <root>`，再通过 `octobus service list` 校验每个发现 service 的 `ID`、`ServiceRoot`、`NodeEntry`。Node 测试保留参数校验和 discoverServices 断言，并新增静态断言确认脚本使用 `--recursive` 且不再使用旧 `service import --id` 形态。验证命令：`node --test services/tests/validate-service-package.test.mjs`，结果通过。

- [x] 5.3 聚焦验证 CLI + admin + importer 串联
  - 依赖：5.1、5.2。
  - 工作内容：运行 recursive 相关 focused tests，修复跨层请求体、响应字段、source 规范化不一致问题。
  - 可并行子任务：
    - [x] 可并行：Go focused tests。
    - [x] 可并行：Node service package script tests。
  - 测试方案：`go test ./internal/cli ./internal/admin ./internal/packageimport`；`node --test services/tests/validate-service-package.test.mjs`。
  - 验收标准：Go 和 Node focused tests 均通过。
  - 完成总结：已完成 recursive import 的 CLI 请求体、admin 分流/响应聚合、packageimport 核心流程和 services import-check 脚本串联 focused 验证，未发现跨层字段、source 规范化或响应 shape 不一致。验证命令：`go test ./internal/cli ./internal/admin ./internal/packageimport`，结果通过；`node --test services/tests/validate-service-package.test.mjs`，结果通过。

## 6. 端到端覆盖和文档

参考文档：[实施计划阶段 6](docs/plan/recursive-service-import-implementation-plan.md)、[README.md](README.md)、[README.zh-CN.md](README.zh-CN.md)。

- [ ] 6.1 增加 integration 或 e2e recursive import 场景
  - 依赖：5.3。
  - 工作内容：增加 daemon + CLI + store 的 recursive import 场景，导入本地 multi-service fixture 或 services 子集 fixture，并验证 `service list` 输出多个 service。
  - 可并行子任务：
    - [ ] 可并行：构造 e2e/integration fixture。
    - [ ] 可并行：实现 `service list` 验证和必要的 artifact metadata 断言。
  - 测试方案：`go test ./internal/integration` 或 `go test ./tests/e2e -count=1`，按实际落点执行。
  - 验收标准：测试证明 daemon 路径可用；不依赖用户 `~/.octobus`。
  - 完成总结：待完成。

- [ ] 6.2 补充重启聚合端到端覆盖
  - 依赖：6.1。
  - 工作内容：如 fixture 支持 long-running instance 更新路径，覆盖 recursive import 后 enabled instances 按 service 重启以及 degraded 响应；若 e2e 成本过高，保留 admin/integration 覆盖并在完成总结说明原因。
  - 可并行子任务：
    - [ ] 可并行：评估现有 supervisor 测试夹具能否复用。
    - [ ] 可并行：实现重启成功或失败路径断言。
  - 测试方案：`go test ./internal/admin ./internal/integration`，必要时 `go test ./tests/e2e -count=1`。
  - 验收标准：至少一类跨组件测试证明重启聚合语义；没有覆盖的 e2e 细节有明确理由。
  - 完成总结：待完成。

- [ ] 6.3 更新用户和设计文档
  - 依赖：5.3。
  - 工作内容：更新 `README.md`、`README.zh-CN.md` 和相关设计文档，加入 `service import --recursive SOURCE` 示例、`source//some-dir` 作为 scan root 的说明，并同步 spec 如有实现偏差。
  - 可并行子任务：
    - [ ] 可并行：英文 README 和设计文档更新。
    - [ ] 可并行：中文 README 更新。
    - [ ] 可并行：检查不出现 `--all` alias 承诺。
  - 测试方案：文档检查；`rg -n -- "--all|--recursive|service import --id" README.md README.zh-CN.md docs services/scripts services/tests`。
  - 验收标准：文档只承诺首版范围；不引入与 CLI 资源定位规范冲突的 `--id` 示例。
  - 完成总结：待完成。

- [ ] 6.4 阶段收口验证
  - 依赖：6.1、6.2、6.3。
  - 工作内容：运行阶段性 focused tests 和 lint，确认代码、脚本、文档一致。
  - 可并行子任务：
    - [ ] 可并行：Go focused tests。
    - [ ] 可并行：Node script tests。
    - [ ] 可并行：文档 grep 审计。
  - 测试方案：`go test ./internal/cli ./internal/admin ./internal/packageimport ./internal/integration`；`node --test services/tests/validate-service-package.test.mjs`；`task lint`。
  - 验收标准：阶段性测试全部通过，或完成总结记录明确环境阻塞和复现命令。
  - 完成总结：待完成。

## 7. 完整质量门禁和收尾

参考文档：[实施计划阶段 7](docs/plan/recursive-service-import-implementation-plan.md)、[Taskfile.yml](Taskfile.yml)、[scripts/test-coverage.sh](scripts/test-coverage.sh)。

- [ ] 7.1 工作树和产物审计
  - 依赖：6.4。
  - 工作内容：检查 `git status --short`，确认 diff 只包含 recursive import 相关代码、测试、脚本和文档；清理不应提交的 `bin/`、coverage、node_modules、日志、data dir、service artifacts。
  - 可并行子任务：
    - [ ] 可并行：工作树未跟踪文件审计。
    - [ ] 可并行：文档和脚本变更范围审计。
  - 测试方案：`git status --short`；必要时 `git diff --stat`。
  - 验收标准：无无关改动；无敏感或生成产物进入待提交范围。
  - 完成总结：待完成。

- [ ] 7.2 运行完整 focused 和 e2e 验证
  - 依赖：7.1。
  - 工作内容：按计划运行所有 focused tests、Node tests 和 e2e。
  - 可并行子任务：
    - [ ] 可并行：`go test ./internal/cli ./internal/admin ./internal/packageimport`
    - [ ] 可并行：`go test ./internal/integration`
    - [ ] 可并行：`node --test services/tests/validate-service-package.test.mjs`
    - [ ] 可并行：`go test ./tests/e2e -count=1`
  - 测试方案：上述命令全部执行。
  - 验收标准：命令全部通过；失败时完成总结记录关键错误和下一步定位点。
  - 完成总结：待完成。

- [ ] 7.3 运行 Task 完整门禁
  - 依赖：7.2。
  - 工作内容：运行 harness 要求的完整门禁，确认 lint、coverage、build 满足要求。
  - 可并行子任务：无，`task test`、`task lint`、`task build` 可能共享 build/test artifacts，应串行执行。
  - 测试方案：`task test`；`task lint`；`task build`；最终可运行 `task all` 作为等价收口。
  - 验收标准：`task test` 输出满足 unit、integration、e2e 各 60% 和 overall 90% 覆盖要求；`task lint` 和 `task build` 通过。
  - 完成总结：待完成。

- [ ] 7.4 最终验收说明
  - 依赖：7.3。
  - 工作内容：汇总已完成任务证据、测试命令、未覆盖风险和 PR 注意事项。
  - 可并行子任务：
    - [ ] 可并行：整理测试输出和覆盖率摘要。
    - [ ] 可并行：整理 CLI 行为、service package format、本地 runtime requirement 变化说明。
  - 测试方案：不新增测试；复核 7.2 和 7.3 输出。
  - 验收标准：PR 摘要材料齐备；未完成或未运行项都有明确原因。
  - 完成总结：待完成。

## 首版不做事项

- 不实现 `--all` alias。
- 不实现 include/exclude 过滤、service id 映射文件或手动重命名批量导入项。
- 不自动创建 instance、capset 或 method binding。
- 不把 `octobus-tentacles` dispatcher 注册为特殊 service。
- 不新增数据库 schema，不改变 `service.json` manifest schema。
- 不实现跨多个 service 的强事务回滚。
- 不扩展 SDK multi-service dispatcher 生成能力。
