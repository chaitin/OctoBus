# state-manager v3 开发路线图

> 目标：从"我的 6 个智能体能用"变成"社区任何 AI agent 都能直接用的记忆基础设施"

---

## 当前差距分析

| 维度 | 当前状态 | 通用工具需要 | 差距 |
|------|---------|------------|------|
| **测试** | 0 个测试文件（测试脚本只在本地） | 单元测试 + 集成测试覆盖 | 🔴 大 |
| **SDK** | 无，用户必须用 grpcurl | Python/TypeScript SDK | 🔴 大 |
| **自动蒸馏** | 需要手动调 Distill() RPC | 后台定时自动蒸馏 | 🟡 中 |
| **存储引擎** | 仅 JSON 文件 | 至少支持 SQLite | 🟡 中 |
| **多租户** | 环境变量注入，无鉴权 | API 层鉴权 + 数据隔离 | 🟡 中 |
| **可观测性** | console.log | 健康检查 + Prometheus metrics | 🟡 中 |
| **Type 扩展** | 改源码加行 | 运行时 registerType() API | 🟢 小 |
| **文档** | README + 设计文档 | Quick Start + Tutorial + API Reference | 🟢 小 |

---

## 开发阶段

### 阶段 1：测试覆盖（1-2 周）

**为什么先做测试**：开源第一原则——没测试的代码没人敢用，也没人敢贡献。

**具体任务**：

| # | 任务 | 工作量 | 说明 |
|---|------|--------|------|
| 1.1 | 搭建测试框架 | 0.5 天 | 用 Node.js 内置 `node:test`（零依赖），加 `npm test` 脚本 |
| 1.2 | memory-engine 单元测试 | 1 天 | Remember/Recall/Forget + 去重/TTL/容量淘汰，约 20 个用例 |
| 1.3 | distillation-engine 单元测试 | 1 天 | action_log 压缩 + session_summary 合并 + correction 升降级，约 15 个用例 |
| 1.4 | task-machine 单元测试 | 1 天 | 状态转换校验 + 步骤追踪 + 超时检测，约 15 个用例 |
| 1.5 | event-log 单元测试 | 0.5 天 | 追加写入 + 轮转 + 范围查询，约 10 个用例 |
| 1.6 | type-registry 单元测试 | 0.5 天 | resolve 默认值 + 自定义覆盖 + registerType，约 8 个用例 |
| 1.7 | 集成测试 | 1 天 | bin/state-service.js 的 handler 端到端测试（mock gRPC），约 17 个用例 |

**验收标准**：`npm test` 全部通过，覆盖率 > 80%

---

### 阶段 2：运行时扩展 + 自动蒸馏（1 周）

**目标**：不用改源码就能加记忆类型，蒸馏自动运行不需要手动触发。

| # | 任务 | 工作量 | 说明 |
|---|------|--------|------|
| 2.1 | registerType() API | 1 天 | 新增 RPC `RegisterType(name, config)`，运行时动态注册记忆类型，写入 type-registry.json 持久化 |
| 2.2 | ListTypes RPC | 0.5 天 | 列出所有已注册类型（含默认 5 种 + 自定义），方便 agent 发现可用类型 |
| 2.3 | 自动蒸馏调度器 | 1.5 天 | config 里加 `distill_interval_seconds`（默认 3600），后台定时器自动调 Distill()。也支持通过 OctoBus Loader cron 触发 |
| 2.4 | 蒸馏策略可配置 | 1 天 | 当前压缩阈值硬编码，改为 TypeRegistry 里每种类型配 `distill_policy`：`{ min_entries, compression_ratio, target_ttl }` |

**proto 新增**：
```protobuf
rpc RegisterType(RegisterTypeRequest) returns (RegisterTypeResponse);
rpc ListTypes(ListTypesRequest) returns (ListTypesResponse);
```

**验收标准**：`RegisterType("alert", { defaultTTL: 86400, maxEntries: 50 })` → 后续 `Remember(type="alert")` 可用；蒸馏每小时自动运行一次。

---

### 阶段 3：SQLite 存储引擎（1-2 周）

**为什么需要 SQLite**：JSON 文件不适合高频写入和多条目场景。SQLite 是零配置的升级路径。

| # | 任务 | 工作量 | 说明 |
|---|------|--------|------|
| 3.1 | StorageAdapter 接口抽象 | 1 天 | 抽取 interface：`loadAll()`, `saveEntry()`, `deleteEntry()`, `query()`, `waitForPendingWrites()`。当前 JSON 实现作为 `JsonStorageAdapter` |
| 3.2 | SqliteStorageAdapter 实现 | 2 天 | 用 `better-sqlite3`（同步 API，性能好）。每类记忆一张表，前缀索引用 FTS5 |
| 3.3 | 配置切换 | 0.5 天 | config.schema.json 加 `storage.engine`：`"json" | "sqlite"`，默认 json |
| 3.4 | 数据迁移工具 | 1 天 | `migrate-to-sqlite.js` 脚本：读取 JSON 文件 → 写入 SQLite |
| 3.5 | 性能基准测试 | 0.5 天 | 对比 JSON vs SQLite 在 1K/10K/100K 条目下的读写延迟 |

**验收标准**：`STORAGE_ENGINE=sqlite` 启动后，所有 17 个 RPC 行为不变，1 万条记忆 Recall < 50ms。

---

### 阶段 4：Agent SDK（2 周）

