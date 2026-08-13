# Service L2 批量审计

`scripts/service-l2-batch.mjs` 用 PR #494 的门禁版本批量检查已有开放 PR。默认排除 #494，默认只落盘结果；只有显式传入 `--publish` 才会更新 GitHub 评论和标签。

## 隔离、并发和缓存

- 每个 PR 使用 GitHub `pull/<number>/merge` ref，验证的是当前 main 与 PR 的实际合并结果。
- 每个 PR 使用独立 detached worktree，避免构建产物相互污染。
- npm 下载使用共享 cache。
- `services/package.json` 与 lockfile 内容相同的 PR 共用一个只读 `node_modules` 依赖池。依赖池只安装一次，worktree 通过符号链接读取；禁止多个 PR 并发写同一个 `node_modules`。
- Go 使用共享 `GOMODCACHE` 和 `GOCACHE`，但每个 worktree 独立生成 `bin/octobus`。
- 默认并发 3。构建和 Node 测试都可能占用较多 CPU/内存，不建议按 PR 数量无限并发。

## 状态

- `l2:passed`：完整门禁通过。
- `l2:failed`：实际执行门禁失败。
- `l2:blocked`：Draft、冲突或 GitHub 无 merge ref，未执行。
- `l2:not-applicable`：不是单 Service 实现 PR。

标签互斥。评论包含隐藏 marker、PR head SHA 和 gate SHA；重复执行会更新原评论，PR head 未变化时复用本地结果。

## 使用

先对少量 PR 执行但不发布：

```bash
node scripts/service-l2-batch.mjs --pr 483 --pr 488 --concurrency 2
```

查看并确认 `<state-dir>/summary.json` 后发布：

```bash
node scripts/service-l2-batch.mjs --pr 483 --pr 488 --publish
```

全量开放 PR：

```bash
node scripts/service-l2-batch.mjs --concurrency 3
node scripts/service-l2-batch.mjs --concurrency 3 --publish
```

常用选项：

- `--state-dir <path>`：持久化 worktree、cache、日志和结果；长期批处理应使用有足够空间的目录。
- `--force`：忽略相同 head/gate 的本地结果并重跑。
- `--keep-worktrees`：保留 PR worktree，用于调试。
- `--exclude <number>`：额外排除 PR。
- `--dry-run`：只获取和分类，不执行门禁，也不读写正式结果缓存。

建议先执行 2–3 个代表性 PR 校准资源和评论格式，再运行全量并发布。测试阶段和发布阶段分开，避免脚本错误向 90+ 个 PR 批量写入错误结果。