**目标**：Python 和 TypeScript 开发者 3 行代码就能用记忆能力。

### 4.1 Python SDK

```python
from state_manager import MemoryClient

mem = MemoryClient("state-prod", capset="dev")

# 记住
mem.remember("customer:acme", {"id": "123", "name": "Acme Corp"}, type="entity_cache")

# 回忆
result = mem.recall(prefix="customer:")

# 忘记
mem.forget(prefix="customer:old_")
```

| # | 任务 | 工作量 |
|---|------|--------|
| 4.1.1 | gRPC client 生成（from proto） | 0.5 天 |
| 4.1.2 | MemoryClient 封装 | 1 天 |
| 4.1.3 | 类型提示 + PyPI 发布 | 0.5 天 |

### 4.2 TypeScript SDK

```typescript
import { MemoryClient } from "@chaitin-ai/state-manager-client";

const mem = new MemoryClient({ instance: "state-prod", capset: "dev" });
await mem.remember("customer:acme", { id: "123" }, { type: "entity_cache" });
```

| # | 任务 | 工作量 |
|---|------|--------|
| 4.2.1 | 从 proto 生成 TS 类型 | 0.5 天 |
| 4.2.2 | MemoryClient 封装 | 1 天 |
| 4.2.3 | npm 发布 | 0.5 天 |

**验收标准**：`pip install chaitin-state-manager` + 3 行代码 = 能 Remember/Recall。

---

### 阶段 5：多租户 + 可观测性（2 周）

| # | 任务 | 工作量 | 说明 |
|---|------|--------|------|
| 5.1 | gRPC 拦截器鉴权 | 2 天 | 从 gRPC metadata 提取 tenant/userId，校验 key 前缀匹配 |
| 5.2 | 数据隔离验证 | 1 天 | tenant A 的 Recall 看不到 tenant B 的数据 |
| 5.3 | Health Check RPC | 0.5 天 | `HealthCheck()` → 存储引擎连通性 + 条目数 + 上次蒸馏时间 |
| 5.4 | Prometheus metrics | 1 天 | `state_remember_total`、`state_recall_total`、`state_distill_runs`、`state_entries` |
| 5.5 | 结构化日志 | 1 天 | 替换 console.log → pino/winston，JSON 格式输出 |

**验收标准**：两个 tenant 的 agent 跑在同一实例上，数据完全隔离；`curl /metrics` 暴露 Prometheus 指标。

---

### 阶段 6：语义搜索（远期，4+ 周）

> 这个是 v4 远期目标，需要 embedding 服务。当前先留接口。

| # | 任务 | 说明 |
|---|------|------|
| 6.1 | RecallSemantic RPC | 输入自然语言查询 → embedding → 向量搜索 → 返回 top-K 相关记忆 |
| 6.2 | Embedding 集成 | 调外部 embedding API（OpenAI / 本地模型），写入时自动生成向量 |
| 6.3 | 向量存储 | SQLite + vec 扩展，或独立向量库（Qdrant / Chroma） |

**proto 预留**：
```protobuf
rpc RecallSemantic(RecallSemanticRequest) returns (RecallResponse);
```

---

## 时间线总览

```
Week 1-2  │ 阶段 1：测试覆盖（70+ 用例，覆盖率 > 80%）
Week 3    │ 阶段 2：registerType + 自动蒸馏（19 个 RPC）
Week 4-5  │ 阶段 3：SQLite 存储引擎（可插拔 StorageAdapter）
Week 6-7  │ 阶段 4：Python + TypeScript SDK
Week 8-9  │ 阶段 5：多租户鉴权 + 可观测性
Week 10+  │ 阶段 6：语义搜索（远期）
```

## 你的 6 个智能体迁移计划

在阶段 2 完成后（自动蒸馏就绪），就可以开始迁移 agent prompt：

| 步骤 | 改动 | 风险 |
|------|------|------|
| 1 | VM 部署 v3 为 `state-v3` 实例（与 state-prod 并行） | 低 |
| 2 | 选 1 个低风险 agent（如 daily-summary）切到 state-v3 | 低 |
| 3 | 把 prompt 中的 MatchProject → Recall + LLM 判断 | 中（需要调 prompt） |
| 4 | AddPendingItem/ClearPending → Remember/Forget | 低（1:1 映射） |
| 5 | RegisterMeeting/UpdateMeetingState → Remember/Recall 组合 | 中 |
| 6 | GetUserConfig → GetState 或环境变量 | 低 |
| 7 | 全部 agent 验证通过后，替换 state-prod | 低 |

**关键原则**：每步迁移后跑一轮完整业务验证，确认智能体行为不退化。

---

## 每个阶段的 PR 计划

| 阶段 | GitHub PR | 仓库 |
|------|-----------|------|
| 1 | test: add unit + integration tests for all modules | OctoBus |
| 2 | feat: RegisterType/ListTypes RPC + auto-distill scheduler | OctoBus |
| 3 | feat: SQLite storage adapter (pluggable) | OctoBus |
| 4a | feat: Python SDK for state-manager | 新仓库 chaitin/state-manager-python |
| 4b | feat: TypeScript SDK for state-manager | 新仓库 chaitin/state-manager-ts |
| 5 | feat: multi-tenant auth + health check + metrics | OctoBus |
| 6 | feat: semantic recall with embedding | OctoBus |

---

*每次完成一个阶段，更新此文档和 v3-design.md。*
